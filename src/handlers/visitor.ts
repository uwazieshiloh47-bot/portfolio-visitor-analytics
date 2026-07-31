import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

const counterKey = { counter_id: "total" };

const lowLevelClient = new DynamoDBClient({});
const documentClient = DynamoDBDocumentClient.from(lowLevelClient);

type DynamoCommand = GetCommand | UpdateCommand;

interface DynamoDocumentClient {
  send(command: DynamoCommand): Promise<{
    Item?: Record<string, unknown>;
    Attributes?: Record<string, unknown>;
  }>;
}

interface VisitorHandlerDependencies {
  tableName: string | undefined;
  documentClient: DynamoDocumentClient;
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

export function createVisitorHandler({
  tableName,
  documentClient,
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

      return jsonResponse(200, { count });
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
});
