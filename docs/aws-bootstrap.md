# AWS consumer bootstrap

This is the administrator-run security boundary for a dashboard deployment. Bootstrap stacks own a
private Lambda artifact bucket and the IAM roles that CI uses later. Routine CI can publish a Lambda
artifact and operate one application stack; it cannot create, update, or delete either bootstrap
stack, its bucket, or its roles.

The package ships two versioned templates: `core-v1.yml` and `github-oidc-v1.yml`. Their logical
IDs, parameter names, resource names, outputs, and `BootstrapContractVersion` are a compatibility
contract. Do not rename them in compatible upgrades.

## Before you begin

- Install an exact, trusted package version and verify its provenance/integrity under your
  organization’s npm policy.
- Use an approved short-lived AWS administrator session. Never configure static AWS access keys.
- Confirm account, Region, partition, and the pre-existing central GitHub OIDC provider ARN.
- Choose a globally unique artifact bucket name and a stable application stack name. Changing either
  is a migration, not an in-place upgrade.
- For GitHub, first create the protected Environment, required reviewers, and branch policy. The
  template trusts that environment rather than a branch ref.

The package never runs AWS CLI commands for bootstrap work. It validates inputs and emits template
locations, parameter files, and structured command arguments; administrators invoke AWS explicitly.
`bootstrap status` and `bootstrap change-set` can also include a safely quoted copy/paste command
with `--format-shell`; their default machine-readable `awsCommand` array is the automation contract.
The examples below deliberately create and inspect CloudFormation change sets. Do **not** use
`cloudformation deploy` for bootstrap work.

## 1. Generate and validate inputs

```sh
npm install --save-exact @continuous-excellence/ze-great-dashboard-aws@1.2.3
cp node_modules/@continuous-excellence/ze-great-dashboard-aws/bootstrap/dashboard-bootstrap.example.json \
  dashboard-bootstrap.json
# Edit dashboard-bootstrap.json, commit it, and keep it free of credentials.

npm exec -- ze-great-dashboard-aws bootstrap template --kind core
npm exec -- ze-great-dashboard-aws bootstrap parameters --kind core \
  --config dashboard-bootstrap.json --output core-bootstrap.json

aws cloudformation validate-template \
  --template-body "file://$(npm exec -- ze-great-dashboard-aws bootstrap template --kind core | jq -r .template)" \
  --region "$(jq -r .region dashboard-bootstrap.json)"
```

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

Record the outputs, especially `ArtifactBucketName`, `CloudFormationExecutionRoleArn`, and
`BootstrapContractVersion`, in the consumer deployment repository.

## GitHub OIDC adapter

Creation or modification of an account-wide GitHub OIDC provider belongs to central cloud
administration. Add its existing ARN, the repository, and protected Environment to the checked-in
manifest only after the GitHub Environment protections are active. Capture the reviewed core stack
output; the CLI derives the bucket, application stack, and execution-role values from it:

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

Wait and inspect as above. Verify the exact provider ARN, `repo:owner/repository:environment:name`
subject, `sts.amazonaws.com` audience, one bucket’s `lambda/*` prefix, one application stack, and
only the core execution role before executing the adapter change set.

## Upgrades and recovery

Install the target exact package version, then capture deployed state and verify its contract version:

```sh
aws cloudformation describe-stacks --stack-name "$(jq -r .core.stackName dashboard-bootstrap.json)" --region "$(jq -r .region dashboard-bootstrap.json)" \
  --no-cli-pager > core-deployed-stack.json
npm exec -- ze-great-dashboard-aws bootstrap parameters --kind core \
  --config dashboard-bootstrap.json --deployed-stack-json core-deployed-stack.json \
  --output core-bootstrap.json
```

The CLI preserves deployed parameter values that the new parameter file does not replace and fails
on a contract mismatch; it never invokes AWS. Create an `UPDATE` change set with the explicit AWS
command above, inspect it, execute it, and capture deployed state again.

Stop on account, Region, or contract mismatch. Required-name, OIDC-trust, encryption, ownership,
bucket, or role changes are documented migrations: create reviewed replacement infrastructure and
move consumers deliberately. Never delete artifact buckets or bootstrap roles during an upgrade.
