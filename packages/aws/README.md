# Ze Great Dashboard on AWS

`@continuous-excellence/ze-great-dashboard-aws` packages a board for a private AWS Lambda or ECS
deployment. It includes the Lambda runtime, deployment CLI, and CloudFormation templates; browser
assets are published separately as `@continuous-excellence/ze-great-dashboard-client`.

Deployment mode is persisted in `dashboard-bootstrap.json` and generated application parameters
as `ComputeMode`. Existing files without that field mean `lambda`. Choose `--mode ecs` during
bootstrap initialization; routine packaging and diagnostics then select the matching template.
An explicit mode fails if it disagrees with persisted configuration, so changing mode requires
regenerating the reviewed bootstrap and parameter artifacts.

`dashboard-bootstrap.json` is checked-in desired state, not a capture of AWS. If an intentionally
upgraded package changes a bootstrap template contract or revision, run `bootstrap upgrade
--config dashboard-bootstrap.json`, review and commit only that metadata change, then have the
consumer's approved deployment automation preview and execute CloudFormation UPDATE change sets.
Package upgrades that do not change bootstrap template identity do not require a manifest update or
bootstrap redeploy. Captures and generated parameter files are disposable deployment artifacts;
the package owns template contents and the manifest records the intended package/template identity.
No credentials belong in the manifest.

Consumer ECS deployments use the long-lived service template and provide their own subnets and
security groups.

This deployment path is intended for teams that already operate AWS and have a protected gateway
such as API Gateway or an ALB. It deliberately does not create a public endpoint, choose an
authentication policy, or manage secret values.

If you are evaluating the dashboard, start with the repository's
[local setup](https://github.com/robertfmurdock/ze-great-dashboard#run-it-locally). You do not need
AWS to try it.

## What you need

- Node.js 22 or newer, npm, the AWS CLI, and `jq`.
- An AWS administrator for the one-time bootstrap.
- A pre-existing central GitHub OIDC provider and a protected GitHub Environment if GitHub Actions
  will deploy the dashboard.
- A consumer-owned gateway that can privately invoke Lambda and enforce your access policy.

The included deployment works out of the box with public GitHub repositories and HTTP endpoints
that do not require credentials. For private GitHub sources, `SecretReference` is the ARN of one
consumer-owned Secrets Manager JSON map or Parameter Store `SecureString` (for example,
`{"GITHUB_TOKEN":"github_pat_…"}`). The runtime resolves configured `token_env` names only at
Lambda cold start and never exposes token values to the browser, API responses, logs,
CloudFormation parameters, or Lambda environment. The two added AWS SDK clients provide
IAM-authenticated `GetSecretValue` and decrypted `GetParameter` support in the bundled Lambda, at
the cost of their bundled code and one cold-start request when private sources are configured.

## Deployment map

1. An administrator creates the artifact bucket and restricted deployment roles using the
   [AWS bootstrap guide](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-bootstrap.md).
2. The application owner writes `board.yaml`, packages the Lambda, and deploys its private
   CloudFormation stack using the
   [deployment guide](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-setup.md).
3. The consumer connects the returned `ServerFunctionArn` to its protected gateway.
4. GitHub Actions can repeat the package-and-deploy step after the administrator configures the two
   reviewed role ARNs.

## The normal application workflow

Pin an exact package version in the repository that owns the deployment:

```sh
npm install --save-exact @continuous-excellence/ze-great-dashboard-aws
```

Append `@version` when installing a previously reviewed release rather than the current one.

After bootstrap is complete, the recurring workflow is only:

```sh
npm exec -- ze-great-dashboard-aws parameters \
  --bootstrap-config dashboard-bootstrap.json \
  --output aws-dashboard-parameters.json

npm exec -- ze-great-dashboard-aws doctor \
  --parameters aws-dashboard-parameters.json \
  --region us-east-1

npm exec -- ze-great-dashboard-aws package \
  --board-config board.yaml \
  --parameters aws-dashboard-parameters.json \
  --output aws-dashboard-release
```

`package` writes the complete release-specific `parameters.json` and machine-readable
`deployment.json` alongside the ZIP and template. The deployment guide covers executing the emitted
S3 upload and CloudFormation commands, gateway handoff, and CI example.
Changing `board.yaml` or upgrading the pinned package uses this same path.

## Package boundaries

| The package owns | You own |
| --- | --- |
| Board validation and Lambda packaging | Board content and source access |
| Server runtime and CloudFormation templates | The immutable browser asset host and authentication |
| Private application CloudFormation template | AWS account administration |
| Restricted bootstrap templates | Secret values and the credential-map ARN |
| Read-only preflight and consistency checks | Reviewing and executing AWS changes |

Bootstrap commands never execute mutating AWS operations. They produce plans, parameters, and
commands for an administrator to review and run explicitly. `bootstrap check` is the named
read-only live diagnostic used before routine deployments.

## References

- [Board configuration](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/board-configuration.md)
- [Administrator bootstrap](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-bootstrap.md)
- [Application deployment](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-setup.md)
- [GitHub Actions deployment](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-github-actions.md)
- [Issue tracker](https://github.com/robertfmurdock/ze-great-dashboard/issues)
