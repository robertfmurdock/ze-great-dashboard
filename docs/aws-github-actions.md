# Deploy from GitHub Actions

Add CI only after the [manual AWS deployment](aws-setup.md) works. This workflow packages the board,
uploads the Lambda artifact, and updates the private application stack. It does not create or test a
gateway unless you add a consumer-specific step.

## Repository inputs

Check in:

- `package.json` and its lockfile with an exact AWS package version.
- `dashboard-bootstrap.json`.
- `aws-dashboard-parameters.json`.
- `board.yaml`.

The administrator's `bootstrap verify` output provides two non-secret role ARNs. Add them as
variables on the protected GitHub Environment named by `dashboard-bootstrap.json`:

- `AWS_DEPLOY_ROLE_ARN`
- `AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN`

Do not store long-lived AWS access keys in GitHub.

## Workflow

Replace the Region, stack name, and Environment name below:

```yaml
name: Deploy dashboard

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    env:
      AWS_REGION: us-east-1
      STACK_NAME: team-dashboard
      AWS_DEPLOY_ROLE_ARN: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
      AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN: ${{ vars.AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN }}

    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Assume the dashboard deploy role
        uses: aws-actions/configure-aws-credentials@v6.2.3
        with:
          role-to-assume: ${{ env.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Check bootstrap
        run: npm exec -- ze-great-dashboard-aws bootstrap check --config dashboard-bootstrap.json --format text

      - name: Package and deploy
        shell: bash
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
            --role-arn "$AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN" \
            --region "$AWS_REGION" \
            --capabilities CAPABILITY_NAMED_IAM \
            --parameter-overrides file://aws-dashboard-parameters.json \
            --no-fail-on-empty-changeset \
            --no-cli-pager
```

The GitHub OIDC role can upload only to the configured artifact prefix, operate only the configured
application stack, and pass only the reviewed core execution role.

## Optional gateway check

Add a health check only when the protected gateway is reachable from the runner. If the workflow
must discover an endpoint from a gateway stack, configure that exact stack with
`--consumer-gateway-stack` during bootstrap and review the GitHub OIDC stack update first. That
option grants only `cloudformation:DescribeStacks`; it does not grant gateway access or bypass its
authentication.

For occasional CloudFormation resource-drift audits, run `bootstrap check --resource-drift` in a
manual or scheduled job rather than slowing every deployment.
