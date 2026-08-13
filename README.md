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

The repository now contains monitoring and continuous validation, but those
features are supporting infrastructure rather than proof that the request
flow works. Deployment automation and advanced traffic protection remain
deferred until this small request flow is deployed, verified, and understood.

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

Create the Lambda deployment ZIP after all checks pass:

```powershell
.\scripts\npm-local.ps1 run package:lambda
```

The resulting `.artifacts/portfolio-visitor-api-dev.zip` contains a bundled
`index.mjs`. Configure the Lambda handler as `index.handler`.

If local PowerShell scripts are disabled, run the packaging command without
changing the machine-wide execution policy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\npm-local.ps1 run package:lambda
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
- [x] Install and verify Terraform.
- [x] Create one DynamoDB table manually.
- [x] Create and test one Lambda function manually.
- [ ] Connect API Gateway to Lambda.
- [ ] Call the API and verify the DynamoDB value changes.
- [x] Inspect the request in CloudWatch logs.
- [ ] Delete the manual learning resources.
- [ ] Rebuild the same system with Terraform.
- [ ] Add the analytics dashboard.
- [ ] Add monitoring, security controls, and CI/CD.

Repository implementation is complete for the unchecked cloud milestones:
Terraform defines the API integration, monitoring, dashboard, and baseline
security controls, while GitHub Actions defines continuous validation (not
automatic deployment). The
checkboxes remain open until the resources are deployed and verified in AWS.

## What the counter means

One visit is one source address on one UTC day. The total is the running sum of
those, so someone who comes back next week adds a second visit, and someone who
refreshes ten times this afternoon adds none.

`POST /visit` enforces that server-side. It first writes a marker item keyed by
the day and a salted hash of the caller's address, conditional on that key not
already existing. The write succeeding means this is the day's first request
from that address, and only then does the total increment. The write failing
its condition means the day is already counted, so the API returns the current
total untouched. Markers carry a TTL and DynamoDB deletes them.

The frontend still asks once per browser tab session and uses `GET /count`
afterwards, but that is now an optimisation rather than the mechanism. Losing
it - a new tab, a second browser, blocked storage - no longer inflates
anything.

What this still cannot do is turn addresses into people. An office or a
household behind one address counts once; a phone moving between wifi and
cellular counts twice. A bot on a fresh address counts. It is a defensible
floor on real traffic, not verified analytics.

The table holds the total and the unexpired markers. It never holds an address:
the digest covers the salt, the day and the address, so the same visitor is
unlinkable across days and the stored token cannot be reversed without the
Lambda's environment. Raw addresses appear only in API Gateway access logs,
which expire on the configured retention period, 14 days by default.

Exact-origin CORS limits which browser frontends can read and invoke the API
from JavaScript, but CORS is not authentication and does not stop scripts from
calling the public endpoint.

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

### DynamoDB checkpoint

- Table: `portfolio-visitor-counter-dev`
- Capacity mode: on-demand
- Partition key: `counter_id` (String)
- Sort key: none
- Initial item: `counter_id = "total"`, `count = 0` (Number)
- Encryption: AWS-owned key
- Deletion protection: off for the disposable manual-learning resource
- Tags: `Project = PortfolioVisitorAnalytics`, `Environment = dev`

The table is persistent, but the Lambda execution role still cannot read or
update it. That permission will be added separately using least privilege.

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
Deployment and manual-resource adoption instructions are in
[docs/deployment.md](docs/deployment.md).

## Infrastructure validation

The complete AWS stack is defined under `infra/`. Before deploying, copy
`infra/terraform.tfvars.example` to `infra/terraform.tfvars` and replace the
placeholder with the exact origin of the portfolio frontend.

Terraform state is stored remotely in the private, versioned S3 bucket
`shiloh-terraform-state-482311061712` under the key
`portfolio-visitor-counter/dev/terraform.tfstate`. Authenticate the local shell
before running commands that read the backend or AWS provider:

```powershell
aws sso login --profile portfolio-dev
$env:AWS_PROFILE = "portfolio-dev"
terraform -chdir=infra fmt -check
terraform -chdir=infra init
terraform -chdir=infra validate
terraform -chdir=infra plan
```

The CI workflow runs application checks, creates the deployment bundle, and
verifies its contents, audits production dependencies for high-severity
findings, and validates Terraform on pushes to `main` and on pull requests. It
uses `terraform init -backend=false`, so CI validation does not require access
to the remote state. It does not deploy to AWS.

## GitHub deployment

`.github/workflows/deploy.yml` packages and deploys only the Lambda application
code. It authenticates with GitHub OIDC and a role restricted to the existing
visitor Lambda, then runs the live API smoke test. Infrastructure changes remain
manual Terraform operations and are not authorized through this role.

The workflow deploys automatically when production Lambda source, packaging,
dependencies, TypeScript configuration, smoke-test logic, or the deployment
workflow itself changes on `main`. Documentation, test-only, and Terraform-only
changes do not redeploy the Lambda. The following repository variables provide
its non-secret deployment configuration:

- `API_URL`
- `AWS_REGION`
- `AWS_ROLE_ARN`
- `LAMBDA_FUNCTION_NAME`

For a manual redeployment, use the repository's Actions tab, select **Deploy
visitor counter to AWS**, choose `main`, and select **Run workflow**. Every
successful automatic or manual deployment runs one real `POST /visit` smoke
test, so it increments the counter once.
