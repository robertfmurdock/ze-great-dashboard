#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

stack_name="ze-great-dashboard"

aws cloudformation deploy \
  --stack-name "$stack_name" \
  --template-file infra/stack.yml \
  --role-arn arn:aws:iam::174159267544:role/ZeGreatDashboardCloudFormationExecution \
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
echo "function_name=$(output ServerFunctionName)" >> "$GITHUB_OUTPUT"
echo "server_url=$(output ServerUrl)" >> "$GITHUB_OUTPUT"
echo "deploy_role_arn=$(output DeployRoleArn)" >> "$GITHUB_OUTPUT"
