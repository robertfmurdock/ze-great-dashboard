# The role GitHub Actions assumes via OIDC. No access keys anywhere, and nothing to rotate.
#
# The OIDC provider already exists in this account (shared with other projects), so it is looked up
# rather than created — creating a second one for the same issuer is an error.

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_role" "deploy" {
  name               = "ZeGreatDashboardDeploy"
  description        = "GitHub Actions deploy role for ${var.github_repository}"
  assume_role_policy = data.aws_iam_policy_document.deploy_assume.json
}

data "aws_iam_policy_document" "deploy_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Scoped to this repository. Without this condition any GitHub repository on earth could assume
    # the role, which is the well-known way to get this wrong.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:*"]
    }
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

# Exactly what a deploy does: write assets, update this one function. Notably absent is any ability
# to create infrastructure — CI publishing artifacts and CI provisioning are different privileges,
# and only one of them is needed here.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid    = "PublishAssets"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:DeleteObject",
    ]
    resources = [
      aws_s3_bucket.assets.arn,
      "${aws_s3_bucket.assets.arn}/*",
    ]
  }

  statement {
    sid    = "UpdateServer"
    effect = "Allow"
    actions = [
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
    ]
    resources = [aws_lambda_function.server.arn]
  }
}
