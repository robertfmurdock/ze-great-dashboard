# Ze Great Dashboard on AWS

`@continuous-excellence/ze-great-dashboard-aws` validates and packages a board for a private AWS Lambda
or ECS deployment. It includes the server runtime, deployment CLI, and CloudFormation
templates. The matching immutable browser client is published separately as
`@continuous-excellence/ze-great-dashboard-client` and is selected automatically unless you provide
another exact asset URL.

This package is for teams that already operate AWS and can provide a protected entry path:

- Lambda requires a consumer-owned API Gateway, ALB, or equivalent gateway with private invocation
  permission.
- ECS requires consumer-owned subnets, security groups, and protected load balancing or routing for
  the long-lived Fargate service.

In both modes, a consumer-owned gateway or load balancer defines the public entry and authentication
boundary.

The templates create no public endpoint, choose no authentication policy, and manage no secret
values. To evaluate the dashboard without AWS, start with the
[local setup](https://github.com/robertfmurdock/ze-great-dashboard#try-it).

## Prerequisites

- Node.js 22 or newer, npm, the AWS CLI, and `jq`.
- An AWS administrator for one-time bootstrap.
- A pre-existing account-level GitHub OIDC provider and protected GitHub Environment when GitHub
  Actions will deploy the dashboard.
- Consumer-owned networking, gateway or load balancing, authentication, and runtime health checks.

## Choose and bootstrap a compute mode

Lambda is the compatibility default. Select ECS with `--mode ecs` when running `bootstrap init`.
The choice is stored in `dashboard-bootstrap.json` and generated application parameters as
`ComputeMode`; older files without the field mean Lambda.

An explicit mode that conflicts with persisted configuration fails. Changing between Lambda and ECS
requires regenerated, administrator-reviewed bootstrap and application parameters—it is not a
routine package option.

Follow the [AWS bootstrap guide](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-bootstrap.md),
then the [Lambda deployment guide](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-setup.md).

## Package a deployment

Pin the reviewed package version in the repository that owns the deployment:

```sh
npm install --save-exact @continuous-excellence/ze-great-dashboard-aws
```

Append `@version` when installing a previously reviewed release rather than the current one. After
bootstrap, generate and diagnose application parameters, then package the board:

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

For ECS, the persisted parameters select the ECS template and `package` also requires an immutable,
digest-pinned image through `--image`. The generated `deployment.json` contains structured upload
and CloudFormation command arguments for the approved deployment process to invoke.

`package` writes release-specific `parameters.json`, `deployment.json`, and `template.yml`, plus
`lambda.zip` for Lambda. Changing `board.yaml` or the pinned package version uses this same path.
Run the read-only `bootstrap check` before every deployment.

## Private source credentials

Public GitHub repositories and unauthenticated HTTP sources work without credentials. For private
sources, set `SecretReference` to the ARN of one consumer-owned Secrets Manager JSON value or
Parameter Store `SecureString`, for example:

```json
{"GITHUB_TOKEN":"github_pat_…"}
```

The board references `GITHUB_TOKEN` through `token_env`; the credential value never belongs in the
board, bootstrap manifest, CloudFormation parameters, runtime environment variables, logs, API
responses, or browser. The runtime reads only the exact secret or parameter authorized by the
application role, resolves configured `token_env` names only at Lambda cold start, and fails closed
when a key is absent.

## Ownership boundaries

| Package responsibility | Consumer responsibility |
| --- | --- |
| Board validation and release packaging | Board content and source permissions |
| Server runtime and application templates | AWS account and network administration |
| Restricted bootstrap templates | Reviewing and executing AWS changes |
| Default immutable client asset selection | Approval of alternate asset hosts |
| Read-only preflight, doctor, and consistency checks | Gateway, authentication, and health checks |
| Exact secret-resource integration | Secret values, rotation, and credential-map ARN |

Bootstrap commands do not perform mutating AWS operations. They emit plans, parameters, captures,
and command arguments for an administrator to review and invoke. `bootstrap check` is the read-only
live diagnostic used before routine deployments; when it fails, use the
[bootstrap upgrade runbook](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-bootstrap-upgrade.md).

## References

- [Board configuration](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/board-configuration.md)
- [Administrator bootstrap](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-bootstrap.md)
- [Lambda deployment](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-setup.md)
- [GitHub Actions deployment](https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/aws-github-actions.md)
- [Issue tracker](https://github.com/robertfmurdock/ze-great-dashboard/issues)
