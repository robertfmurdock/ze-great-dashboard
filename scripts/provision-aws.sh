#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_OWNER_ID:?GITHUB_OWNER_ID is required}"
: "${GITHUB_REPOSITORY_ID:?GITHUB_REPOSITORY_ID is required}"

stack_name="ze-great-dashboard"
: "${CLOUDFORMATION_ROLE_ARN:?CLOUDFORMATION_ROLE_ARN is required}"

aws cloudformation deploy \
  --stack-name "$stack_name" \
  --template-file infra/stack.yml \
  --role-arn "$CLOUDFORMATION_ROLE_ARN" \
  --parameter-overrides \
    GitHubRepository="$GITHUB_REPOSITORY" \
    GitHubOwnerId="$GITHUB_OWNER_ID" \
    GitHubRepositoryId="$GITHUB_REPOSITORY_ID" \
  --capabilities CAPABILITY_NAMED_IAM \
  --tags Project=ze-great-dashboard ManagedBy=cloudformation \
  --no-fail-on-empty-changeset \
  --no-cli-pager

output() {
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text
}

echo "assets_bucket=$(output AssetsBucket)" >> "$GITHUB_OUTPUT"
echo "assets_base_url=$(output AssetsBaseUrl)" >> "$GITHUB_OUTPUT"
echo "deploy_role_arn=$(output DeployRoleArn)" >> "$GITHUB_OUTPUT"
