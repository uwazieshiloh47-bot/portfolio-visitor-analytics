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

## Version 1 counting semantics

The durable value is the number of successful `POST /visit` requests, not the
number of unique visitors. The portfolio frontend normally sends one such
request per browser tab session and uses `GET /count` for later loads in that
tab. A successful response sets the tab-scoped session marker.

The API cannot distinguish a person from a new tab, browser, device, unavailable
browser storage, bot, monitoring probe, or direct scripted request. DynamoDB
stores only the aggregate count. API Gateway access logs include source IP and
basic request details for the configured retention period.

CORS is a browser policy, not an access-control boundary. The exact-origin
configuration prevents unapproved browser origins from reading the API
through JavaScript, but it cannot prevent a non-browser client from calling
the public endpoint. API throttling limits bursts but does not make the count
trustworthy analytics.

Before the value is described as unique or verified traffic, define the
desired unit—page view, session, or visitor—and add appropriate deduplication
and abuse controls.

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
