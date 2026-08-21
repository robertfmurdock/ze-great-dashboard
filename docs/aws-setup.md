# Deploy with the published AWS package

Before application deployment, an administrator must create the consumer-owned artifact bucket and
restricted roles using the [AWS bootstrap guide](aws-bootstrap.md). The application template is
private: it outputs a Lambda ARN/name for a customer-managed API Gateway, ALB, or other gateway;
it does not create a public Function URL.

Deploy a Ze Great Dashboard backend to AWS Lambda, then integrate the returned Lambda ARN through
the customer-managed gateway that meets your network and identity requirements.

## Prerequisites

You need:

- Node.js 22 or newer and npm.
- The AWS CLI and credentials that can upload to S3 and deploy CloudFormation resources.
- A private S3 bucket for Lambda artifacts.
- One AWS Region for the artifact bucket, Lambda function, and CloudFormation stack.
- `jq` for reading the generated release metadata.

Check the local tools and credentials before continuing:

```sh
node --version                 # 22.x or newer
npm --version
aws sts get-caller-identity
```

The examples use package version `1.2.3`. Pin an exact version in production.

## Install the package

Run this in a deployment project:

```sh
npm install --save-exact @continuous-excellence/ze-great-dashboard-aws@1.2.3
```

The package includes the CLI, Lambda runtime, and CloudFormation template. The matching client is
hosted on the project's public asset CDN at `https://public-assets.zegreatrob.com`; you do
not need a client asset bucket.

Before deploying, run the read-only setup doctor. It checks the local tools, AWS identity, parameter
compatibility, artifact bucket and Region, and the client hosted for the installed package version,
reporting every problem it finds in one run:

```sh
npx ze-great-dashboard-aws doctor \
  --parameters aws-dashboard-parameters.json \
  --region us-east-1
```

`--parameters` defaults to `aws-dashboard-parameters.json`. `--region` defaults to `AWS_REGION`,
then `AWS_DEFAULT_REGION`, then `us-east-1`. The doctor only makes read requests.

## Write a board configuration

Create `board.yaml` using the [board configuration guide](board-configuration.md). This guide
assumes the file contains one board.

## Create deployment parameters

Generate the settings for this environment:

```sh
npm exec -- ze-great-dashboard-aws parameters \
  --bootstrap-config dashboard-bootstrap.json \
  --output aws-dashboard-parameters.json
```

This reuses the checked-in bootstrap manifest from the [bootstrap guide](aws-bootstrap.md), including
the artifact bucket and dashboard function name, so the application’s `Name` remains compatible with
the restricted execution role. Commit `aws-dashboard-parameters.json`. See the
[CloudFormation template](../packages/aws/template.yml) for optional Lambda settings and their
defaults. Keep secrets out of this file.

## Package the Lambda release

Package the board:

```sh
npm exec -- ze-great-dashboard-aws package \
  --board-config board.yaml \
  --output aws-dashboard-release
```

The command validates the board and writes `lambda.zip`, `release.json`, and `template.yml` under
`aws-dashboard-release`. The generated template identifies this Lambda artifact and the matching
hosted client version.

Provider automation can also use `ze-great-dashboard-aws deploy`. Its `--version` defaults to the
installed package version and `--assets-dir` defaults to that package's bundled client. Explicit
values for either option continue to override those defaults.

Repository maintainers that host the matching immutable client separately can use the provider-only
asset step without changing a Lambda:

```sh
npm exec -- ze-great-dashboard-aws publish-assets \
  --assets-bucket my-dashboard-client-assets \
  --assets-base-url https://assets.example.com
```

The command publishes the installed package version under `dashboard/<version>`. It is not needed
for normal consumer deployments, which use the project's public asset CDN.

## Upload the Lambda artifact

Read the destination from the checked-in parameters and generated release metadata:

```sh
export AWS_REGION=us-east-1
export STACK_NAME=my-ze-great-dashboard

ARTIFACT_BUCKET="$(jq -er \
  '.[] | select(.ParameterKey == "LambdaArtifactBucket") | .ParameterValue' \
  aws-dashboard-parameters.json)"
ARTIFACT_KEY="$(jq -er '.artifactKey' aws-dashboard-release/release.json)"

aws s3 cp aws-dashboard-release/lambda.zip \
  "s3://${ARTIFACT_BUCKET}/${ARTIFACT_KEY}" \
  --region "$AWS_REGION"
```

## Deploy the CloudFormation stack

Deploy with the AWS CLI:

```sh
aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file aws-dashboard-release/template.yml \
  --region "$AWS_REGION" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides file://aws-dashboard-parameters.json \
  --no-fail-on-empty-changeset
```

The stack creates the Lambda function, log group, and execution role. It outputs `ServerFunctionArn`
and `ServerFunctionName` for an explicitly scoped gateway integration, plus `AssetPath`.

## Test the deployment

Test through the customer-managed gateway:

```sh
export FUNCTION_ARN="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ServerFunctionArn'].OutputValue" \
  --output text)"

# Configure a gateway permission scoped to "$FUNCTION_ARN", then use its protected health endpoint.
```

