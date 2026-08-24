# Bootstrap from AWS CloudShell

Use this runbook when the administrator wants to complete the
[bootstrap process](aws-bootstrap.md) entirely in AWS CloudShell. It is not an automation script:
the package prints AWS commands, and the administrator reviews and runs each one.

## Prepare a working directory

Open CloudShell in the target Region with an approved administrator identity, then install one exact
package version in a dedicated directory:

```sh
mkdir dashboard-bootstrap
cd dashboard-bootstrap
npm init --yes
npm install --ignore-scripts --save-exact \
  @continuous-excellence/ze-great-dashboard-aws
```

Create the non-secret manifest. CloudShell normally discovers the AWS account and Region; provide
the numeric GitHub IDs explicitly if GitHub CLI is unavailable:

```sh
npm exec -- ze-great-dashboard-aws bootstrap init \
  --output dashboard-bootstrap.json \
  --slug team-dashboard \
  --repository example/team-dashboard \
  --environment production \
  --github-oidc-provider-arn \
    arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com

npm exec -- ze-great-dashboard-aws bootstrap preflight \
  --config dashboard-bootstrap.json --format text
```

If discovery is unavailable, `bootstrap init` names the required offline flags. Copy the finished
`dashboard-bootstrap.json` into the consumer repository; it contains no credentials.

## Create the core stack

```sh
mkdir -p .bootstrap-work
npm exec -- ze-great-dashboard-aws bootstrap guide \
  --config dashboard-bootstrap.json \
  --work-dir .bootstrap-work
```

Run each printed command separately. Stop at the review pause and inspect the CloudFormation change
set before executing it. Confirm every IAM action, the `CAPABILITY_NAMED_IAM` acknowledgement, the
retained bucket and role, and the bucket's TLS-only and public-access-block policies.

The final printed command captures the deployed core stack in
`.bootstrap-work/core-deployed-stack.json`.

## Create the GitHub OIDC stack

```sh
npm exec -- ze-great-dashboard-aws bootstrap guide \
  --config dashboard-bootstrap.json \
  --work-dir .bootstrap-work \
  --core-stack-json .bootstrap-work/core-deployed-stack.json
```

Again, run each command separately and review the change set before execution. Confirm the immutable
GitHub owner/repository-ID subject, protected Environment, `sts.amazonaws.com` audience, one
`lambda/*` artifact prefix, one application stack, and the core execution role.

If the guide reports `immutable-subject-required`, stop. A GitHub administrator must coordinate the
repository OIDC subject migration before this role can be trusted safely.

The final command captures `.bootstrap-work/github-oidc-deployed-stack.json`.

## Verify the handoff

```sh
npm exec -- ze-great-dashboard-aws bootstrap verify \
  --config dashboard-bootstrap.json \
  --core-stack-json .bootstrap-work/core-deployed-stack.json \
  --github-oidc-stack-json .bootstrap-work/github-oidc-deployed-stack.json | jq .
```

Give the verified `AWS_DEPLOY_ROLE_ARN` and `AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN` values to the
GitHub Environment administrator. The JSON also contains optional `gh variable set` argument arrays,
but the command does not change GitHub itself.

Gateway selection, private Lambda permission, authentication, and runtime health checks remain the
consumer's responsibility.
