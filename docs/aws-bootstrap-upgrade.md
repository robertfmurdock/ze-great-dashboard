# Upgrade or repair AWS bootstrap

Use this administrator runbook when `bootstrap check` reports stale desired state, contract,
template revision, parameters, outputs, access, or drift. Stop application deployment until the
check passes again.

The dashboard package generates files and AWS command arguments. It never creates, updates,
executes, or deletes AWS resources; the administrator reviews and runs each AWS operation.

## Confirm the intended version

Install the exact package version approved by the deployment owner and use its
`dashboard-bootstrap.json`:

```sh
npm exec -- ze-great-dashboard-aws bootstrap plan --config dashboard-bootstrap.json --format text
```

Do not repair from an unpinned working tree. Confirm that the plan names the expected compute mode,
package, bootstrap contracts, template revisions, resources, and IAM actions.

If an intentional package upgrade changed a selected bootstrap template's identity, update the
manifest metadata and review that change:

```sh
npm exec -- ze-great-dashboard-aws bootstrap upgrade --config dashboard-bootstrap.json
```

This command changes desired-state metadata only. It does not read AWS or adopt deployed values. If
neither selected template's contract nor revision changed, a package-version change alone requires
no manifest update or bootstrap deployment.

## Capture current stacks and preserve parameters

Use the exact stack names and Region from the manifest. Keep `.bootstrap-work/` private and out of
source control:

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

Review both captures and parameter files. Preserved values are not automatically approved: verify
the intended bucket, names, immutable GitHub IDs, protected Environment, compute mode, secret ARN,
and optional gateway integration.

## Create and review update change sets

Create, inspect, and execute each change set separately so every AWS mutation remains visible at the
administrator boundary.

Generate a command for each affected stack:

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

The CLI emits each AWS `create-change-set` command but does not run it. Before invoking a command,
inspect its template path, parameters, capabilities, Region, and stack name. In CloudFormation, wait
for the change set, inspect every resource and IAM action, and execute it only when all replacement,
deletion, trust-policy, and retained-resource effects are understood. Capture each stack again after
its update completes.

For a compatible template revision, preserve reviewed parameters and apply the update. For a
contract migration, follow the migration sequencing reported by the package. GitHub OIDC migrations
to immutable repository IDs require fresh, reviewed IDs; do not infer them from an old capture.
Changing between Lambda and ECS likewise requires a deliberately regenerated manifest, bootstrap,
and application parameters.

## Revalidate

After every affected stack is stable, capture both stacks again and run:

```sh
npm exec -- ze-great-dashboard-aws bootstrap check \
  --config dashboard-bootstrap.json --format text
```

Do not resume application deployment until this passes. If it fails, compare the new report and
captures with the approved package and manifest rather than blindly retrying.

## Recovery boundaries

Never delete a bootstrap stack, retained artifact bucket, bootstrap role, OIDC provider, or secret
as a repair shortcut. Never put credentials in the manifest, captures, or generated parameters.
Never grant deployment automation authority to update bootstrap stacks or execute generated
bootstrap change sets.

An unexecuted change set may be inspected and cancelled with
`aws cloudformation delete-change-set`; this does not authorize deletion of the stack or its
resources.
