# AWS consumer bootstrap

This is the administrator-run security boundary for a dashboard deployment. Bootstrap stacks own a
private Lambda artifact bucket and the IAM roles that CI uses later. Routine CI can publish a Lambda
artifact and operate one application stack; it cannot create, update, or delete either bootstrap
stack, its bucket, or its roles.

The package ships two current versioned templates: `core-v1.yml` and `github-oidc-v2.yml`. Their logical
IDs, parameter names, resource names, outputs, and `BootstrapContractVersion` are a compatibility
contract. Do not rename them in compatible upgrades.

## Before you begin

- Install an exact, trusted package version and verify its provenance/integrity under your
  organization’s npm policy.
- Use an approved short-lived AWS administrator session. Never configure static AWS access keys.
- Confirm account, Region, partition, and the pre-existing central GitHub OIDC provider ARN.
- Choose a globally unique artifact bucket name and a stable application stack name. Changing either
  is a migration, not an in-place upgrade.
- For GitHub, first create the Environment and branch policy. The template trusts that environment
  rather than a branch ref, and binds the trust to GitHub's immutable numeric owner and repository
  IDs as well as their human-readable names. Whether reviewers are required is a deployment choice;
  the validation Environment below is deliberately unreviewed so it can operate as a release gate.

The package never runs mutating AWS CLI commands for bootstrap work. It validates inputs and emits
template locations, parameter files, and structured command arguments; administrators invoke every
change explicitly. The one exception is the clearly named `bootstrap check` diagnostic below. It
reads deployed state and never updates stack resources. `bootstrap change-set` reports the installed
package version, template contract/revision, and SHA-256 alongside a safely quoted copy/paste command
when requested with `--format-shell`; its machine-readable `awsCommand` array is the automation
contract.
The examples below deliberately create and inspect CloudFormation change sets. Do **not** use
`cloudformation deploy` for bootstrap work.

The consumer repository should check in the exact package version (`package.json` and its lockfile)
and its non-secret `dashboard-bootstrap.json` manifest. The CloudFormation templates remain owned by
the installed package; do not copy or symlink them into a second source tree. Generated parameter
files are disposable inputs for an administrator's reviewed change set, and `describe-stacks` JSON
files are observed state, not desired configuration. Use the read-only plan to make the installed
templates and their security scope visible in a pull request or CI summary:

```sh
npm exec -- ze-great-dashboard-aws bootstrap plan \
  --config dashboard-bootstrap.json --format text
```

The plan reports each template's package path, contract and revision, SHA-256, resources, and
declared IAM actions. The action list includes intentional deny statements as well as allows; the
CloudFormation change set remains the authority for the effective change. A package upgrade
therefore changes the inspected plan directly; it does not silently update AWS and does not require
synchronizing a checked-in generated template.

The canonical routine deployment gate compares both live bootstrap stacks with the manifest and
installed package. Run it after assuming the generated GitHub deploy role and before packaging:

```sh
npm exec -- ze-great-dashboard-aws bootstrap check \
  --config dashboard-bootstrap.json --format text
```

It exits nonzero on an inaccessible or unhealthy stack, or any identity, Region, parameter, output,
contract, or template-revision mismatch. For a slower scheduled or manually dispatched audit, add
`--resource-drift`; that runs CloudFormation drift detection and reports the logical resources and
property differences. “Consistency” is the fast manifest/package comparison; “resource drift” is
AWS’s separate out-of-band resource comparison.

## 1. Scaffold and preflight the manifest

```sh
npm install --save-exact @continuous-excellence/ze-great-dashboard-aws@1.2.3
npm exec -- ze-great-dashboard-aws bootstrap init --output dashboard-bootstrap.json \
  --slug team-dashboard --repository example/team-dashboard --environment production \
  --github-oidc-provider-arn arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com
# init refuses to overwrite. It reads identity, Region, and GitHub numeric IDs when available;
# pass --account-id, --region, --github-owner-id, and --github-repository-id for offline setup.
npm exec -- ze-great-dashboard-aws bootstrap preflight --config dashboard-bootstrap.json --format text

npm exec -- ze-great-dashboard-aws bootstrap template --kind core
npm exec -- ze-great-dashboard-aws bootstrap parameters --kind core \
  --config dashboard-bootstrap.json --output core-bootstrap.json

aws cloudformation validate-template \
  --template-body "file://$(npm exec -- ze-great-dashboard-aws bootstrap template --kind core | jq -r .template)" \
  --region "$(jq -r .region dashboard-bootstrap.json)"
```

When the deployment workflow also verifies a consumer-owned gateway stack, add
`--consumer-gateway-stack gateway-stack-name`. The generated GitHub OIDC v2 role receives only
`cloudformation:DescribeStacks` for that exact stack. Leave it unset when no gateway-stack read is
needed.

