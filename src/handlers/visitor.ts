import { createHash } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

const counterKey = { counter_id: "total" };

/*
  How long a "already counted today" marker outlives the day it belongs to.
  DynamoDB deletes expired items on its own schedule - usually within a few
  hours, occasionally longer - so the marker only has to survive until the day
  it covers is over. Two days is slack, not a requirement.
*/
const markerLifetimeSeconds = 2 * 24 * 60 * 60;

const lowLevelClient = new DynamoDBClient({});
const documentClient = DynamoDBDocumentClient.from(lowLevelClient);

type DynamoCommand = GetCommand | PutCommand | UpdateCommand;

interface DynamoDocumentClient {
  send(command: DynamoCommand): Promise<{
    Item?: Record<string, unknown>;
    Attributes?: Record<string, unknown>;
  }>;
}

interface VisitorHandlerDependencies {
  tableName: string | undefined;
  documentClient: DynamoDocumentClient;
  hashSalt?: string | undefined;
  now?: (() => Date) | undefined;
}

function jsonResponse(
  statusCode: number,
  body: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

function readCount(value: unknown, missingValue?: number): number {
  if (value === undefined && missingValue !== undefined) {
    return missingValue;
  }

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error("Invalid counter value returned by DynamoDB");
  }

  return value;
}

function logVisitorMetric(count: number) {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: "PortfolioVisitorAnalytics",
            Dimensions: [["Environment"]],
            Metrics: [{ Name: "VisitorCount", Unit: "Count" }],
          },
        ],
      },
      Environment: process.env.ENVIRONMENT ?? "dev",
      VisitorCount: count,
    }),
  );
}

/*
  The key for one client on one day.

  The source IP is hashed rather than stored. A raw IP is personal data and the
  table has no business holding it; all the counter needs is a stable token
  that means "this client, today". The date goes into the digest as well as the
  key, so the same address produces a different token tomorrow and the items
  cannot be joined into a history of who visited when.

  The salt is what makes the hash worth doing. IPv4 is only four billion
  values, so an unsalted digest is a lookup table away from being reversible.
  With a secret salt, reversing it needs the Lambda's environment as well as
  the table.

  A request with no source IP - which API Gateway should never produce - falls
  into a single shared bucket. That undercounts rather than inflates, which is
  the right way round for a number sitting on a portfolio.
*/
function visitMarkerKey(
  sourceIp: string | undefined,
  day: string,
  salt: string,
) {
  const digest = createHash("sha256")
    .update(`${salt}:${day}:${sourceIp ?? "unknown"}`)
    .digest("hex")
    .slice(0, 32);

  return { counter_id: `visit#${day}#${digest}` };
}

function utcDay(now: Date) {
  return now.toISOString().slice(0, 10);
}

export function createVisitorHandler({
  tableName,
  documentClient,
  hashSalt = "",
  now = () => new Date(),
}: VisitorHandlerDependencies) {
  return async (
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!tableName) {
    console.error(
      JSON.stringify({
        message: "configuration_error",
        detail: "TABLE_NAME is not configured",
      }),
    );

    return jsonResponse(500, {
      message: "Server configuration error",
    });
  }

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  console.log(
    JSON.stringify({
      message: "request_received",
      requestId: event.requestContext.requestId,
      method,
      path,
    }),
  );

  try {
    if (method === "GET" && path === "/count") {
      const result = await documentClient.send(
        new GetCommand({
          TableName: tableName,
          Key: counterKey,
          ProjectionExpression: "#count",
          ExpressionAttributeNames: {
            "#count": "count",
          },
        }),
      );

      return jsonResponse(200, {
        count: readCount(result.Item?.count, 0),
      });
    }

    if (method === "POST" && path === "/visit") {
      const timestamp = now();
      const day = utcDay(timestamp);
      let firstVisitToday = true;

      /*
        Claim the day before touching the total. Writing the marker first means
        a failure between the two steps loses a visit; doing it the other way
        round would count one twice on a client retry. Both are wrong, but a
        number that is honest about being a floor is worth more here than one
        that drifts upward.
      */
      try {
        await documentClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              ...visitMarkerKey(
                event.requestContext.http.sourceIp,
                day,
                hashSalt,
              ),
              ttl:
                Math.floor(timestamp.getTime() / 1000) + markerLifetimeSeconds,
            },
            ConditionExpression: "attribute_not_exists(counter_id)",
          }),
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "ConditionalCheckFailedException"
        ) {
          firstVisitToday = false;
        } else {
          /*
            Anything else - the table missing its TTL attribute, the role
            missing dynamodb:PutItem - degrades to counting every request,
            which is what this API did before deduplication existed. Failing
            open keeps the counter serving; failing closed would return 500 to
            every visitor because a permission is one apply behind the code.

            This is logged rather than swallowed because the degraded state is
            invisible from the outside: the number just starts climbing again.
          */
          console.error(
            JSON.stringify({
              message: "deduplication_unavailable",
              requestId: event.requestContext.requestId,
              error: error instanceof Error ? error.name : "UnknownError",
            }),
          );
        }
      }

      if (!firstVisitToday) {
        const result = await documentClient.send(
          new GetCommand({
            TableName: tableName,
            Key: counterKey,
            ProjectionExpression: "#count",
            ExpressionAttributeNames: {
              "#count": "count",
            },
          }),
        );

        return jsonResponse(200, {
          count: readCount(result.Item?.count, 0),
          counted: false,
        });
      }

      const result = await documentClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: counterKey,
          UpdateExpression: "ADD #count :increment",
          ExpressionAttributeNames: {
            "#count": "count",
          },
          ExpressionAttributeValues: {
            ":increment": 1,
          },
          ReturnValues: "UPDATED_NEW",
        }),
      );

      const count = readCount(result.Attributes?.count);
      logVisitorMetric(count);

      return jsonResponse(200, { count, counted: true });
    }

    return jsonResponse(404, {
      message: "Route not found",
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "request_failed",
        requestId: event.requestContext.requestId,
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );

    return jsonResponse(500, {
      message: "Internal server error",
    });
  }
  };
}

export const handler: APIGatewayProxyHandlerV2 = createVisitorHandler({
  tableName: process.env.TABLE_NAME,
  documentClient,
  hashSalt: process.env.VISIT_HASH_SALT,
});
