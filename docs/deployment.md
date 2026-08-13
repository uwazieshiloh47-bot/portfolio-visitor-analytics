# Deployment Runbook

## Prerequisites

- Terraform 1.8 or later
- The AWS CLI profile `portfolio-dev` with access to account `482311061712`
- The exact deployed portfolio origin, such as `https://www.example.com`

Authenticate and expose the profile to Terraform in the current PowerShell
session:

```powershell
aws sso login --profile portfolio-dev
$env:AWS_PROFILE = "portfolio-dev"
```

It has to be this profile. Newer AWS CLI versions can sign in a plain IAM user
with `aws login`, which is enough for `aws` commands but not for Terraform:
`login_session` is a CLI-only credential type, so Terraform's SDK ignores it,
falls back to the SSO token cache, and reports "No valid credential sources
found" while the CLI is working perfectly beside it.

Terraform stores state in the private S3 bucket
`shiloh-terraform-state-482311061712` under
`portfolio-visitor-counter/dev/terraform.tfstate`. Bucket versioning provides
state recovery, and the S3 lockfile prevents concurrent Terraform operations.

Create the Lambda artifact:

```powershell
.\scripts\npm-local.ps1 run package:lambda
```

Create `infra/terraform.tfvars` from the example and replace the placeholder
origin. Do not commit this file.

## Adopt the manual learning resources

The manual Lambda function, DynamoDB table, and Lambda log group use the same
names as the Terraform resources. Import them before the first plan so
Terraform adopts them instead of trying to create duplicates:

```powershell
terraform -chdir=infra init
terraform -chdir=infra import aws_dynamodb_table.visitor_counter portfolio-visitor-counter-dev
terraform -chdir=infra import aws_lambda_function.visitor portfolio-visitor-api-dev
terraform -chdir=infra import aws_cloudwatch_log_group.lambda /aws/lambda/portfolio-visitor-api-dev
```

Review imported resources with `terraform plan`. Terraform will propose
changing the Lambda execution role to the least-privilege role in this stack.
It may also enable DynamoDB point-in-time recovery and set log retention.

Never apply without reading the complete plan:

```powershell
terraform -chdir=infra plan -out=visitor.tfplan
terraform -chdir=infra apply visitor.tfplan
```

## Bootstrap the GitHub deployment role

`infra/github-actions.tf` defines a least-privilege OIDC role for the immutable
identity of the repository's `main` branch. The role can update and inspect only
the existing visitor Lambda function. It cannot change API Gateway, DynamoDB,
CloudWatch, IAM, or Terraform state.

Review and apply the Terraform plan locally first. Then copy these outputs and
known values into GitHub repository variables:

```powershell
gh variable set AWS_REGION --body "us-east-2"
gh variable set AWS_ROLE_ARN --body (terraform -chdir=infra output -raw github_actions_deploy_role_arn)
gh variable set API_URL --body (terraform -chdir=infra output -raw api_url)
gh variable set LAMBDA_FUNCTION_NAME --body (terraform -chdir=infra output -raw lambda_function_name)
```

The workflow supports manual `workflow_dispatch` runs and automatic deployment
from `main` when Lambda source, packaging, dependencies, TypeScript
configuration, smoke-test logic, or the deployment workflow changes. Test-only,
documentation-only, and Terraform-only changes do not deploy application code.

## Verify the request flow

Get the API URL:

```powershell
terraform -chdir=infra output -raw api_url
```

Run the smoke test:

```powershell
$env:API_URL = terraform -chdir=infra output -raw api_url
.\scripts\npm-local.ps1 run test:api
```

The test reads the count, posts a visit twice, and confirms the second post did
not move the total. It deliberately does not assert that the first post
incremented: the counter allows one visit per address per day, so a machine
that already visited today is correctly refused, and demanding an increment
would fail against a working API.

Inspect the Lambda and API Gateway log groups and the dashboard URL from the
Terraform outputs afterward. A `deduplication_unavailable` entry in the Lambda
log means the claim write failed for something other than its condition -
usually the role missing `dynamodb:PutItem` - and the function is counting
every request until that is fixed.

## The frontend depends on the generated API URL

The portfolio hardcodes this API's base URL in `visitor-counter.js`. API
Gateway generates the ID, so recreating the API produces a different URL and
the portfolio silently stops showing the count — the fetch fails, the counter
stays hidden, and the page looks completely normal.

After any change that recreates `aws_apigatewayv2_api.visitor`, copy the new
value across:

```powershell
terraform -chdir=infra output -raw api_url
```

Then update `API_BASE_URL` in the portfolio repo and push.

A custom domain mapped to the API removes this step for good, since the
hostname then stays fixed no matter how often the API is rebuilt.

## Reset the counter to zero

Do this after a period of heavy testing, or immediately before announcing the
site somewhere new. The count is only worth showing if it starts from a moment
you can point at.

Record what it was first, in case the number is worth keeping:

```powershell
$apiBaseUrl = terraform -chdir=infra output -raw api_url
Invoke-RestMethod -Uri "$apiBaseUrl/count" -Method Get
```

Then zero it:

```powershell
aws dynamodb update-item `
    --table-name portfolio-visitor-counter-dev `
    --key "counter_id={S=total}" `
    --update-expression "SET #count = :zero" `
    --expression-attribute-names "#count=count" `
    --expression-attribute-values ":zero={N=0}" `
    --return-values ALL_NEW `
    --region us-east-2 `
    --profile portfolio-dev
```

The returned attributes should show `"count": { "N": "0" }`. Confirm through the
API, which reads without incrementing:

```powershell
Invoke-RestMethod -Uri "$apiBaseUrl/count" -Method Get
```

This writes the total and nothing else. The per-day visit markers are left
alone deliberately: an address that already counted today stays counted, so
resetting cannot be used to make one machine count repeatedly.

## Cleanup

To avoid accidental data loss, inspect the destroy plan before approval:

```powershell
terraform -chdir=infra plan -destroy
terraform -chdir=infra destroy
```

Destroying the stack deletes the DynamoDB table and its counter. Point-in-time
recovery does not preserve a table after deletion.

The table carries `lifecycle { prevent_destroy = true }`, so a destroy fails
rather than silently removing the count. Comment that block out first when you
genuinely intend to tear the stack down.
