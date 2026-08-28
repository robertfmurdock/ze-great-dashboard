# AWS bootstrap upgrade runbook

Use this runbook when `bootstrap check` reports a stale desired state, contract, template revision, parameter,
output, access, or drift problem. It is an administrator procedure: the dashboard package generates
commands, but never creates, updates, executes, or deletes AWS resources.

## Identify the exact inputs

Start with the failed action's recorded dashboard package version and the consumer's
`dashboard-bootstrap.json`. Use the package version and configuration revision/provenance that the
consumer's own release process records; consumers do not need to use Git commits as versions. If
this repository's workflow produced the failure, its commit SHA is a useful way to reproduce the
workflow inputs, but it is not a requirement for other consumers.

```sh
npm exec -- ze-great-dashboard-aws bootstrap plan --config dashboard-bootstrap.json --format text
```

The installed package version and templates must match the package that produced the failure. Do not
repair from an unpinned working tree. The failure report names the affected stacks and links back to
this versioned document. Preserve the consumer's normal release evidence for the config and package
alongside the repair artifacts; no particular source-control or versioning system is assumed.

For an intentional package upgrade that changes bootstrap template identity, first update the
pinned npm package. Then run the only command that mutates the manifest, review its package/template
metadata, and commit it:

```sh
npm exec -- ze-great-dashboard-aws bootstrap upgrade --config dashboard-bootstrap.json
```

The manifest remains desired state; this command never reads AWS or adopts deployed values. Have
the consumer's approved Git, CodePipeline, GitHub Actions, or other deployment process consume the
committed package and manifest, generate and preview CloudFormation UPDATE change sets, and execute
only approved changes. Manual CLI invocation is a portable fallback, not a required operating model.
If the package version changes without changing either selected bootstrap template's contract or
revision, no manifest update or bootstrap redeploy is required.

## Capture and preserve

Create a private work directory and capture both bootstrap stacks, even if only one is reported as
affected. Use the exact stack names from the manifest:

```sh
mkdir -p .bootstrap-work
aws cloudformation describe-stacks --stack-name CORE_STACK --region REGION --output json --no-cli-pager > .bootstrap-work/core-deployed-stack.json
aws cloudformation describe-stacks --stack-name GITHUB_OIDC_STACK --region REGION --output json --no-cli-pager > .bootstrap-work/github-oidc-deployed-stack.json

npm exec -- ze-great-dashboard-aws bootstrap parameters --kind core \
  --config dashboard-bootstrap.json \
  --deployed-stack-json .bootstrap-work/core-deployed-stack.json \
  --output .bootstrap-work/core-bootstrap-parameters.json
npm exec -- ze-great-dashboard-aws bootstrap parameters --kind github-oidc \
  --config dashboard-bootstrap.json \
  --deployed-stack-json .bootstrap-work/github-oidc-deployed-stack.json \
  --core-stack-json .bootstrap-work/core-deployed-stack.json \
  --output .bootstrap-work/github-oidc-bootstrap-parameters.json
```

Review the captures and parameter files. Preserving values is not approval: verify that the
parameters retain the intended bucket, names, IDs, mode, and optional integrations.

## Generate, inspect, and execute updates

Create, inspect, and execute each change set only after the preceding review checkpoint passes.

Generate one reviewed UPDATE change-set command for each affected stack:

```sh
npm exec -- ze-great-dashboard-aws bootstrap change-set --kind core \
  --config dashboard-bootstrap.json --stack-name CORE_STACK \
  --change-set-name repair-core --change-set-type UPDATE \
  --parameters .bootstrap-work/core-bootstrap-parameters.json
npm exec -- ze-great-dashboard-aws bootstrap change-set --kind github-oidc \
  --config dashboard-bootstrap.json --stack-name GITHUB_OIDC_STACK \
  --change-set-name repair-github-oidc --change-set-type UPDATE \
  --parameters .bootstrap-work/github-oidc-bootstrap-parameters.json
```

The CLI emits the AWS `create-change-set` command only; inspect its template path, parameters,
capabilities, region, and stack name before running it. In CloudFormation, wait for the change set,
inspect every resource and IAM action, and then execute it explicitly. Do not execute an update whose
replacement, deletion, trust policy, or retained-resource behavior is not understood. Capture the
stack again after each successful update.

For a compatible template revision, preserve the existing parameters and apply the reviewed UPDATE.
For a contract migration, stop and follow the migration's documented sequencing. In particular,
GitHub OIDC migrations that require immutable repository IDs must use fresh, reviewed values; an old
capture must not be used to silently invent those values. Compute-mode changes likewise require a
deliberate regenerated manifest and review rather than an implicit switch.

## Validate again

After both affected stacks are stable, capture both stacks and run the final read-only check:

```sh
npm exec -- ze-great-dashboard-aws bootstrap check \
  --config dashboard-bootstrap.json --format text
```

Do not proceed to application deployment until it passes. If it fails again, preserve the new report,
compare the new captures with the expected package revision, and repeat the review—not a blind retry.

## Never automate or delete

Never delete a bootstrap stack, retained artifact bucket, bootstrap role, OIDC provider, or secret as
a repair shortcut. Never put credentials in the manifest or captured artifacts. Never grant CI the
authority to update bootstrap stacks, and never make the workflow execute generated change sets.
An unexecuted change set may be inspected and, if necessary, cancelled with
`aws cloudformation delete-change-set`; that is not permission to delete the stack or its resources.
