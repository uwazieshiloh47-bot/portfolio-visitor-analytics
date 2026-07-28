# Architecture: Version 1

## Request flow

```text
1. A client sends POST /visit
2. API Gateway matches the route
3. API Gateway invokes the Lambda function
4. Lambda atomically increments a DynamoDB item
5. DynamoDB returns the updated value
6. Lambda returns JSON through API Gateway
7. CloudWatch records the Lambda logs
```

Example response:

```json
{
  "count": 1
}
```

## Important mental models

### API Gateway is the front door

It understands HTTP concepts such as methods and paths. It does not contain
the visitor-counting business logic.

### Lambda is temporary compute

AWS starts the function when it is needed. Memory inside one invocation
cannot be trusted to exist for the next invocation, so the count cannot live
in a normal in-memory variable.

### DynamoDB is durable state

It stores the value between requests. The increment must be atomic so that
two simultaneous visits do not overwrite one another.

### IAM controls service-to-service access

The Lambda execution role will be allowed to update only the required
DynamoDB table and write logs. API Gateway will be allowed to invoke the
Lambda function.

## Deferred decisions

These are intentionally postponed:

- Frontend framework and chart library
- Detailed analytics event schema
- Custom domain and CDN
- Authentication for the admin dashboard
- WAF and bot-detection strategy
- CI/CD implementation
- Multi-environment deployment

Postponing them keeps the first debugging surface small.
