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

The first deployment remains a manual `workflow_dispatch` run from `main`.
After the manual run succeeds, push-based deployment can be enabled for changes
to the Lambda source, package scripts, dependencies, and deployment workflow.

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

The test reads the count, increments it once, and confirms the following read
returns the incremented value. Inspect the Lambda and API Gateway log groups
and the dashboard URL from the Terraform outputs afterward.

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
