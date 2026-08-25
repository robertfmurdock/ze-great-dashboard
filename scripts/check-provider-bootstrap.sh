#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDFORMATION_ROLE_ARN:?CLOUDFORMATION_ROLE_ARN is required}"
: "${AWS_REGION:?AWS_REGION is required}"
: "${BOOTSTRAP_STACK_NAME:?BOOTSTRAP_STACK_NAME is required}"
: "${BOOTSTRAP_ASSETS_BUCKET_NAME:?BOOTSTRAP_ASSETS_BUCKET_NAME is required}"
: "${BOOTSTRAP_FUNCTION_NAME:?BOOTSTRAP_FUNCTION_NAME is required}"
: "${BOOTSTRAP_SERVER_ROLE_NAME:?BOOTSTRAP_SERVER_ROLE_NAME is required}"
: "${BOOTSTRAP_DEPLOY_ROLE_NAME:?BOOTSTRAP_DEPLOY_ROLE_NAME is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_OWNER_ID:?GITHUB_OWNER_ID is required}"
: "${GITHUB_REPOSITORY_ID:?GITHUB_REPOSITORY_ID is required}"

github_server_url="${GITHUB_SERVER_URL:-https://github.com}"
github_ref="${GITHUB_SHA:-main}"

print_remediation() {
  echo >&2
  echo 'Administrator action required:' >&2
  echo "  Instructions: ${github_server_url}/${GITHUB_REPOSITORY}/blob/${github_ref}/infra/README.md#one-time-bootstrap" >&2
  echo "  Template:     ${github_server_url}/${GITHUB_REPOSITORY}/blob/${github_ref}/infra/bootstrap.yml" >&2
  echo >&2
  echo 'Run from a checkout of this commit:' >&2
  echo '  aws cloudformation deploy \' >&2
  echo "    --region ${AWS_REGION} \\" >&2
  echo "    --stack-name ${BOOTSTRAP_STACK_NAME} \\" >&2
  echo '    --template-file infra/bootstrap.yml \' >&2
  echo '    --parameter-overrides \' >&2
  echo "      GitHubRepository=${GITHUB_REPOSITORY} \\" >&2
  echo "      GitHubOwnerId=${GITHUB_OWNER_ID} \\" >&2
  echo "      GitHubRepositoryId=${GITHUB_REPOSITORY_ID} \\" >&2
  echo "      StackName=ze-great-dashboard \\" >&2
  echo "      AssetsBucketName=${BOOTSTRAP_ASSETS_BUCKET_NAME} \\" >&2
  echo "      FunctionName=${BOOTSTRAP_FUNCTION_NAME} \\" >&2
  echo "      ServerRoleName=${BOOTSTRAP_SERVER_ROLE_NAME} \\" >&2
  echo "      DeployRoleName=${BOOTSTRAP_DEPLOY_ROLE_NAME} \\" >&2
  echo '    --capabilities CAPABILITY_NAMED_IAM \' >&2
  echo '    --tags Project=ze-great-dashboard ManagedBy=cloudformation' >&2
}

role_name="${CLOUDFORMATION_ROLE_ARN##*/}"
policy_response=''
if ! policy_response="$(aws iam get-role-policy \
  --role-name "$role_name" \
  --policy-name ZeGreatDashboardResources \
  --output json \
  --no-cli-pager 2>&1)"; then
  echo 'Provider bootstrap check could not inspect the CloudFormation execution role.' >&2
  echo 'Provider bootstrap may be out of date; an administrator must redeploy infra/bootstrap.yml.' >&2
  echo "$policy_response" >&2
  print_remediation
  exit 1
fi

if ! printf '%s' "$policy_response" | jq -e '
  .PolicyDocument |
  any(.Statement[]?;
    ((.Resource | if type == "array" then . else [.] end) | any(.[]; contains("role/ZeGreatDashboardReferenceSmoke"))) and
    ((.Action | if type == "array" then . else [.] end) | any(.[]; . == "iam:CreateRole"))
  )
' >/dev/null; then
  echo 'Provider bootstrap is out of date: the CloudFormation execution role cannot manage ZeGreatDashboardReferenceSmoke.' >&2
  echo 'An administrator must redeploy infra/bootstrap.yml before provisioning.' >&2
  print_remediation
  exit 1
fi

if ! printf '%s' "$policy_response" | jq -e '
  .PolicyDocument |
  any(.Statement[]?;
    ((.Resource | if type == "array" then . else [.] end) | any(.[]; contains("secret:ze-great-dashboard-reference-credentials-smoke-*"))) and
    ((.Action | if type == "array" then . else [.] end) | any(.[]; . == "secretsmanager:CreateSecret"))
  )
' >/dev/null; then
  echo 'Provider bootstrap is out of date: the CloudFormation execution role cannot manage the reference credential smoke secret.' >&2
  echo 'An administrator must redeploy infra/bootstrap.yml before provisioning.' >&2
  print_remediation
  exit 1
fi

echo 'Provider bootstrap check passed: the CloudFormation execution role can manage both reference smoke resources.'
