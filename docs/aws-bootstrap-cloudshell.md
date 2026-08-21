# CloudShell: validation core bootstrap

Use this runbook for the **core** half of the real-account validation only. It is a sequence of
explicit commands for an AWS administrator to run in AWS CloudShell; it is not an automation script.
Pause after the review command and execute the change set only after you approve its contents.

Before starting, the GitHub Environment `consumer-bootstrap-validation` must already be protected as
described in [the bootstrap guide](aws-bootstrap.md). This step creates the retained validation bucket
and the restricted CloudFormation execution role. It does not deploy the application or invoke Lambda.

## 1. Prepare CloudShell

Open CloudShell in **us-east-1** with the approved administrator identity, then run:

```sh
git clone https://github.com/robertfmurdock/ze-great-dashboard.git
cd ze-great-dashboard

# Replace this with the exact AWS package version published by the main release job.
export AWS_PACKAGE_VERSION=REPLACE_WITH_PUBLISHED_VERSION
export AWS_REGION=us-east-1
export VALIDATION_CONFIG=reference/consumer-bootstrap-validation.json

node --version
npm --version
aws sts get-caller-identity
```

Node must be version 22 or newer. Confirm that `get-caller-identity` reports account
`174159267544` and the intended administrator role before continuing. If CloudShell does not have
Node 22+, use an approved administrator workstation with Node 22+ instead; do not substitute an
older package runtime.

Install the exact published consumer interface into an isolated directory, then define stable local
names for the commands and stack:

```sh
npm install --prefix .bootstrap-tools --ignore-scripts --save-exact \
  "@continuous-excellence/ze-great-dashboard-aws@${AWS_PACKAGE_VERSION}"

export BOOTSTRAP_CLI=.bootstrap-tools/node_modules/.bin/ze-great-dashboard-aws
export CORE_STACK="$(jq -r '.core.stackName' "$VALIDATION_CONFIG")"
```

## 2. Generate and validate the local core inputs

These commands write only local files or make a read-only template-validation request:

```sh
"$BOOTSTRAP_CLI" bootstrap parameters \
  --kind core \
  --config "$VALIDATION_CONFIG" \
  --output core-bootstrap.json

CORE_TEMPLATE="$("$BOOTSTRAP_CLI" bootstrap template --kind core | jq -r .template)"

aws cloudformation validate-template \
  --template-body "file://${CORE_TEMPLATE}" \
  --region "$AWS_REGION"
```

Check the generated inputs before proceeding:

```sh
cat core-bootstrap.json
```

They must name these fixed validation resources:

- Core stack: `ze-great-dashboard-consumer-validation-bootstrap`
- Artifact bucket: `ze-great-dashboard-consumer-validation-artifacts-174159267544`
- Application stack/function: `ze-great-dashboard-consumer-validation`

If, and only if, the bucket name is already globally taken, change only
`core.artifactBucketName` in the manifest before creating the change set. Keep the chosen replacement
name in the manifest and subsequent review record.

## 3. Create the reviewable core change set

This is the first AWS write. It creates a **change set**, not the stack:

```sh
aws cloudformation create-change-set \
  --stack-name "$CORE_STACK" \
  --change-set-name core-initial-review \
  --change-set-type CREATE \
  --template-body "file://${CORE_TEMPLATE}" \
  --parameters file://core-bootstrap.json \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$AWS_REGION" \
  --no-cli-pager

aws cloudformation wait change-set-create-complete \
  --stack-name "$CORE_STACK" \
  --change-set-name core-initial-review \
  --region "$AWS_REGION"

aws cloudformation describe-change-set \
  --stack-name "$CORE_STACK" \
  --change-set-name core-initial-review \
  --region "$AWS_REGION"
```

Before executing, confirm the expected retained S3 bucket, TLS-only bucket policy, public-access
blocks, and a single execution role named
`ze-great-dashboard-consumer-validation-execution`. Do not approve replacement or deletion of a
retained resource.

## 4. Execute and capture the core contract

Only after the preceding review is approved:

