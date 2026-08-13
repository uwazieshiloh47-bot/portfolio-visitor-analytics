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
- Automated deployment
- Multi-environment deployment

Postponing them keeps the first debugging surface small.

## Version 2 counting semantics

The unit is one source address per UTC day, and the durable value is the
running sum of those. Version 1 counted successful `POST /visit` requests
instead, which meant the number measured how often the site was exercised
rather than how often it was read: a fortnight of access logs showed 1,412
recorded visits, of which four addresses accounted for 1,266, and the quiet
days in between averaged five.

Deduplication is a conditional write, not a check-then-write. `POST /visit`
puts a marker item keyed `visit#<day>#<digest>` with
`attribute_not_exists(counter_id)`; the condition failing is the signal that
the day is already counted. Two simultaneous requests from one address cannot
both win, because DynamoDB resolves the condition, and no read precedes the
write to go stale.

The claim is written before the total moves. A failure between the two loses a
visit, where the reverse order would double-count a client retry. Undercounting
is the correct bias for a number published on a portfolio.

A failed claim that is *not* a condition failure - a missing TTL setting, a
role one apply behind the code - falls back to incrementing and logs
`deduplication_unavailable`. The Lambda deploys from CI on a push to `src/`
while the table and role are applied by hand, so the code can legitimately
arrive first, and degrading to version 1 semantics beats returning 500 to every
visitor.

The digest covers the salt, the day and the address, so markers cannot be
reversed to an address without the Lambda's environment, and the same visitor
produces unrelated tokens on different days. Markers carry a TTL. Raw addresses
live only in API Gateway access logs for the configured retention period.

An address is still not a person. Shared egress undercounts, address rotation
overcounts, and a bot on a fresh address counts. The value is a floor on real
traffic rather than verified analytics.

CORS is a browser policy, not an access-control boundary. The exact-origin
configuration prevents unapproved browser origins from reading the API
through JavaScript, but it cannot prevent a non-browser client from calling
the public endpoint. API throttling limits bursts.

## Infrastructure controls

The Terraform stack under `infra/` now defines:

- An on-demand, encrypted DynamoDB table with point-in-time recovery
- A Node.js 24 Lambda function with five reserved concurrent executions
- A least-privilege role limited to the counter table and function log group
- Explicit `GET /count` and `POST /visit` HTTP API routes
- Exact-origin CORS validation and API throttling
- Fourteen-day Lambda and API Gateway log retention
- Lambda-error and API-5xx alarms
- A CloudWatch dashboard for visitor count, traffic, errors, latency, and
  DynamoDB throttling

`POST /visit` writes the latest counter value using CloudWatch Embedded Metric
Format. CloudWatch extracts this structured log into the custom
`PortfolioVisitorAnalytics/VisitorCount` metric used by the dashboard.
