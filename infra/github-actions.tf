locals {
  github_repository_owner    = "uwazieshiloh47-bot"
  github_repository_owner_id = "258136748"
  github_repository_name     = "portfolio-visitor-analytics"
  github_repository_id       = "1324276777"
  github_deployment_branch   = "main"

  # GitHub's immutable owner and repository IDs prevent a repository rename
  # or transfer from silently inheriting this AWS trust relationship.
  github_oidc_subject = "repo:${local.github_repository_owner}@${local.github_repository_owner_id}/${local.github_repository_name}@${local.github_repository_id}:ref:refs/heads/${local.github_deployment_branch}"
}

data "aws_caller_identity" "current" {}

# The AWS account already has this provider because the portfolio deployment
# uses it. Referencing it avoids trying to create a duplicate account resource.
data "aws_iam_openid_connect_provider" "github_actions" {
  arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_actions_trust" {
  statement {
    sid     = "AllowGitHubMainBranch"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type = "Federated"
      identifiers = [
        data.aws_iam_openid_connect_provider.github_actions.arn,
      ]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.github_oidc_subject]
    }
  }
}

resource "aws_iam_role" "github_actions_deploy" {
  name                 = "${local.resource_prefix}-github-deploy"
  description          = "Allows the counter main branch to deploy code to its existing Lambda function."
  assume_role_policy   = data.aws_iam_policy_document.github_actions_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_actions_deploy" {
  statement {
    sid    = "DeployVisitorLambdaCode"
    effect = "Allow"

    actions = [
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:UpdateFunctionCode",
    ]

    resources = [
      aws_lambda_function.visitor.arn,
    ]
  }
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  name   = "visitor-lambda-code-deployment"
  role   = aws_iam_role.github_actions_deploy.id
  policy = data.aws_iam_policy_document.github_actions_deploy.json
}

output "github_actions_deploy_role_arn" {
  description = "Least-privilege role assumed by the manual counter deployment workflow."
  value       = aws_iam_role.github_actions_deploy.arn
}
