# Bootstrap an AWS deployment

This is the one-time setup for the AWS and GitHub administrator supporting a dashboard deployment.
If bootstrap is already complete, continue with [Deploy the dashboard](aws-setup.md).

Bootstrap creates two small CloudFormation stacks:

- The **core stack** owns a private Lambda artifact bucket and a restricted CloudFormation execution
  role for one dashboard application stack.
- The **GitHub OIDC stack** lets one protected GitHub Environment upload artifacts and operate that
  application stack through the core execution role.

Routine CI cannot create, update, or delete either bootstrap stack. The CLI prepares each change,
but the administrator runs and approves the AWS commands.

## Before you start

You need:

- Node.js 22 or newer, npm, the AWS CLI, and `jq`.
- A short-lived AWS administrator session in the target account and Region.
- A pre-existing account-level GitHub OIDC provider. This package does not create or modify it.
- A GitHub repository and a protected Environment for deployments.
- GitHub CLI access if you want repository IDs and prerequisites discovered automatically.

Choose one stable dashboard name. It becomes the application stack and Lambda name. Renaming it or
the artifact bucket later is a migration.

Create the GitHub Environment and its branch policy before running preflight. Whether it requires
reviewers is your deployment-policy decision.

## 1. Install an exact package version

Run bootstrap from the repository that will own the dashboard deployment:

```sh
npm install --save-exact @continuous-excellence/ze-great-dashboard-aws
```

Commit the exact version in `package.json` and the lockfile. The bootstrap templates remain inside
that installed package, so a package upgrade is also a visible template upgrade. Append `@version`
when installing a previously reviewed release rather than the current one.

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

The command discovers the AWS account, configured Region, and GitHub numeric owner/repository IDs
when possible. If discovery is unavailable, it tells you which of `--account-id`, `--region`,
`--github-owner-id`, and `--github-repository-id` to supply. It refuses to overwrite an existing
manifest.

Review and commit `dashboard-bootstrap.json`. It contains names and IDs, never credentials.

If the deployment workflow must read one consumer-owned gateway stack, add
`--consumer-gateway-stack gateway-stack-name`. This grants only
`cloudformation:DescribeStacks` for that exact stack; bootstrap still does not create or configure
the gateway.

## 3. Check the plan

```sh
npm exec -- ze-great-dashboard-aws bootstrap preflight \
  --config dashboard-bootstrap.json --format text

npm exec -- ze-great-dashboard-aws bootstrap plan \
  --config dashboard-bootstrap.json --format text
```

Preflight reads AWS and GitHub prerequisites when it can. `missing` and `mismatch` results must be
resolved. `unverified` means a CLI, login, permission, or network was unavailable; it is not proof
that the prerequisite exists.

The plan is fully local. It shows each installed template's contract, revision, SHA-256, resources,
and declared IAM actions without changing AWS.

## 4. Run the guided core phase

Generated parameters and stack captures are working files, not source configuration. Add
`.bootstrap-work/` to `.gitignore`, then ask the installed package for the current phase:

```sh
mkdir -p .bootstrap-work
npm exec -- ze-great-dashboard-aws bootstrap guide \
  --config dashboard-bootstrap.json \
  --work-dir .bootstrap-work
```

The guide prints the parameter-generation command followed by explicit AWS change-set commands.
Run them one at a time. Pause at `describe-change-set` and review the expanded change before running
`execute-change-set`.

For the core stack, confirm:

- `CAPABILITY_NAMED_IAM` is expected.
- The artifact bucket blocks public access, requires TLS, and uses the intended encryption.
- The execution role is limited to the named application stack, Lambda, log group, runtime role,
  artifact prefix, and optional secret.
- No retained bucket or role is being replaced.

The last generated command writes `.bootstrap-work/core-deployed-stack.json`.

## 5. Run the guided GitHub phase

Pass the reviewed core capture back to the guide:

```sh
npm exec -- ze-great-dashboard-aws bootstrap guide \
  --config dashboard-bootstrap.json \
  --work-dir .bootstrap-work \
  --core-stack-json .bootstrap-work/core-deployed-stack.json
```

Before executing this change set, confirm:

- The provider ARN and `sts.amazonaws.com` audience are exact.
- The subject contains the immutable GitHub owner and repository IDs plus the protected Environment.
- Access is limited to one bucket's `lambda/*` prefix, one application stack, and the core execution
  role.
- No retained role is being replaced.

If the guide reports `immutable-subject-required`, stop and coordinate that GitHub OIDC migration
with the repository administrator. Changing the repository's OIDC subject can affect other AWS
trust policies.

The last generated command writes `.bootstrap-work/github-oidc-deployed-stack.json`.

## 6. Verify the handoff

```sh
npm exec -- ze-great-dashboard-aws bootstrap verify \
  --config dashboard-bootstrap.json \
  --core-stack-json .bootstrap-work/core-deployed-stack.json \
  --github-oidc-stack-json .bootstrap-work/github-oidc-deployed-stack.json | jq .
```

Verification checks both stack identities, Regions, contracts, parameters, outputs, and reviewed
role ARNs. Its output includes the two GitHub Environment variables to set:

- `AWS_DEPLOY_ROLE_ARN`
- `AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN`

The JSON also includes `gh variable set` argument arrays for an administrator who wants them. The
CLI does not modify GitHub; a GitHub administrator owns the Environment policy and those values.

Bootstrap is now complete. Continue with [Deploy the dashboard](aws-setup.md).

## Routine checks

Every deployment should run the fast, read-only consistency gate after assuming the GitHub deploy
role:

```sh
npm exec -- ze-great-dashboard-aws bootstrap check \
  --config dashboard-bootstrap.json --format text
```

It fails on inaccessible or unhealthy stacks and on identity, Region, parameter, output, contract,
or template-revision mismatches. Add `--resource-drift` only to a scheduled or manually triggered
audit; CloudFormation drift detection is slower.

## Upgrading bootstrap

Contract versions change only for coordinated migrations. Template revisions identify compatible
updates. When `bootstrap check` reports any mismatch, including a revision or newly required
parameter:

1. Install the target exact package version and review `bootstrap plan`.
2. Capture the current stack with `aws cloudformation describe-stacks`.
3. Generate parameters with `bootstrap parameters --deployed-stack-json` so existing values are
   preserved.
4. Use `bootstrap change-set --change-set-type UPDATE --format-shell` to produce the reviewed AWS
   command.
5. Inspect and execute the change set, capture the stack again, and rerun `bootstrap check`.
6. Repeat the process for every affected bootstrap stack, then rerun `bootstrap check`.

The GitHub OIDC v1-to-v2 change is a contract migration to immutable repository IDs. Generate fresh
v2 parameters from the reviewed core capture; a v1 deployed capture is intentionally rejected as a
parameter-merging source.

Never delete the retained artifact bucket or bootstrap roles as part of an upgrade. An unexecuted
change set can be cancelled with `aws cloudformation delete-change-set`.

For an administrator working entirely in AWS CloudShell, see the focused
[CloudShell runbook](aws-bootstrap-cloudshell.md).
