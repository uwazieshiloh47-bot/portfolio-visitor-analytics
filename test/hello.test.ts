import assert from "node:assert/strict";
import test from "node:test";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { handler } from "../src/handlers/hello.js";

test("the hello handler returns an HTTP 200 JSON response", async () => {
  const event = {
    requestContext: {
      requestId: "local-test-request",
    },
  } as APIGatewayProxyEventV2;

  const response = await handler(event);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.["content-type"], "application/json");
  assert.deepEqual(JSON.parse(response.body ?? "{}"), {
    message: "Visitor API is alive",
  });
});
