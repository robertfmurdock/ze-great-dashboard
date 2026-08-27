#!/usr/bin/env bash
set -Eeuo pipefail

die() {
  echo "ERROR: $*" >&2
  exit 1
}

command -v aws >/dev/null || die 'aws CLI is required'
command -v jq >/dev/null || die 'jq is required'
command -v npm >/dev/null || die 'npm is required'

repository_root=$(git rev-parse --show-toplevel 2>/dev/null) || die 'run this inside the repository'
cd "$repository_root"

failed_sha=${1:-}
if [[ -z "$failed_sha" ]]; then
  die "usage: $0 FAILED_ACTION_SHA"
fi
current_sha=$(git rev-parse HEAD)
[[ "$current_sha" == "$failed_sha" ]] || die "HEAD is $current_sha; check out failed action commit $failed_sha first"

config=reference/consumer-bootstrap-validation.json
[[ -f "$config" ]] || die "missing $config"

region=$(jq -er '.region' "$config")
core_stack=$(jq -er '.core.stackName' "$config")
github_stack=$(jq -er '.githubOidc.stackName' "$config")
mkdir -p .bootstrap-work
work_dir=$(mktemp -d ".bootstrap-work/consumer-validation-repair.XXXXXX")
validation_cli=./node_modules/.bin/ze-great-dashboard-aws

echo "Repair artifacts will remain in $work_dir"
echo "Installing dependencies and building the package from $current_sha..."
npm ci
npm run build:packages
[[ -x "$validation_cli" ]] || die "missing $validation_cli after build"

echo "Capturing current bootstrap stacks (read-only)..."
aws cloudformation describe-stacks \
  --region "$region" \
  --stack-name "$core_stack" \
  > "$work_dir/core-deployed-stack.json"
aws cloudformation describe-stacks \
  --region "$region" \
  --stack-name "$github_stack" \
  > "$work_dir/github-bootstrap-deployed-stack.json"

echo "Generating preserved bootstrap parameters..."
"$validation_cli" bootstrap parameters \
  --config "$config" \
  --kind core \
  --deployed-stack-json "$work_dir/core-deployed-stack.json" \
  --output "$work_dir/core-bootstrap-parameters.json"
"$validation_cli" bootstrap parameters \
  --config "$config" \
  --kind github-oidc \
  --core-stack-json "$work_dir/core-deployed-stack.json" \
  --deployed-stack-json "$work_dir/github-bootstrap-deployed-stack.json" \
  --output "$work_dir/github-bootstrap-parameters.json"

core_change_set="repair-core-bootstrap-$(date +%s)"
github_change_set="repair-github-bootstrap-$(date +%s)"

echo "Generating reviewed AWS commands..."
"$validation_cli" bootstrap change-set \
  --config "$config" \
  --kind core \
  --parameters "$work_dir/core-bootstrap-parameters.json" \
  --stack-name "$core_stack" \
  --change-set-name "$core_change_set" \
  --format-shell > "$work_dir/core-change-set.json"
"$validation_cli" bootstrap change-set \
  --config "$config" \
  --kind github-oidc \
  --parameters "$work_dir/github-bootstrap-parameters.json" \
  --stack-name "$github_stack" \
  --change-set-name "$github_change_set" \
  --format-shell > "$work_dir/github-change-set.json"

echo
echo 'The generated handoffs are:'
jq '{kind, templateRevision, templateSha256, shellCommand}' "$work_dir/core-change-set.json"
jq '{kind, templateRevision, templateSha256, shellCommand}' "$work_dir/github-change-set.json"
echo
read -r -p 'Create both CloudFormation change sets? Review the commands above first [y/N] ' create_confirm
[[ "$create_confirm" =~ ^[Yy]$ ]] || die "stopped before creating change sets; artifacts remain in $work_dir"

create_change_set() {
  local handoff=$1
  mapfile -t command_args < <(jq -er '.awsCommand[1:][]' "$handoff")
  aws "${command_args[@]}"
}

create_change_set "$work_dir/core-change-set.json"
create_change_set "$work_dir/github-change-set.json"

echo
echo 'Change sets created. Review the expanded changes before continuing:'
aws cloudformation describe-change-set \
  --region "$region" \
  --stack-name "$core_stack" \
  --change-set-name "$core_change_set"
aws cloudformation describe-change-set \
  --region "$region" \
  --stack-name "$github_stack" \
  --change-set-name "$github_change_set"
echo
read -r -p 'Execute both reviewed CloudFormation updates? [y/N] ' execute_confirm
[[ "$execute_confirm" =~ ^[Yy]$ ]] || die "stopped before executing updates; change sets remain for review in AWS"

aws cloudformation execute-change-set \
  --region "$region" \
  --stack-name "$core_stack" \
  --change-set-name "$core_change_set"
aws cloudformation execute-change-set \
  --region "$region" \
  --stack-name "$github_stack" \
  --change-set-name "$github_change_set"

echo 'Waiting for both bootstrap updates to complete...'
aws cloudformation wait stack-update-complete --region "$region" --stack-name "$core_stack"
aws cloudformation wait stack-update-complete --region "$region" --stack-name "$github_stack"

echo 'Final bootstrap consistency check:'
"$validation_cli" bootstrap check --config "$config" --format text
echo "Repair complete. Artifacts remain in $work_dir"
