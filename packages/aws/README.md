# Ze Great Dashboard AWS deployment

`@continuous-excellence/ze-great-dashboard-aws` packages a configured Ze Great Dashboard as an AWS
Lambda deployment. It includes the compatible immutable client, Lambda runtime, CLI, and
CloudFormation template.

It does not create a public endpoint, choose an authentication policy, create a gateway, provide a
secret value, or own consumer AWS infrastructure. You provide the protected gateway and complete the
administrator-owned bootstrap process first.

For a deployment workflow that verifies a consumer-owned gateway stack, configure
`--consumer-gateway-stack gateway-stack-name` during `bootstrap init`. The GitHub OIDC v2 role then
gets only `cloudformation:DescribeStacks` for that exact stack; the package still does not create,
invoke, or authenticate the gateway.

## Prerequisites

You need Node.js 22+, npm, the AWS CLI, `jq`, and one AWS Region for the artifact bucket, Lambda,
and application stack. You also need a consumer-owned artifact bucket and the bootstrap-created
restricted roles. Follow the [AWS bootstrap guide](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-bootstrap.md)
before this deployment procedure.

## Deploy a dashboard

Use an exact package version in a deployment project:

```sh
npm install --save-exact @continuous-excellence/ze-great-dashboard-aws@1.2.3
```

Create `board.yaml`. This small configuration has one GitHub Actions panel and one HTTP value panel;
see the [board configuration guide](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/board-configuration.md)
for the full schema.

```yaml
sources:
  github:
    type: github-actions
    repo: your-org/your-repo
    branch: main
    token_env: GITHUB_TOKEN

boards:
  operations:
    refresh: 60s
    panels:
      - id: build
        type: pipeline-status
        source: github
        pipeline: main.yml
        position: { x: 0, y: 0, w: 8, h: 6 }
      - id: version
        type: http-value
        url: https://status.example.com/version.json
        json_path: $.version
        position: { x: 8, y: 0, w: 4, h: 6 }
```

Generate the application parameters from the non-secret `dashboard-bootstrap.json` created during
bootstrap:

```sh
npm exec -- ze-great-dashboard-aws parameters \
  --bootstrap-config dashboard-bootstrap.json \
  --output aws-dashboard-parameters.json
```

After the parameter file exists, run the read-only doctor. It checks local tooling, your AWS
identity, parameters, the artifact bucket and Region, and the matching hosted client:

```sh
npm exec -- ze-great-dashboard-aws doctor \
  --parameters aws-dashboard-parameters.json \
  --region us-east-1
```

After assuming the generated GitHub deploy role, run the canonical blocking consistency check before
packaging or deployment:

```sh
npm exec -- ze-great-dashboard-aws bootstrap check \
  --config dashboard-bootstrap.json --format text
```

Add `--resource-drift` only for a slower scheduled or manually dispatched CloudFormation drift
audit. Neither form updates stack resources.

Package the release. This validates the board and writes `lambda.zip`, `release.json`, and
`template.yml` to the output directory:

```sh
npm exec -- ze-great-dashboard-aws package \
  --board-config board.yaml \
  --output aws-dashboard-release
```

Upload the generated ZIP to the bucket and key specified by the parameter file and release metadata:

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

Deploy the generated CloudFormation template using the restricted execution role captured from the
core bootstrap stack:

```sh
aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file aws-dashboard-release/template.yml \
  --role-arn "$CLOUDFORMATION_EXECUTION_ROLE_ARN" \
  --region "$AWS_REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides file://aws-dashboard-parameters.json \
  --no-fail-on-empty-changeset
```

The stack outputs `ServerFunctionArn`. Integrate that ARN with your protected API Gateway, ALB, or
other consumer-owned gateway, then verify the protected `/health` endpoint. The template deliberately
does not grant public Lambda invoke permission.

## Operate safely

To upgrade, install a newer exact package version and repeat package, upload, and deploy. A change to
`board.yaml` follows the same path; it does not require a package change.

After upgrading, also check the [bootstrap consistency guidance](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-bootstrap.md#check-bootstrap-consistency-on-every-deployment).
Compatible releases may add optional bootstrap capabilities without changing the contract version.
If your workflow verifies a consumer-owned gateway stack, add `githubOidc.consumerGatewayStackName`
to the reviewed manifest and update the GitHub OIDC stack; other consumers do not need to rerun
bootstrap.

Tokens belong in runtime secret handling, never in board YAML, `aws-dashboard-parameters.json`, or
the generated ZIP. See [runtime secrets](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-setup.md#runtime-secrets)
for the supported secret reference and integration boundary.

## Commands and boundaries

| Command | Use |
| --- | --- |
| `doctor` | Read-only preflight for an existing parameter file. |
| `parameters` | Generate or update application CloudFormation parameters. |
| `package` | Validate board YAML and build a deployable Lambda release. |
| `bootstrap` | Plan and guide administrator bootstrap work; `bootstrap check` is the explicit live diagnostic used by CI. |
| `publish-assets` | Provider-only: publish immutable client assets. Normal consumers use the hosted client. |
| `deploy` | Provider-only: automation helper for a provider-managed asset and Lambda deployment. |

## Further reading and support boundary

- [Board configuration](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/board-configuration.md)
- [AWS bootstrap](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-bootstrap.md)
- [Consumer deployment and CI setup](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-setup.md)
- [GitHub Actions deployment workflow YAML example](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-setup.md#github-actions)
- [Runtime secret integration](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-setup.md#runtime-secrets)
- [Repository source](https://github.com/robertfmurdock/ze-great-dashboard)
- [Issue tracker](https://github.com/robertfmurdock/ze-great-dashboard/issues)
- [MIT license](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/LICENSE)

The package owns the Lambda deployment artifact. Gateway design, authentication, secret-value
provisioning, and consumer AWS account administration remain your responsibility.
