# Bootstrap from AWS CloudShell

This runbook is for the AWS administrator completing the one-time
[AWS bootstrap](aws-bootstrap.md) entirely in CloudShell. The package prints AWS commands; it does
not run them. It is not an automation script; review and execute each command separately with an
approved administrator identity.

## Prepare CloudShell

Open CloudShell in the target Region. You need an existing account-level GitHub OIDC provider, a
GitHub repository, and its protected deployment Environment.

Install one exact package version in a dedicated directory:

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

If discovery is unavailable, `bootstrap init` names the required offline flags. Resolve every
`missing` or `mismatch` preflight result. Treat `unverified` as unknown, not success.

Copy the completed `dashboard-bootstrap.json` into the repository that owns the deployment and
commit it. It contains desired names and IDs, not credentials.

## Create the core stack

```sh
mkdir -p .bootstrap-work
npm exec -- ze-great-dashboard-aws bootstrap guide \
  --config dashboard-bootstrap.json \
  --work-dir .bootstrap-work
```

Run each printed command separately. At the review pause, inspect the CloudFormation change set
before executing it. Confirm every IAM action, the `CAPABILITY_NAMED_IAM` acknowledgement, retained
bucket and role behavior, and the bucket's TLS-only and public-access-block policies.

The final printed command captures the deployed core stack in
`.bootstrap-work/core-deployed-stack.json`.

## Create the GitHub OIDC stack

```sh
npm exec -- ze-great-dashboard-aws bootstrap guide \
  --config dashboard-bootstrap.json \
  --work-dir .bootstrap-work \
  --core-stack-json .bootstrap-work/core-deployed-stack.json
```

Review this change set before executing it. Confirm the immutable GitHub owner/repository-ID
subject, protected Environment, `sts.amazonaws.com` audience, one permitted artifact prefix, one
application stack, and the core execution role.

If the guide reports `immutable-subject-required`, stop. A GitHub administrator must coordinate the
repository OIDC subject migration before this role can be trusted safely.

The final command captures `.bootstrap-work/github-oidc-deployed-stack.json`.

## Verify and hand off

```sh
npm exec -- ze-great-dashboard-aws bootstrap verify \
  --config dashboard-bootstrap.json \
  --core-stack-json .bootstrap-work/core-deployed-stack.json \
  --github-oidc-stack-json .bootstrap-work/github-oidc-deployed-stack.json | jq .
```

Give the verified `AWS_DEPLOY_ROLE_ARN` and `AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN` values to the
GitHub Environment administrator. The JSON also contains optional `gh variable set` argument arrays;
the command does not change GitHub.

Keep `.bootstrap-work/` private and out of source control. Gateway or load-balancer selection,
private Lambda permission, authentication, and health checks remain consumer-owned. Continue with
[Deploy the dashboard](aws-setup.md).
