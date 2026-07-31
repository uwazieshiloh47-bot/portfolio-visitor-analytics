variable "aws_region" {
  description = "AWS region in which to create the visitor API."
  type        = string
  default     = "us-east-2"
}

variable "project_name" {
  description = "Name used for resource tags and CloudWatch metrics."
  type        = string
  default     = "PortfolioVisitorAnalytics"
}

variable "environment" {
  description = "Short deployment environment name."
  type        = string
  default     = "dev"
}

variable "allowed_origins" {
  description = "Exact frontend origins allowed to call the HTTP API."
  type        = list(string)

  validation {
    condition     = length(var.allowed_origins) > 0 && !contains(var.allowed_origins, "*")
    error_message = "Provide at least one exact frontend origin; wildcard CORS is intentionally prohibited."
  }
}

variable "lambda_zip_path" {
  description = "Path to the packaged Lambda ZIP, relative to the infra directory."
  type        = string
  default     = "../.artifacts/portfolio-visitor-api-dev.zip"
}

variable "log_retention_days" {
  description = "CloudWatch log retention period."
  type        = number
  default     = 14
}

variable "alarm_email" {
  description = "Optional email address for alarm notifications. Confirmation is required."
  type        = string
  default     = ""
}
