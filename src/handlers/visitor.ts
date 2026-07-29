import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

const tableName = process.env.TABLE_NAME;
const counterKey = { counter_id: "total" };

const lowLevelClient = new DynamoDBClient({});
const documentClient = DynamoDBDocumentClient.from(lowLevelClient);

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

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
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
        count: Number(result.Item?.count ?? 0),
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

      return jsonResponse(200, {
        count: Number(result.Attributes?.count ?? 0),
      });
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