```sh
aws cloudformation execute-change-set \
  --stack-name "$CORE_STACK" \
  --change-set-name core-initial-review \
  --region "$AWS_REGION"

aws cloudformation wait stack-create-complete \
  --stack-name "$CORE_STACK" \
  --region "$AWS_REGION"

aws cloudformation describe-stacks \
  --stack-name "$CORE_STACK" \
  --region "$AWS_REGION" \
  --no-cli-pager > core-deployed-stack.json

jq -r '.Stacks[0].Outputs[] | select(
  .OutputKey == "ArtifactBucketName" or
  .OutputKey == "CloudFormationExecutionRoleArn" or
  .OutputKey == "BootstrapContractVersion"
) | "\(.OutputKey)=\(.OutputValue)"' core-deployed-stack.json
```

The final output must include contract version `1`. Preserve `core-deployed-stack.json`: it is the
input to the GitHub OIDC adapter change set. Stop here for review before proceeding to the adapter.

## 5. Correct the GitHub OIDC adapter with v2

The initial validation adapter was created with the legacy GitHub OIDC subject and therefore denies
the protected workflow before it can reach AWS. After the package release containing
`github-oidc-v2.yml`, use its exact version below. This is an **UPDATE** of the existing adapter
stack; it does not recreate the core stack, bucket, execution role, or GitHub Environment.

```sh
# Replace this with the exact newly published package version, not 0.1.29.
export AWS_PACKAGE_VERSION=REPLACE_WITH_V2_PUBLISHED_VERSION

npm install --prefix .bootstrap-tools --ignore-scripts --save-exact \
  "@continuous-excellence/ze-great-dashboard-aws@${AWS_PACKAGE_VERSION}"

export BOOTSTRAP_CLI=.bootstrap-tools/node_modules/.bin/ze-great-dashboard-aws
export GITHUB_STACK="$(jq -r '.githubOidc.stackName' "$VALIDATION_CONFIG")"

"$BOOTSTRAP_CLI" bootstrap parameters \
  --kind github-oidc \
  --config "$VALIDATION_CONFIG" \
  --core-stack-json core-deployed-stack.json \
  --output github-bootstrap.json

GITHUB_TEMPLATE="$("$BOOTSTRAP_CLI" bootstrap template --kind github-oidc | jq -r .template)"
cat github-bootstrap.json
```

Confirm the parameter file contains `GitHubOwnerId` `6215634` and `GitHubRepositoryId`
`1338375095`. Create and inspect the migration change set:

```sh
aws cloudformation create-change-set \
  --stack-name "$GITHUB_STACK" \
  --change-set-name github-oidc-v2-review \
  --change-set-type UPDATE \
  --template-body "file://${GITHUB_TEMPLATE}" \
  --parameters file://github-bootstrap.json \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$AWS_REGION" \
  --no-cli-pager

aws cloudformation wait change-set-create-complete \
  --stack-name "$GITHUB_STACK" \
  --change-set-name github-oidc-v2-review \
  --region "$AWS_REGION"

aws cloudformation describe-change-set \
  --stack-name "$GITHUB_STACK" \
  --change-set-name github-oidc-v2-review \
  --region "$AWS_REGION"
```

Approve only a change to the existing GitHub deploy role's trust policy and
`BootstrapContractVersion` from `1` to `2`; do not approve role or resource replacement. Then:

```sh
aws cloudformation execute-change-set \
  --stack-name "$GITHUB_STACK" \
  --change-set-name github-oidc-v2-review \
  --region "$AWS_REGION"

aws cloudformation wait stack-update-complete \
  --stack-name "$GITHUB_STACK" \
  --region "$AWS_REGION"

aws cloudformation describe-stacks \
  --stack-name "$GITHUB_STACK" \
  --region "$AWS_REGION" \
  --no-cli-pager > github-oidc-deployed-stack.json

jq -r '.Stacks[0].Outputs[] | select(
  .OutputKey == "GitHubDeployRoleArn" or
  .OutputKey == "BootstrapContractVersion"
) | "\(.OutputKey)=\(.OutputValue)"' github-oidc-deployed-stack.json
```

The role ARN should remain the value already stored in the GitHub Environment. Dispatch the
validation workflow again with the exact v2 package version. It should now assume the generated
role; a successful artifact upload and application stack completion are the acceptance test.
