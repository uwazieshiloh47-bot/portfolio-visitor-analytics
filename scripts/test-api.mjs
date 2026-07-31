import assert from "node:assert/strict";

const apiUrl = process.env.API_URL?.replace(/\/$/, "");

if (!apiUrl) {
  throw new Error("Set API_URL to the deployed API Gateway base URL.");
}

async function request(path, init) {
  const response = await fetch(`${apiUrl}${path}`, init);
  const body = await response.json();

  assert.equal(
    response.status,
    200,
    `${init?.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`,
  );
  assert.equal(typeof body.count, "number");

  return body.count;
}

const before = await request("/count");
const incremented = await request("/visit", { method: "POST" });
const after = await request("/count");

assert.equal(incremented, before + 1, "POST /visit did not increment by one.");
assert.equal(after, incremented, "GET /count did not return the updated value.");

console.log(
  JSON.stringify({
    message: "api_smoke_test_passed",
    before,
    incremented,
    after,
  }),
);
