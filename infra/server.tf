# The server: a Lambda function behind a Function URL.
#
# No API Gateway. There is one route surface, no request transformation wanted, and the design's
# whole posture is "small and boring". A Function URL is the smallest thing that serves HTTP.

resource "aws_iam_role" "server" {
  name               = "${var.name}-server"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Logs and nothing else. The server stores nothing, reads no AWS resource, and holds its
# credentials in environment variables — so it has no reason to hold any other AWS permission.
resource "aws_iam_role_policy_attachment" "server_logs" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "server" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = 14
}

# A placeholder so `terraform apply` can create the function before any build exists. CI replaces
# the code on every deploy, which is why Terraform ignores changes to it: otherwise every plan
# after a deploy would want to revert production to this stub.
data "archive_file" "placeholder" {
  type                    = "zip"
  output_path             = "${path.module}/.placeholder.zip"
  source_content          = "export const handler = async () => ({ statusCode: 503, body: 'Not deployed yet.' })\n"
  source_content_filename = "index.mjs"
}

resource "aws_lambda_function" "server" {
  function_name = var.name
  role          = aws_iam_role.server.arn
  runtime       = "nodejs22.x"
  handler       = "index.handler"
  architectures = ["arm64"]

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  # Generous enough to fetch the template on a cold start over a slow link; the work per request is
  # a string replacement.
  timeout     = 10
  memory_size = 256

  environment {
    variables = {
      # CI overwrites this on every deploy — it is the one variable that selects a client version.
      ASSET_PATH = var.initial_asset_path
      HOST       = "0.0.0.0"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.server_logs,
    aws_cloudwatch_log_group.server,
  ]

  lifecycle {
    # Code and ASSET_PATH are CI's to own. Terraform owns the shape of the function, not its
    # contents — which is what keeps a deploy from being a terraform apply.
    ignore_changes = [filename, source_code_hash, environment]
  }
}

resource "aws_lambda_function_url" "server" {
  function_name = aws_lambda_function.server.function_name

  # Public. The board is meant to be on a wall, and the doc's auth model is a board-config `auth`
  # section handled in the app — not IAM. Until that section exists, the server logs a warning
  # about being reachable without auth, which is accurate.
  authorization_type = "NONE"
}