`preflight` is read-only. Its JSON is stable by default; unavailable AWS/GitHub CLI, authentication,
or network is reported as `unverified` so offline planning remains possible. A verified mismatch or
missing prerequisite stops the journey. GitHub Environment policy is reported only as context: its
branch, reviewer, and build-service rules remain an administrator decision.

For the normal guided journey, use a disposable working directory for generated parameters and AWS
captures. It is not source configuration and should be ignored by the consumer repository (add
`.bootstrap-work/` to its `.gitignore`):

```sh
mkdir -p .bootstrap-work
npm exec -- ze-great-dashboard-aws bootstrap guide \
  --config dashboard-bootstrap.json --work-dir .bootstrap-work
```

The guide renders the structured handoff in execution order, including capture filenames, expected
stack outputs, and explicit review pauses. It prints AWS commands but never runs them. After the
initial bootstrap, retain the captures only when useful for audit or upgrade verification; normal
application deployments need the checked-in manifest and package pin, not these files.

Optionally add `--artifact-kms-key-arn` for a customer CMK and `--runtime-secret-arn` for the sole
runtime secret the application is allowed to read. The core bucket enforces bucket-owner ownership,
all S3 public-access blocks, TLS-only requests, and SSE-S3 when no CMK is given.

## 2. Create a change set only

```sh
CORE_TEMPLATE="$(npm exec -- ze-great-dashboard-aws bootstrap template --kind core | jq -r .template)"
aws cloudformation create-change-set --stack-name "$(jq -r .core.stackName dashboard-bootstrap.json)" \
  --change-set-name initial-review --change-set-type CREATE \
  --template-body "file://${CORE_TEMPLATE}" --parameters file://core-bootstrap.json \
  --capabilities CAPABILITY_NAMED_IAM --region "$(jq -r .region dashboard-bootstrap.json)" --no-cli-pager
```

## 3. Wait and review

```sh
aws cloudformation wait change-set-create-complete --stack-name "$(jq -r .core.stackName dashboard-bootstrap.json)" \
  --change-set-name initial-review --region "$(jq -r .region dashboard-bootstrap.json)"
aws cloudformation describe-change-set --stack-name "$(jq -r .core.stackName dashboard-bootstrap.json)" \
  --change-set-name initial-review --region "$(jq -r .region dashboard-bootstrap.json)"
```

Review every expanded IAM action, IAM capability acknowledgement (`CAPABILITY_NAMED_IAM`), changed
resource, and replacement status. Confirm the bucket policy denies non-TLS access and the artifact
read grant is only `lambda/*`. Do not approve a replacement of retained bucket or role resources.
Cancel an unexecuted review with `aws cloudformation delete-change-set`.

## 4. Execute the reviewed change set

```sh
aws cloudformation execute-change-set --stack-name "$(jq -r .core.stackName dashboard-bootstrap.json)" \
  --change-set-name initial-review --region "$(jq -r .region dashboard-bootstrap.json)"
aws cloudformation wait stack-create-complete --stack-name "$(jq -r .core.stackName dashboard-bootstrap.json)" --region "$(jq -r .region dashboard-bootstrap.json)"
aws cloudformation describe-stacks --stack-name "$(jq -r .core.stackName dashboard-bootstrap.json)" --region "$(jq -r .region dashboard-bootstrap.json)" --no-cli-pager
```

Record the outputs, especially `ArtifactBucketName`, `CloudFormationExecutionRoleArn`,
`BootstrapContractVersion`, and `BootstrapTemplateRevision`, for the next reviewed bootstrap phase.

## GitHub OIDC adapter

Creation or modification of an account-wide GitHub OIDC provider belongs to central cloud
administration. Add its existing ARN, repository, immutable numeric owner/repository IDs, and
protected Environment to the checked-in manifest only after the GitHub Environment protections are
active. Capture the reviewed core stack output; the CLI derives the bucket, application stack, and
execution-role values from it. With GitHub CLI, the immutable IDs can be read without mutation:

```sh
gh api repos/OWNER/REPOSITORY --jq '[.owner.id, .id] | @tsv'
```

```sh
aws cloudformation describe-stacks \
  --stack-name "$(jq -r .core.stackName dashboard-bootstrap.json)" \
  --region "$(jq -r .region dashboard-bootstrap.json)" --no-cli-pager > core-deployed-stack.json
npm exec -- ze-great-dashboard-aws bootstrap parameters --kind github-oidc \
  --config dashboard-bootstrap.json --core-stack-json core-deployed-stack.json \
  --output github-bootstrap.json
GITHUB_TEMPLATE="$(npm exec -- ze-great-dashboard-aws bootstrap template --kind github-oidc | jq -r .template)"
aws cloudformation create-change-set --stack-name "$(jq -r .githubOidc.stackName dashboard-bootstrap.json)" \
  --change-set-name initial-review --change-set-type CREATE \
  --template-body "file://${GITHUB_TEMPLATE}" --parameters file://github-bootstrap.json \
  --capabilities CAPABILITY_NAMED_IAM --region "$(jq -r .region dashboard-bootstrap.json)" --no-cli-pager
```

