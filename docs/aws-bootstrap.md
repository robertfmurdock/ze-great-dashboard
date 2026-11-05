# Bootstrap an AWS deployment

This guide is for the AWS and GitHub administrators performing the one-time setup for a dashboard.
If bootstrap is complete, continue with [Deploy the dashboard](aws-setup.md).

Bootstrap creates two CloudFormation stacks:

- The **core stack** owns restricted deployment resources and a CloudFormation execution role for
  one named dashboard application stack.
- The **GitHub OIDC stack** lets one protected GitHub Environment deploy that application through
  the core execution role.

Routine deployment credentials cannot create, update, or delete either bootstrap stack. The CLI
prepares commands and files, but an administrator reviews and runs every AWS change.

## Before you start

You need:

- Node.js 22 or newer, npm, the AWS CLI, and `jq`.
- A short-lived AWS administrator session in the target account and Region.
- A pre-existing account-level GitHub OIDC provider; this package does not create or modify it.
- A GitHub repository and a protected Environment for deployments.
- GitHub CLI access if you want repository IDs and prerequisites discovered automatically.

Choose one stable dashboard name and one compute mode:

- **Lambda** is the default and requires a consumer-owned API Gateway, ALB, or other protected
  gateway that can privately invoke the function.
- **ECS** uses a long-lived Fargate service and requires consumer-owned subnets, security groups,
  and a protected load-balancing or routing path. Select it with `--mode ecs` during initialization.

The mode is persisted in the manifest. Changing the name, artifact bucket, or compute mode later is
a reviewed migration, not a routine deployment.

Create the protected GitHub Environment and its branch policy before preflight. Whether it requires
reviewers is your deployment-policy decision.

## 1. Install an exact package version

Run bootstrap from the repository that will own the deployment:

```sh
npm install --save-exact @continuous-excellence/ze-great-dashboard-aws
```

Commit the exact version in `package.json` and the lockfile. Append `@version` when installing a
previously reviewed release rather than the current one.

## 2. Create the non-secret manifest

```sh
npm exec -- ze-great-dashboard-aws bootstrap init \
  --output dashboard-bootstrap.json \
  --slug team-dashboard \
  --repository example/team-dashboard \
  --environment production \
  --github-oidc-provider-arn \
    arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com
```

For ECS, add `--mode ecs`. If the deployment workflow must read outputs from one consumer-owned
gateway stack, add `--consumer-gateway-stack gateway-stack-name`; this grants only
`cloudformation:DescribeStacks` for that exact stack and does not create or configure the gateway.

The command discovers the AWS account, configured Region, and GitHub numeric owner/repository IDs
when possible. If discovery is unavailable, it names the required `--account-id`, `--region`,
`--github-owner-id`, and `--github-repository-id` flags. It refuses to overwrite an existing
manifest.

Review and commit `dashboard-bootstrap.json`. It records desired names, IDs, mode, package version,
and template identities. It never contains credentials or captured AWS values.

## 3. Verify prerequisites and inspect the plan

```sh
npm exec -- ze-great-dashboard-aws bootstrap preflight \
  --config dashboard-bootstrap.json --format text

npm exec -- ze-great-dashboard-aws bootstrap plan \
  --config dashboard-bootstrap.json --format text
```

Resolve every `missing` or `mismatch` result. `unverified` means that a CLI, login, permission, or
network was unavailable; it is not evidence that the prerequisite exists.

The local plan shows desired state beside the installed templates' contracts, revisions, SHA-256
values, resources, and declared IAM actions. If an intentional package upgrade changed a selected
template identity, update and review the manifest metadata before deployment:

```sh
npm exec -- ze-great-dashboard-aws bootstrap upgrade --config dashboard-bootstrap.json
```

A package-version difference alone does not require this command when the selected template
contract and revision are unchanged.

## 4. Create the core stack

Generated parameters and stack captures are private working files, not source configuration. Add
`.bootstrap-work/` to `.gitignore`, then request the current phase:

```sh
mkdir -p .bootstrap-work
npm exec -- ze-great-dashboard-aws bootstrap guide \
  --config dashboard-bootstrap.json \
  --work-dir .bootstrap-work
```

Run the printed commands one at a time. At `describe-change-set`, pause and inspect the expanded
change before running `execute-change-set`.

Confirm:

- `CAPABILITY_NAMED_IAM` is expected.
- Storage blocks public access, requires TLS, and uses the intended encryption.
- The execution role is limited to the named application resources and approved optional secret.
- No retained bucket or role is being replaced.

The final generated command writes `.bootstrap-work/core-deployed-stack.json`.

## 5. Create the GitHub OIDC stack

Pass the reviewed core capture back to the guide:

```sh
npm exec -- ze-great-dashboard-aws bootstrap guide \
  --config dashboard-bootstrap.json \
  --work-dir .bootstrap-work \
  --core-stack-json .bootstrap-work/core-deployed-stack.json
```

Before executing this change set, confirm:

- The provider ARN and `sts.amazonaws.com` audience are exact.
- The subject contains immutable GitHub owner and repository IDs plus the protected Environment.
- Access is limited to the expected deployment artifacts, one application stack, and the core
  execution role.
- No retained role is being replaced.

If the guide reports `immutable-subject-required`, stop and coordinate the OIDC subject migration
with the GitHub administrator. Changing the repository's OIDC subject can affect other AWS trust
policies.

The final generated command writes `.bootstrap-work/github-oidc-deployed-stack.json`.

## 6. Verify and hand off

```sh
npm exec -- ze-great-dashboard-aws bootstrap verify \
  --config dashboard-bootstrap.json \
  --core-stack-json .bootstrap-work/core-deployed-stack.json \
  --github-oidc-stack-json .bootstrap-work/github-oidc-deployed-stack.json | jq .
```

Verification checks stack identities, Regions, contracts, parameters, outputs, and reviewed role
ARNs. Give these two non-secret values from its output to the GitHub Environment administrator:

- `AWS_DEPLOY_ROLE_ARN`
- `AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN`

The output also includes optional `gh variable set` argument arrays. The CLI does not modify GitHub;
the GitHub administrator owns the Environment policy and variables.

Bootstrap is complete. Continue with [Deploy the dashboard](aws-setup.md).

## Operate bootstrap safely

Every deployment should run this read-only consistency gate after assuming the deploy role:

```sh
npm exec -- ze-great-dashboard-aws bootstrap check \
  --config dashboard-bootstrap.json --format text
```

It fails on inaccessible or unhealthy stacks and on identity, Region, parameter, output, contract,
or template-revision mismatches. Use `--resource-drift` only for a scheduled or manual audit because
CloudFormation drift detection is slower.

A routine package upgrade uses the existing bootstrap unless this check or the release notes require
an administrator-managed change. Lambda and ECS track mode-specific template revisions; a change to
one mode does not normally require changing the other.

When the check fails, stop application deployment and follow the
[bootstrap upgrade or repair runbook](aws-bootstrap-upgrade.md). Never delete retained resources as
an upgrade shortcut. Administrators working entirely in AWS CloudShell can use the focused
[CloudShell runbook](aws-bootstrap-cloudshell.md).
