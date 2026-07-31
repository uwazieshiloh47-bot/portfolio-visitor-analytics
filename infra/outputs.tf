output "api_url" {
  description = "Base URL of the deployed visitor HTTP API."
  value       = aws_apigatewayv2_api.visitor.api_endpoint
}

output "lambda_function_name" {
  description = "Name of the deployed Lambda function."
  value       = aws_lambda_function.visitor.function_name
}

output "dynamodb_table_name" {
  description = "Name of the visitor counter table."
  value       = aws_dynamodb_table.visitor_counter.name
}

output "dashboard_url" {
  description = "AWS console URL for the CloudWatch dashboard."
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards/dashboard/${aws_cloudwatch_dashboard.visitor.dashboard_name}"
}