Wait and inspect as above. Verify the exact provider ARN,
`repo:owner@owner-id/repository@repository-id:environment:name` subject, `sts.amazonaws.com`
audience, one bucket’s `lambda/*` prefix, one application stack, and only the core execution role
before executing the adapter change set.

### GitHub OIDC v1 to v2 migration

`github-oidc-v2.yml` moves trust from GitHub's legacy mutable-name subject to its immutable
owner/repository-ID subject. This is an intentional contract migration, not a silent compatible
upgrade. Keep the same stack name and role, generate a fresh parameter file from the captured core
output, create an `UPDATE` change set using the v2 template, and confirm that only the role's trust
policy and `BootstrapContractVersion` change. Do not pass v1 deployed JSON to the parameter-merging
command; the contract mismatch is the guard that makes this migration explicit.

## Validation manifest and GitHub Environment

The repository includes [`reference/consumer-bootstrap-validation.json`](../reference/consumer-bootstrap-validation.json)
for the account-`174159267544` validation. It has fixed, separately named bootstrap and application
stacks, an artifact bucket, and the source-free reference function. It contains no credential.

Before creating either stack, a GitHub administrator must create the
`consumer-bootstrap-validation` Environment in `robertfmurdock/ze-great-dashboard`, limit it to
the `main` branch, and leave required reviewers disabled. This unreviewed Environment is still the
OIDC trust boundary and holds the two deployment-role ARNs. Environment configuration is in GitHub,
not workflow YAML; the workflow names the Environment so only a `main` release can receive those
Environment-scoped values before it requests AWS credentials.

Use that manifest for the core change set. After an administrator has inspected and executed it,
capture `describe-stacks` as `core-deployed-stack.json`. Generate the OIDC adapter parameters from
that captured file exactly as in the preceding section, inspect the resulting change set, and only
then execute it.

For an administrator using AWS CloudShell, the exact core preparation, change-set review, execution,
and capture commands are in [the CloudShell validation runbook](aws-bootstrap-cloudshell.md).

Set these two Environment variables from the reviewed stack outputs (they are ARNs, not secrets):

- `AWS_DEPLOY_ROLE_ARN`: `GitHubDeployRoleArn` from the GitHub OIDC adapter stack.
- `AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN`: `CloudFormationExecutionRoleArn` from the captured core
  stack output.

Every `main` release automatically runs `Consumer bootstrap validation` before npm publication and
release tagging. It downloads the exact local candidate tarball, installs it in an isolated
directory, and verifies the installed version before doing any AWS work. It packages
`reference/board.yaml`, which has no source or credential, uploads only its `lambda/*` artifact,
and deploys only the validation application stack with the captured execution role. A successful
upload and `CREATE_COMPLETE` application stack are the end-to-end acceptance test; a failure blocks
npm publication and tagging. Candidate client assets may already be published at their immutable,
versioned CDN path. Do not add a Function URL, public Lambda invocation, or runtime smoke test here;
gateway access remains consumer-owned.

## Upgrades and recovery

### Check bootstrap consistency on every deployment

Contract versions change only for coordinated migrations; template revisions identify compatible
bootstrap updates. The normal pipeline command above checks both markers and all manifest-backed
parameters. A revision mismatch blocks application deployment and tells an administrator to review
the package-owned template and apply an explicit `UPDATE` change set. It never updates bootstrap.
Omitting an optional secret, KMS key, or gateway stack from the manifest means the CloudFormation
default empty value; freshly generated parameters clear an older deployed value during that reviewed
update rather than silently preserving configuration the manifest no longer declares.

Install the target exact package version, then capture deployed state and verify its contract version:

```sh
aws cloudformation describe-stacks --stack-name "$(jq -r .core.stackName dashboard-bootstrap.json)" --region "$(jq -r .region dashboard-bootstrap.json)" \
  --no-cli-pager > core-deployed-stack.json
npm exec -- ze-great-dashboard-aws bootstrap parameters --kind core \
  --config dashboard-bootstrap.json --deployed-stack-json core-deployed-stack.json \
  --output core-bootstrap.json
```

The parameters command preserves deployed values that the new parameter file does not replace and
fails on a contract mismatch; it never invokes AWS. Create an `UPDATE` change set with the explicit AWS
command above, inspect it, execute it, and capture deployed state again.

After the administrator update, rerun `bootstrap check` before application deployment. Stop on
account, Region, contract, revision, or parameter mismatch. Required-name, OIDC-trust, encryption, ownership,
bucket, or role changes are documented migrations: create reviewed replacement infrastructure and
move consumers deliberately. Never delete artifact buckets or bootstrap roles during an upgrade.
