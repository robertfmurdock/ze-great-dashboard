#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDFORMATION_ROLE_ARN:?CLOUDFORMATION_ROLE_ARN is required}"

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
  exit 1
fi

echo 'Provider bootstrap check passed: the CloudFormation execution role can manage the Docker smoke-test role.'
