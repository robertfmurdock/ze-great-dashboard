# Deploy a dashboard to AWS Lambda

This guide is for the application owner after an administrator completes
[AWS bootstrap](aws-bootstrap.md) in Lambda mode. It packages a board as a private Lambda and
deploys it through the restricted bootstrap roles.

The application template creates no public URL. Before starting, choose the consumer-owned API
Gateway, ALB, or other protected gateway that will invoke the Lambda and enforce access. To evaluate
the dashboard without AWS, use the [local setup](../README.md#try-it).

## Before you start

You need:

- Node.js 22 or newer, npm, the AWS CLI, and `jq`.
- The administrator-reviewed `dashboard-bootstrap.json`.
- AWS credentials that can assume the bootstrap-created deploy role, or an equivalent approved
  deployment session.
- The reviewed `CloudFormationExecutionRoleArn` output from the core bootstrap stack.
- A gateway integration plan for the returned Lambda ARN.

Public GitHub repositories and unauthenticated HTTP endpoints need no source credential. Read
[Private sources](#private-sources) before configuring a private repository or protected endpoint.

## 1. Install the package

Pin the exact version approved for this deployment:

```sh
npm install --save-exact @continuous-excellence/ze-great-dashboard-aws@REVIEWED_VERSION
```

Commit the package manifest and lockfile. The package contains the Lambda runtime, CLI, and
CloudFormation template. Normal deployments use the matching immutable browser client from the
versioned public asset path; they do not publish client assets.

## 2. Create the board

Save the configuration as `board.yaml`. This example reads a workflow from a public GitHub
repository:

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

See [Board configuration](board-configuration.md) for supported panels, sources, refresh settings,
layout, and credential references.

## 3. Generate and verify deployment inputs

Generate CloudFormation parameters from the bootstrap manifest, then run the read-only diagnostic:

```sh
npm exec -- ze-great-dashboard-aws parameters \
  --bootstrap-config dashboard-bootstrap.json \
  --output aws-dashboard-parameters.json

npm exec -- ze-great-dashboard-aws doctor \
  --parameters aws-dashboard-parameters.json \
  --region "$(jq -r .region dashboard-bootstrap.json)"
```

Commit `aws-dashboard-parameters.json`; it contains deployment settings, not secrets. `doctor`
checks local tools, AWS identity, parameter compatibility, artifact storage and Region, and the
hosted browser client. It performs only read operations.

Before every package or deployment, verify that the live bootstrap still matches the manifest and
installed package:

```sh
npm exec -- ze-great-dashboard-aws bootstrap check \
  --config dashboard-bootstrap.json --format text
```

Stop if either check fails. Bootstrap changes require administrator review; routine application
deployment must not update bootstrap implicitly.

## 4. Package the release

```sh
npm exec -- ze-great-dashboard-aws package \
  --board-config board.yaml \
  --parameters aws-dashboard-parameters.json \
  --output aws-dashboard-release
```

Packaging validates the board and writes:

- `lambda.zip` — the private Lambda application.
- `template.yml` — the application CloudFormation template.
- `release.json` — artifact and release metadata.
- `parameters.json` — complete release-specific CloudFormation parameters.
- `deployment.json` — machine-readable upload and deployment command arguments.

### Use a different asset host

To select an exact client release from another host, provide its complete URL. This jsDelivr example
uses release `0.21.0`:

```sh
npm exec -- ze-great-dashboard-aws package \
  --board-config board.yaml \
  --parameters aws-dashboard-parameters.json \
  --asset-path https://cdn.jsdelivr.net/npm/@continuous-excellence/ze-great-dashboard-client@0.21.0/client \
  --output aws-dashboard-release
```

Replace `0.21.0` with the exact reviewed client release; never use a moving tag. The URL must contain
the matching `index.html` and `board-config.schema.json`. It is recorded in the board modeline and
deployed as `ASSET_PATH`. `--asset-domain` is a deprecated shorthand for the standard AWS layout.

The server must be able to fetch `index.html` and the schema, while browsers fetch hashed assets
directly over HTTPS. For an internal CDN or S3 prefix, configure CORS for browser asset requests;
`Access-Control-Allow-Origin: *` is appropriate only because these immutable files contain no
secrets or environment values. Never place configuration or credentials on this public asset host,
and never modify a deployed version directory.

## 5. Upload and deploy

Set the reviewed values for this shell. The Region and application stack name come from the manifest.
The execution-role ARN comes from the reviewed core-stack capture:

```sh
export AWS_REGION="$(jq -er .region dashboard-bootstrap.json)"
export STACK_NAME="$(jq -er .core.applicationStackName dashboard-bootstrap.json)"
export AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN="$(jq -er \
  '.Stacks[0].Outputs[] | select(.OutputKey == "CloudFormationExecutionRoleArn") | .OutputValue' \
  .bootstrap-work/core-deployed-stack.json)"
```

If bootstrap occurred elsewhere, obtain the reviewed capture or verified ARN from the administrator.
Do not substitute the current caller's role.

Upload and deploy the generated artifacts:

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

The stack creates the Lambda, its log group, and its runtime role. It outputs `ServerFunctionArn`,
`ServerFunctionName`, and `AssetPath`.

## 6. Connect and verify the protected gateway

Grant only the chosen gateway permission to invoke `ServerFunctionArn`, then request `/health`
through that gateway. The application template intentionally creates no Function URL and no public
Lambda invocation permission.

Gateway selection, authentication, routing, and invocation permission remain consumer-owned so they
can follow the surrounding AWS environment's security policy.

## Private sources

For a private GitHub repository, create a repository-scoped fine-grained PAT with **Actions: read**.
Add **Pull requests: read** only when the board uses `pull-request-health`. Store the token outside
source control in either a consumer-owned Secrets Manager secret or a Parameter Store `SecureString`.
Its value must be a JSON credential map:

```json
{"GITHUB_TOKEN":"github_pat_…"}
```

Reference the key—not the token—from the board:

```yaml
sources:
  github:
    type: github-actions
    repo: your-org/private-repository
    token_env: GITHUB_TOKEN
```

Set that resource's ARN as `SecretReference` in `aws-dashboard-parameters.json`. Packaging rejects a
board with `token_env` when this parameter is absent. Use a Secrets Manager ARN:

```json
{
  "ParameterKey": "SecretReference",
  "ParameterValue": "arn:aws:secretsmanager:us-east-1:123456789012:secret:dashboard"
}
```

Or use a Parameter Store ARN:

```json
{
  "ParameterKey": "SecretReference",
  "ParameterValue": "arn:aws:ssm:us-east-1:123456789012:parameter/dashboard/credentials"
}
```

The Lambda role can read only that exact resource. Parameter Store decryption is additionally
restricted to SSM and the parameter's encryption context. At cold start, the runtime loads and
validates the map and fails closed when a configured key is missing. Tokens are never placed in Git,
CloudFormation parameters, Lambda environment variables, logs, API responses, or browser data.

Credential maps are cached for the Lambda execution environment. Rotation is visible on the next
cold start. For immediate uptake, deploy a configuration-only stack update or otherwise restart the
Lambda execution environments after changing the value.

See GitHub's [workflow-runs documentation](https://docs.github.com/en/rest/actions/workflow-runs)
for endpoint permissions.

## Updates and automation

For a board change, repeat steps 3 through 5. For a package upgrade, install the new exact version
first and follow the same path. If `bootstrap check` reports a mismatch or drift, stop and use the
[AWS bootstrap upgrade runbook](aws-bootstrap-upgrade.md).

After the manual deployment works, the [GitHub Actions example](aws-github-actions.md) can repeat the
same check, package, upload, and deployment sequence with the two reviewed GitHub Environment role
ARNs.

## Troubleshooting

- **`doctor` fails:** fix every failed tool, identity, bucket, Region, parameter, or hosted-client
  check before packaging.
- **Board validation fails:** correct the reported file and field; no deployable release is written.
- **`bootstrap check` fails:** ask the administrator to reconcile the manifest, package, and live
  bootstrap stacks.
- **Lambda is deployed but unreachable:** verify the protected gateway integration and its scoped
  Lambda invocation permission; the application has no public endpoint.
- **A GitHub panel is unauthorized:** verify the PAT's repository access and required permissions,
  then confirm its map key exactly matches `token_env`.

A Lambda startup failure returns HTTP 503 with `Cache-Control: no-store`, code
`dashboard_startup_failed`, and a `supportReference`. Find the matching `server.startup_failed` JSON
event in CloudWatch Logs. Diagnostics identify the kind, location, and corrective constraint without
including raw configuration, URLs, credential names, or values. Board, source, panel, and fact
indexes are zero-based; YAML errors include a line and column when available.

Correct the configuration, repackage, and redeploy. Lambda retries startup on the next invocation,
so a corrected remote configuration can recover without retaining failed startup state. A board is
admitted atomically; the runtime never serves a partial configuration.
