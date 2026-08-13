import assert from "node:assert/strict";
import test from "node:test";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { createVisitorHandler } from "../src/handlers/visitor.js";

function apiEvent(
  method: string,
  rawPath: string,
  sourceIp = "203.0.113.7",
): APIGatewayProxyEventV2 {
  return {
    rawPath,
    requestContext: {
      http: { method, sourceIp },
      requestId: "local-test-request",
    },
  } as APIGatewayProxyEventV2;
}

/*
  A stand-in for the one thing the handler cannot do without: a conditional
  write that fails when the key is already there. Everything about counting
  once per address per day rests on that, so the double is a real store rather
  than a canned response.
*/
function fakeTable(initialCount = 12) {
  const items = new Map<string, Record<string, unknown>>([
    ["total", { counter_id: "total", count: initialCount }],
  ]);
  const commands: unknown[] = [];

  return {
    items,
    commands,
    documentClient: {
      async send(command: GetCommand | PutCommand | UpdateCommand) {
        commands.push(command);
        const input = command.input as Record<string, any>;

        if (command instanceof PutCommand) {
          const key = input.Item.counter_id as string;

          if (input.ConditionExpression && items.has(key)) {
            const conflict = new Error("The conditional request failed");
            conflict.name = "ConditionalCheckFailedException";
            throw conflict;
          }

          items.set(key, input.Item);
          return {};
        }

        if (command instanceof UpdateCommand) {
          const key = input.Key.counter_id as string;
          const existing = items.get(key) ?? { counter_id: key, count: 0 };
          const updated = {
            ...existing,
            count: (existing.count as number) + 1,
          };

          items.set(key, updated);
          return { Attributes: { count: updated.count } };
        }

        const item = items.get(input.Key.counter_id as string);
        return item ? { Item: item } : {};
      },
    },
  };
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
  const table = fakeTable(12);
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: table.documentClient,
  });

  const response = await handler(apiEvent("POST", "/visit"));

  assert.equal(response.statusCode, 200);
  assertJsonResponse(response);
  assert.deepEqual(responseBody(response), { count: 13, counted: true });

  const [claim, increment] = table.commands;
  assert.ok(claim instanceof PutCommand);
  assert.equal(
    claim.input.ConditionExpression,
    "attribute_not_exists(counter_id)",
  );
  assert.ok(increment instanceof UpdateCommand);
  assert.equal(increment.input.UpdateExpression, "ADD #count :increment");
  assert.deepEqual(increment.input.ExpressionAttributeValues, {
    ":increment": 1,
  });
  assert.equal(increment.input.ReturnValues, "UPDATED_NEW");
});

test("a repeat visit from the same address on the same day does not count", async () => {
  const table = fakeTable(12);
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: table.documentClient,
    now: () => new Date("2026-08-13T09:00:00Z"),
  });

  const first = await handler(apiEvent("POST", "/visit"));
  const second = await handler(apiEvent("POST", "/visit"));
  const third = await handler(apiEvent("POST", "/visit"));

  assert.deepEqual(responseBody(first), { count: 13, counted: true });
  assert.deepEqual(responseBody(second), { count: 13, counted: false });
  assert.deepEqual(responseBody(third), { count: 13, counted: false });
  assert.equal(table.items.get("total")?.count, 13);
  assert.equal(
    table.commands.filter((command) => command instanceof UpdateCommand).length,
    1,
    "the total was written more than once",
  );
});

test("a different address on the same day counts separately", async () => {
  const table = fakeTable(12);
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: table.documentClient,
    now: () => new Date("2026-08-13T09:00:00Z"),
  });

  await handler(apiEvent("POST", "/visit", "203.0.113.7"));
  const other = await handler(apiEvent("POST", "/visit", "198.51.100.4"));

  assert.deepEqual(responseBody(other), { count: 14, counted: true });
});

test("the same address counts again the next day", async () => {
  const table = fakeTable(12);
  let today = "2026-08-13T09:00:00Z";
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: table.documentClient,
    now: () => new Date(today),
  });

  await handler(apiEvent("POST", "/visit"));
  await handler(apiEvent("POST", "/visit"));

  today = "2026-08-14T09:00:00Z";
  const tomorrow = await handler(apiEvent("POST", "/visit"));

  assert.deepEqual(responseBody(tomorrow), { count: 14, counted: true });
});

test("the stored marker holds no readable address and expires", async () => {
  const table = fakeTable(12);
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: table.documentClient,
    hashSalt: "test-salt",
    now: () => new Date("2026-08-13T09:00:00Z"),
  });

  await handler(apiEvent("POST", "/visit", "203.0.113.7"));

  const marker = [...table.items.values()].find(
    (item) => item.counter_id !== "total",
  );

  assert.ok(marker, "no visit marker was written");
  assert.doesNotMatch(
    JSON.stringify(marker),
    /203\.0\.113\.7/,
    "the source address was stored in the table",
  );
  assert.match(marker.counter_id as string, /^visit#2026-08-13#[0-9a-f]{32}$/);
  assert.equal(typeof marker.ttl, "number");
  assert.ok(
    (marker.ttl as number) > Date.parse("2026-08-13T09:00:00Z") / 1000,
    "the marker expires in the past",
  );
});

test("the salt changes the marker for the same address and day", async () => {
  const markerFor = async (hashSalt: string) => {
    const table = fakeTable(12);
    const handler = createVisitorHandler({
      tableName: "visitor-table",
      documentClient: table.documentClient,
      hashSalt,
      now: () => new Date("2026-08-13T09:00:00Z"),
    });

    await handler(apiEvent("POST", "/visit"));

    return [...table.items.keys()].find((key) => key !== "total");
  };

  assert.notEqual(await markerFor("one-salt"), await markerFor("other-salt"));
});

/*
  The Lambda ships through CI on a push to src/, while the table's TTL setting
  and the role's dynamodb:PutItem live in Terraform and are applied by hand. If
  the code lands first, every visit hits a permission error on the claim. That
  has to keep serving traffic, so it falls back to the behaviour this replaced.
*/
test("counting continues when the deduplication write is refused", async () => {
  const table = fakeTable(12);
  const handler = createVisitorHandler({
    tableName: "visitor-table",
    documentClient: {
      async send(command) {
        if (command instanceof PutCommand) {
          const denied = new Error("User is not authorized to perform PutItem");
          denied.name = "AccessDeniedException";
          throw denied;
        }

        return table.documentClient.send(command);
      },
    },
  });

  const first = await handler(apiEvent("POST", "/visit"));
  const second = await handler(apiEvent("POST", "/visit"));

  assert.equal(first.statusCode, 200);
  assert.deepEqual(responseBody(first), { count: 13, counted: true });
  assert.deepEqual(responseBody(second), { count: 14, counted: true });
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
