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

  return body;
}

/*
  The counter records one visit per source address per day, so this runner may
  arrive already counted - a redeploy on the same day, or a shared NAT address.
  That makes the first POST's effect genuinely unknowable from out here, and
  asserting it incremented would fail for a correct API.

  What is always true is the second POST: whatever the first one did, the total
  must not move again. That is the whole contract, and it is the assertion the
  previous `before + 1` check could not make.
*/
const { count: before } = await request("/count");
const first = await request("/visit", { method: "POST" });
const second = await request("/visit", { method: "POST" });
const { count: after } = await request("/count");

assert.ok(
  first.count === before || first.count === before + 1,
  `POST /visit moved the total from ${before} to ${first.count}.`,
);
assert.equal(
  first.counted,
  first.count === before + 1,
  "The reported `counted` flag disagrees with the total that came back.",
);
assert.equal(
  second.count,
  first.count,
  "A second POST /visit from this address counted again on the same day.",
);
assert.equal(second.counted, false, "A repeat visit reported itself as new.");
assert.equal(after, second.count, "GET /count did not return the stored value.");

console.log(
  JSON.stringify({
    message: "api_smoke_test_passed",
    before,
    first: first.count,
    counted: first.counted,
    afterRepeat: after,
  }),
);
