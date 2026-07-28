import { handler } from "../dist/src/handlers/hello.js";

const event = {
  requestContext: {
    requestId: "local-manual-invocation",
  },
};

const response = await handler(event);

console.log("Lambda response:");
console.log(JSON.stringify(response, null, 2));
