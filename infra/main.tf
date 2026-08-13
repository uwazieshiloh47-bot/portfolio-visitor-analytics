locals {
  resource_prefix      = "portfolio-visitor-${var.environment}"
  lambda_function_name = "portfolio-visitor-api-${var.environment}"
  lambda_zip           = abspath("${path.module}/${var.lambda_zip_path}")
}

resource "aws_dynamodb_table" "visitor_counter" {
  name         = "portfolio-visitor-counter-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "counter_id"

  attribute {
    name = "counter_id"
    type = "S"
  }

  # Alongside the running total, the table holds one short-lived marker per
  # source address per day, which is how a refresh stops counting as a new
  # visit. They are the only items here meant to be thrown away, and DynamoDB
  # does that for free. Without this the markers accumulate forever and the
  # deduplication window silently becomes "since the beginning of time".
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = true
  }

  # The visitor count lives only here, and point-in-time recovery does not
  # survive deletion of the table itself. This makes `terraform destroy` fail
  # loudly rather than quietly discarding it. To tear the stack down on
  # purpose, comment this block out first - the point is that the decision has
  # to be deliberate.
  lifecycle {
    prevent_destroy = true
  }
}

# Salt for the per-day visit markers. The handler hashes the source IP with
# this before it becomes a key, so the table never holds an address in a form
# anyone can read back. IPv4 is small enough to brute-force an unsalted digest,
# which is the entire reason this exists rather than hashing the address alone.
#
# It lives in Terraform state, which is encrypted in S3, and is generated once
# and kept. Replacing it re-keys every marker, so the day it changes counts
# some visitors twice; that is the only cost of rotating it.
resource "random_password" "visit_hash_salt" {
  length  = 48
  special = false
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.lambda_function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/apigateway/${local.resource_prefix}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "lambda" {
  name = "${local.resource_prefix}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  name = "${local.resource_prefix}-lambda-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CounterTableAccess"
        Effect = "Allow"
        # PutItem is for the per-day visit markers, and only ever as a
        # conditional write. The function still has no way to delete or scan.
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.visitor_counter.arn
      },
      {
        Sid      = "WriteFunctionLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.lambda.arn}:*"
      }
    ]
  })
}

resource "aws_lambda_function" "visitor" {
  function_name = local.lambda_function_name
  description   = "Returns and atomically increments the portfolio visitor count."
  role          = aws_iam_role.lambda.arn
  filename      = local.lambda_zip
  handler       = "index.handler"
  runtime       = "nodejs24.x"
  architectures = ["x86_64"]
  memory_size   = 128
  timeout       = 5

  reserved_concurrent_executions = var.reserved_concurrency
  source_code_hash               = filebase64sha256(local.lambda_zip)

  environment {
    variables = {
      TABLE_NAME      = aws_dynamodb_table.visitor_counter.name
      ENVIRONMENT     = var.environment
      VISIT_HASH_SALT = random_password.visit_hash_salt.result
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda,
  ]
}

resource "aws_apigatewayv2_api" "visitor" {
  name          = "${local.resource_prefix}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["content-type"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_origins = var.allowed_origins
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "visitor" {
  api_id                 = aws_apigatewayv2_api.visitor.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.visitor.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 5000
}

resource "aws_apigatewayv2_route" "count" {
  api_id    = aws_apigatewayv2_api.visitor.id
  route_key = "GET /count"
  target    = "integrations/${aws_apigatewayv2_integration.visitor.id}"
}

resource "aws_apigatewayv2_route" "visit" {
  api_id    = aws_apigatewayv2_api.visitor.id
  route_key = "POST /visit"
  target    = "integrations/${aws_apigatewayv2_integration.visitor.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.visitor.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      sourceIp       = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      responseLength = "$context.responseLength"
    })
  }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.visitor.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.visitor.execution_arn}/*/*"
}
