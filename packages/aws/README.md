# Ze Great Dashboard on AWS

`@continuous-excellence/ze-great-dashboard-aws` packages a board as a private AWS Lambda. It
includes the Lambda runtime, matching browser client, deployment CLI, and CloudFormation templates.

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
that do not require credentials. Private sources require a consumer-owned runtime integration; the
stock template does not turn a Secrets Manager reference into `token_env` variables.

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
  --output aws-dashboard-release
```

The deployment guide covers the S3 upload, CloudFormation command, gateway handoff, and CI example.
Changing `board.yaml` or upgrading the pinned package uses this same path.

## Package boundaries

| The package owns | You own |
| --- | --- |
| Board validation and Lambda packaging | Board content and source access |
| Compatible immutable browser assets | The protected gateway and authentication |
| Private application CloudFormation template | AWS account administration |
| Restricted bootstrap templates | Secret values and runtime credential loading |
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
