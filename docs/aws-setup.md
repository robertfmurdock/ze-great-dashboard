# Deploy a dashboard to AWS

This guide is for the application owner after an administrator has completed
[AWS bootstrap](aws-bootstrap.md). It packages a board as a private Lambda and deploys it through
the restricted roles created during bootstrap.

The application template does not create a public URL. Before starting, know which consumer-owned
API Gateway, ALB, or other protected gateway will invoke the Lambda.

If you only want to evaluate the dashboard, use the [local setup](../README.md#run-it-locally)
instead.

## Before you start

You need:

- Node.js 22 or newer, npm, the AWS CLI, and `jq`.
- The checked-in `dashboard-bootstrap.json` from the administrator.
- AWS credentials that can assume the bootstrap-created deploy role, or an equivalent approved
  deployment session.
- The reviewed `CloudFormationExecutionRoleArn` output from the core bootstrap stack.
- A gateway integration plan for the returned Lambda ARN.

The stock deployment supports public GitHub repositories and HTTP endpoints that require no
credential. It does **not** load a credential-map value into arbitrary `token_env` variables. See
[Private sources](#private-sources) before using a private repository or protected endpoint.

## 1. Install the package

Pin an exact version in the repository that owns the deployment:

```sh
npm install --save-exact @continuous-excellence/ze-great-dashboard-aws
```

The package includes the Lambda runtime, CLI, CloudFormation template, and matching immutable
browser client. Normal consumers do not publish client assets. Append `@version` when installing a
previously reviewed release rather than the current one.

## 2. Create a board

Save a board as `board.yaml`. This example reads a workflow from a public GitHub repository:

```yaml
sources:
  github:
    type: github-actions
    repo: your-org/your-public-repo
    branch: main

boards:
  operations:
    refresh: 60s
    panels:
      - id: build
        type: pipeline-status
        source: github
        pipeline: main.yml
        position: { x: 0, y: 0, w: 12, h: 6 }
```

See [Board configuration](board-configuration.md) for HTTP value panels, refresh settings, multiple
panels, and credential naming.

## 3. Generate and check deployment inputs

Generate the CloudFormation parameters from the bootstrap manifest, then run the read-only doctor:

```sh
npm exec -- ze-great-dashboard-aws parameters \
  --bootstrap-config dashboard-bootstrap.json \
  --output aws-dashboard-parameters.json

npm exec -- ze-great-dashboard-aws doctor \
  --parameters aws-dashboard-parameters.json \
  --region "$(jq -r .region dashboard-bootstrap.json)"
```

Commit `aws-dashboard-parameters.json`; it contains deployment settings, not secrets. The doctor
checks local tools, AWS identity, parameter compatibility, the artifact bucket and Region, and the
hosted browser client. It only performs read operations.

Before every package or deploy, also check that the live bootstrap stacks still match the manifest
and installed package:

```sh
npm exec -- ze-great-dashboard-aws bootstrap check \
  --config dashboard-bootstrap.json --format text
```

## 4. Package the Lambda

```sh
npm exec -- ze-great-dashboard-aws package \
  --board-config board.yaml \
  --parameters aws-dashboard-parameters.json \
  --output aws-dashboard-release
```

This validates the board and writes:

- `lambda.zip` — the private Lambda application.
- `template.yml` — the application CloudFormation template.
- `release.json` — the artifact key and release metadata.
- `parameters.json` — the complete, release-specific CloudFormation parameters.
- `deployment.json` — machine-readable upload and deployment command arguments.

## 5. Upload and deploy

Set the reviewed bootstrap values for this shell. The Region and stack name come from the manifest;
the execution-role ARN comes from the core stack capture created by the bootstrap guide:

```sh
export AWS_REGION="$(jq -er .region dashboard-bootstrap.json)"
export STACK_NAME="$(jq -er .core.applicationStackName dashboard-bootstrap.json)"
export AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN="$(jq -er \
  '.Stacks[0].Outputs[] | select(.OutputKey == "CloudFormationExecutionRoleArn") | .OutputValue' \
  .bootstrap-work/core-deployed-stack.json)"
```

If bootstrap was performed elsewhere, obtain that reviewed capture from the administrator or use
the verified ARN they handed off. Do not substitute the current caller's role.

Upload the generated artifact and deploy the generated template:

```sh
aws s3 cp aws-dashboard-release/lambda.zip \
  "$(jq -er '.commands.upload[4]' aws-dashboard-release/deployment.json)" \
  --region "$AWS_REGION"

aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file aws-dashboard-release/template.yml \
  --role-arn "$AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN" \
  --region "$AWS_REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides file://aws-dashboard-release/parameters.json \
  --no-fail-on-empty-changeset \
  --no-cli-pager
```

The stack creates the Lambda, its log group, and its runtime role. It outputs
`ServerFunctionArn`, `ServerFunctionName`, and `AssetPath`.

## 6. Connect the protected gateway

Grant only the chosen gateway permission to invoke `ServerFunctionArn`, then request `/health`
through that gateway. The application template intentionally creates no Function URL and no public
Lambda invocation permission.

Gateway selection, authentication, routing, and the invocation permission remain consumer-owned
because those controls must fit the surrounding AWS environment.

## Automate deployments

Once the manual deployment works, use the [GitHub Actions example](aws-github-actions.md). The
workflow consumes the two reviewed GitHub Environment variables emitted by `bootstrap verify` and
repeats the same check, package, upload, and deploy sequence.

## Update the dashboard

For a board change, rerun steps 3 through 5. For a package upgrade, install the new exact version
first, then use the same path. A bootstrap revision mismatch stops the deployment and requires the
administrator to review a bootstrap update; routine deployment never updates bootstrap implicitly.

## Private sources

Public GitHub sources need neither `token_env` nor `SecretReference`. For a private repository,
create a repository-scoped fine-grained GitHub PAT with **Actions: read**. Add **Pull requests:
read** only when the board uses `pull-request-health`; GitHub's workflow-runs API requires Actions
read. Store the token locally in an ignored file, then create either a consumer-owned Secrets
Manager secret or a Parameter Store `SecureString` whose value is a JSON credential map:

```json
{"GITHUB_TOKEN":"github_pat_…"}
```

Reference that key from the board without placing the token in Git, parameters, or Lambda
environment variables:

```yaml
sources:
  github:
    type: github-actions
    repo: your-org/private-repository
    token_env: GITHUB_TOKEN
```

Set that resource's ARN as `SecretReference` in `aws-dashboard-parameters.json`. Packaging rejects
a board with `token_env` when this parameter is absent. The Lambda role can read only that exact
Secrets Manager secret or Parameter Store parameter; for Parameter Store, decrypt is constrained to
SSM and that exact parameter's encryption context. At cold start it loads and validates the map,
and fails closed if a configured key is missing.

```json
{
  "ParameterKey": "SecretReference",
  "ParameterValue": "arn:aws:secretsmanager:us-east-1:123456789012:secret:dashboard"
}
```

For the lower-cost Parameter Store option, use its parameter ARN instead:

```json
{
  "ParameterKey": "SecretReference",
  "ParameterValue": "arn:aws:ssm:us-east-1:123456789012:parameter/dashboard/credentials"
}
```

Credential maps are cached for the Lambda execution environment. A rotation or parameter update is
used on the next cold start; for immediate uptake, deploy a configuration-only stack update or
otherwise restart the Lambda execution environments after updating the value.

See GitHub's [workflow-runs documentation](https://docs.github.com/en/rest/actions/workflow-runs)
for the endpoint permission requirement.

## Troubleshooting

- **Doctor fails before packaging:** fix every failed tool, identity, bucket, parameter, or hosted
  client check before continuing.
- **Board validation fails:** see [Board configuration](board-configuration.md); packaging stops
  before writing a deployable release.
- **Bootstrap check fails:** ask the administrator to reconcile the manifest, installed package,
  and live bootstrap stacks.
- **Lambda is deployed but unreachable:** the application has no public endpoint; verify the gateway
  integration and its scoped Lambda permission.
- **A GitHub panel is unauthorized:** verify the fine-grained PAT's repository access and Actions
  permission, then confirm its map key matches `token_env`.
