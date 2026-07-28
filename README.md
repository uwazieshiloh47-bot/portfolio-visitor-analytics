# Portfolio Visitor Analytics

A learning-first cloud engineering project that records portfolio visits and
returns a visitor count through a serverless API.

## First working goal

Send an HTTP request and follow it through this path:

```text
Client -> API Gateway -> Lambda -> DynamoDB
                                  |
Client <- JSON response <---------+
```

The first version has only two operations:

- `POST /visit` increments the visitor count.
- `GET /count` returns the current count.

No dashboard, CI/CD pipeline, or advanced security is included until this
small request flow works and can be explained.

## Local development

Node.js is currently stored as a project-local portable tool because the
Windows sandbox cannot perform a machine-wide installation.

Run the complete local check from PowerShell:

```powershell
.\scripts\npm-local.ps1 run check
```

Manually invoke the compiled hello handler:

```powershell
.\scripts\npm-local.ps1 run invoke:hello
```

The complete check performs three separate jobs:

1. Type-check the TypeScript without producing files.
2. Compile TypeScript into JavaScript under `dist/`.
3. Execute the automated tests with Node's test runner.

## Why each service exists

| Component | Responsibility |
| --- | --- |
| API Gateway | Provides public HTTP routes and forwards requests to Lambda. |
| Lambda | Runs the visitor-counting application code on demand. |
| DynamoDB | Stores the count so it survives between Lambda invocations. |
| CloudWatch | Captures logs and later provides metrics and alarms. |
| Terraform | Recreates the cloud resources consistently from code. |

## Learning milestones

- [x] Secure the AWS account and configure a cost budget.
- [x] Install and verify Node.js.
- [ ] Install and verify the AWS CLI.
- [ ] Install and verify Terraform.
- [ ] Create one DynamoDB table manually.
- [x] Create and test one Lambda function manually.
- [ ] Connect API Gateway to Lambda.
- [ ] Call the API and verify the DynamoDB value changes.
- [x] Inspect the request in CloudWatch logs.
- [ ] Delete the manual learning resources.
- [ ] Rebuild the same system with Terraform.
- [ ] Add the analytics dashboard.
- [ ] Add monitoring, security controls, and CI/CD.

## Current AWS checkpoint

- Region: `us-east-2` (US East, Ohio)
- Function: `portfolio-visitor-api-dev`
- Runtime: `nodejs24.x`
- Architecture: `x86_64`
- Handler: `index.handler`
- Direct Lambda test: succeeded with HTTP status `200`
- CloudWatch log group: `/aws/lambda/portfolio-visitor-api-dev`
- Structured application log: `request_received`
- Current log retention: never expires

The function currently uses an AWS-created basic execution role that can write
CloudWatch logs. It does not yet have permission to access DynamoDB.

## Tutor-mode rule

For every resource, be able to answer:

1. What problem does it solve?
2. What sends data into it?
3. What does it return or change?
4. What permissions does it need?
5. How can it create cost?
6. How is it observed and deleted?

See [docs/architecture.md](docs/architecture.md) for the request flow and
[docs/learning-log.md](docs/learning-log.md) for short milestone notes.