The application template intentionally grants no public invoke permission.

## Update a dashboard

To upgrade the package, install the new version, then package, upload, and deploy again:

```sh
npm install --save-exact @continuous-excellence/ze-great-dashboard-aws@1.2.4

export AWS_REGION=us-east-1
export STACK_NAME=my-ze-great-dashboard

npm exec -- ze-great-dashboard-aws package \
  --board-config board.yaml \
  --output aws-dashboard-release

ARTIFACT_BUCKET="$(jq -er \
  '.[] | select(.ParameterKey == "LambdaArtifactBucket") | .ParameterValue' \
  aws-dashboard-parameters.json)"
ARTIFACT_KEY="$(jq -er '.artifactKey' aws-dashboard-release/release.json)"

aws s3 cp aws-dashboard-release/lambda.zip \
  "s3://${ARTIFACT_BUCKET}/${ARTIFACT_KEY}" \
  --region "$AWS_REGION"

aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file aws-dashboard-release/template.yml \
  --region "$AWS_REGION" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides file://aws-dashboard-parameters.json \
  --no-fail-on-empty-changeset
```

Changing only `board.yaml` uses the same process; no package upgrade or parameter-file change is
required.

## GitHub Actions

Before adding the workflow, check in `package.json`, its lockfile, `board.yaml`, and
`aws-dashboard-parameters.json`. Create an AWS IAM role that trusts this repository through GitHub
OIDC and can upload to the artifact bucket and deploy the stack. Replace the Region, stack name,
and role ARN below.

This workflow packages, uploads, and deploys the private Lambda. Add a gateway-specific health check
only where the protected gateway is available to the runner:

```yaml
name: Deploy dashboard

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

env:
  AWS_REGION: us-east-1
  STACK_NAME: my-ze-great-dashboard
  AWS_DEPLOY_ROLE_ARN: arn:aws:iam::123456789012:role/my-dashboard-github-actions

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v7
      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v6.2.3
        with:
          role-to-assume: ${{ env.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}
      - name: Package and deploy
        run: |
          npm exec -- ze-great-dashboard-aws package \
            --board-config board.yaml \
            --output aws-dashboard-release
          artifact_bucket="$(jq -er \
            '.[] | select(.ParameterKey == "LambdaArtifactBucket") | .ParameterValue' \
            aws-dashboard-parameters.json)"
          artifact_key="$(jq -er '.artifactKey' aws-dashboard-release/release.json)"
          aws s3 cp aws-dashboard-release/lambda.zip \
            "s3://${artifact_bucket}/${artifact_key}" \
            --region "$AWS_REGION"
          aws cloudformation deploy \
            --stack-name "$STACK_NAME" \
            --template-file aws-dashboard-release/template.yml \
            --region "$AWS_REGION" \
            --capabilities CAPABILITY_IAM \
            --parameter-overrides file://aws-dashboard-parameters.json \
            --no-fail-on-empty-changeset
```

Use [GitHub OIDC for AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
with [the AWS credentials action](https://github.com/aws-actions/configure-aws-credentials), not
long-lived AWS keys in repository secrets.

## Runtime secrets

Board sources name credentials through `token_env`; never put credential values in `board.yaml` or
`aws-dashboard-parameters.json`. The included template does not populate arbitrary `token_env`
variables.

`SecretReference` is available for a runtime integration that reads a Secrets Manager secret. It
grants the Lambda role access to the secret and exposes its ARN as `SECRET_REFERENCE`.

Create the secret from a protected, untracked file:

```json
{ "GITHUB_TOKEN": "provided-by-your-secret-management-system" }
```

Upload it and delete the local copy when you no longer need it:

```sh
chmod 600 dashboard-secret.json
aws secretsmanager create-secret \
  --name my-ze-great-dashboard/runtime \
  --description 'Runtime credentials for my Ze Great Dashboard' \
  --secret-string file://dashboard-secret.json \
  --region "$AWS_REGION"
```

Add the ARN, not the value, to `aws-dashboard-parameters.json`:

```json
{
  "ParameterKey": "SecretReference",
  "ParameterValue": "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-ze-great-dashboard/runtime-example"
}
```

Use the ARN returned by `create-secret`. Your runtime integration must read the secret and map its
fields to the environment names used by `token_env` before the dashboard handles requests.

## Troubleshooting

- **Invalid board:** packaging validates the YAML; check the
  [board configuration guide](board-configuration.md).
- **Multiple boards:** use a file containing one board, or customize the template to set `BOARD`.
- **Missing assets:** confirm
  `https://public-assets.zegreatrob.com/dashboard/<version>/index.html` returns HTTPS 200.
- **Wrong `AssetBaseUrl`:** provide only the origin; the template adds `/dashboard/<version>`.
- **AWS access denied:** check `aws sts get-caller-identity`, region, and IAM permissions.
- **Node incompatibility:** use Node.js 22+ locally and the included `nodejs22.x` template runtime.

## Security notes

- The application template has no Function URL and no wildcard Lambda invoke permission.
- Do not put secrets in board YAML or `lambda.zip`.
- `token_env` names a runtime environment variable; the included template does not populate it.
