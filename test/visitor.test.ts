import assert from "node:assert/strict";
import test from "node:test";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { createVisitorHandler } from "../src/handlers/visitor.js";

function apiEvent(method: string, rawPath: string): APIGatewayProxyEventV2 {
  return {
    rawPath,
    requestContext: {
      http: { method },
      requestId: "local-test-request",
    },
  } as APIGatewayProxyEventV2;
}

function responseBody(response: { body?: string | undefined }) {
  return JSON.parse(response.body ?? "{}") as Record<string, unknown>;
}

function assertJsonResponse(response: {
  headers?: Record<string, boolean | number | string> | undefined;
}) {
  assert.equal(response.headers?.["content-type"], "application/json");
}

test("GET /count returns the stored count", async () => {
  const commands: unknown[] = [];
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: {
      async send(command) {
        commands.push(command);
        return { Item: { count: 12 } };
      },
    },
  });

  const response = await handler(apiEvent("GET", "/count"));

  assert.equal(response.statusCode, 200);
  assertJsonResponse(response);
  assert.deepEqual(responseBody(response), { count: 12 });
  assert.equal(commands.length, 1);
  assert.ok(commands[0] instanceof GetCommand);
  assert.equal(commands[0].input.TableName, "visitor-table");
  assert.deepEqual(commands[0].input.Key, { counter_id: "total" });
});

test("GET /count returns zero when the counter item does not exist", async () => {
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: {
      async send() {
        return {};
      },
    },
  });

  const response = await handler(apiEvent("GET", "/count"));

  assert.equal(response.statusCode, 200);
  assertJsonResponse(response);
  assert.deepEqual(responseBody(response), { count: 0 });
});

test("POST /visit atomically increments and returns the updated count", async () => {
  const commands: unknown[] = [];
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: {
      async send(command) {
        commands.push(command);
        return { Attributes: { count: 13 } };
      },
    },
  });

  const response = await handler(apiEvent("POST", "/visit"));

  assert.equal(response.statusCode, 200);
  assertJsonResponse(response);
  assert.deepEqual(responseBody(response), { count: 13 });
  assert.equal(commands.length, 1);
  assert.ok(commands[0] instanceof UpdateCommand);
  assert.equal(commands[0].input.UpdateExpression, "ADD #count :increment");
  assert.deepEqual(commands[0].input.ExpressionAttributeValues, {
    ":increment": 1,
  });
  assert.equal(commands[0].input.ReturnValues, "UPDATED_NEW");
});

test("an unknown route returns 404 without calling DynamoDB", async () => {
  let sendCalls = 0;
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: {
      async send() {
        sendCalls += 1;
        return {};
      },
    },
  });

  const response = await handler(apiEvent("DELETE", "/count"));

  assert.equal(response.statusCode, 404);
  assertJsonResponse(response);
  assert.deepEqual(responseBody(response), { message: "Route not found" });
  assert.equal(sendCalls, 0);
});

test("a missing table configuration returns 500 without calling DynamoDB", async () => {
  let sendCalls = 0;
  const handler = createVisitorHandler({
    tableName: undefined,
    documentClient: {
      async send() {
        sendCalls += 1;
        return {};
      },
    },
  });

  const response = await handler(apiEvent("GET", "/count"));

  assert.equal(response.statusCode, 500);
  assertJsonResponse(response);
  assert.deepEqual(responseBody(response), {
    message: "Server configuration error",
  });
  assert.equal(sendCalls, 0);
});

test("a DynamoDB failure returns a safe 500 response", async () => {
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: {
      async send() {
        throw new Error("database details that must not reach the client");
      },
    },
  });

  const response = await handler(apiEvent("POST", "/visit"));

  assert.equal(response.statusCode, 500);
  assertJsonResponse(response);
  assert.deepEqual(responseBody(response), {
    message: "Internal server error",
  });
  assert.doesNotMatch(
    response.body ?? "",
    /database details that must not reach the client/,
  );
});

test("a malformed stored count returns a safe 500 response", async () => {
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: {
      async send() {
        return { Item: { count: "not-a-number" } };
      },
    },
  });

  const response = await handler(apiEvent("GET", "/count"));

  assert.equal(response.statusCode, 500);
  assertJsonResponse(response);
  assert.deepEqual(responseBody(response), {
    message: "Internal server error",
  });
});

test("a missing updated count returns a safe 500 response", async () => {
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: {
      async send() {
        return {};
      },
    },
  });

  const response = await handler(apiEvent("POST", "/visit"));

  assert.equal(response.statusCode, 500);
  assertJsonResponse(response);
  assert.deepEqual(responseBody(response), {
    message: "Internal server error",
  });
});
