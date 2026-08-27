#!/usr/bin/env bash
set -euo pipefail

: "${REFERENCE_RELEASE_DIR:?REFERENCE_RELEASE_DIR is required}"
: "${REFERENCE_ARTIFACT_BUCKET:?REFERENCE_ARTIFACT_BUCKET is required}"
: "${REFERENCE_EXECUTION_ROLE_ARN:?REFERENCE_EXECUTION_ROLE_ARN is required}"
: "${REFERENCE_VERSION:?REFERENCE_VERSION is required}"
: "${REFERENCE_ASSET_BASE_URL:?REFERENCE_ASSET_BASE_URL is required}"
: "${REFERENCE_SECRET_ARN:?REFERENCE_SECRET_ARN is required}"
: "${REFERENCE_PARAMETER_ARN:?REFERENCE_PARAMETER_ARN is required}"

region="${AWS_REGION:-us-east-1}"
composition_template="${REFERENCE_COMPOSITION_TEMPLATE:-reference/consumer-composition.yml}"
stack_name="${REFERENCE_STACK_NAME:-ze-great-dashboard-reference}"
artifact_key="$(jq -er '.artifactKey' "${REFERENCE_RELEASE_DIR}/release.json")"
template_key="templates/${artifact_key%.zip}.yml"

aws s3 cp "${REFERENCE_RELEASE_DIR}/lambda.zip" \
  "s3://${REFERENCE_ARTIFACT_BUCKET}/${artifact_key}" \
  --region "${region}"
aws s3 cp "${REFERENCE_RELEASE_DIR}/template.yml" \
  "s3://${REFERENCE_ARTIFACT_BUCKET}/${template_key}" \
  --region "${region}"

reference_status="$(aws cloudformation describe-stacks \
  --stack-name "${stack_name}" \
  --region "${region}" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || true)"
if [ "${reference_status}" = ROLLBACK_COMPLETE ]; then
  aws cloudformation delete-stack --stack-name "${stack_name}" --region "${region}"
  aws cloudformation wait stack-delete-complete --stack-name "${stack_name}" --region "${region}"
fi

jq -n \
  --arg template_url "https://${REFERENCE_ARTIFACT_BUCKET}.s3.amazonaws.com/${template_key}" \
  --arg artifact_bucket "${REFERENCE_ARTIFACT_BUCKET}" \
  --arg artifact_key "${artifact_key}" \
  --arg dashboard_version "${REFERENCE_VERSION}" \
  --arg asset_base_url "${REFERENCE_ASSET_BASE_URL}" \
  --arg board_path './board.yaml' \
  --arg secrets_name 'ze-great-dashboard-reference-secrets' \
  --arg parameter_name 'ze-great-dashboard-reference-parameter' \
  --arg secrets_reference "${REFERENCE_SECRET_ARN}" \
  --arg parameter_reference "${REFERENCE_PARAMETER_ARN}" \
  '[
    {"ParameterKey":"ApplicationTemplateUrl","ParameterValue":$template_url},
    {"ParameterKey":"LambdaArtifactBucket","ParameterValue":$artifact_bucket},
    {"ParameterKey":"LambdaArtifactKey","ParameterValue":$artifact_key},
    {"ParameterKey":"DashboardVersion","ParameterValue":$dashboard_version},
    {"ParameterKey":"AssetBaseUrl","ParameterValue":$asset_base_url},
    {"ParameterKey":"BoardConfigPath","ParameterValue":$board_path},
    {"ParameterKey":"SecretsName","ParameterValue":$secrets_name},
    {"ParameterKey":"ParameterName","ParameterValue":$parameter_name},
    {"ParameterKey":"SecretsReference","ParameterValue":$secrets_reference},
    {"ParameterKey":"ParameterReference","ParameterValue":$parameter_reference}
  ]' > "${REFERENCE_RELEASE_DIR}/composition-parameters.json"

composition_parameters_file="${REFERENCE_RELEASE_DIR}/composition-parameters.json"
if ! composition_parameter_count="$(jq -r 'if type == "array" then length else error("expected an array") end' \
  "${composition_parameters_file}")"; then
  echo "Unable to read composition parameters as a JSON array: ${composition_parameters_file}" >&2
  exit 1
fi
if [ "${composition_parameter_count}" -ne 10 ]; then
  echo "Expected 10 composition parameters, found ${composition_parameter_count}" >&2
  exit 1
fi
if ! empty_composition_parameters="$(jq -r '
  map(select((.ParameterValue // "") == "") | .ParameterKey) | join(", ")
' "${composition_parameters_file}")"; then
  echo "Unable to inspect composition parameter values: ${composition_parameters_file}" >&2
  exit 1
fi
if [ -n "${empty_composition_parameters}" ]; then
  echo "Composition parameters with empty values: ${empty_composition_parameters}" >&2
  exit 1
fi
if ! composition_parameters="$(jq -r 'map("\(.ParameterKey)=\(.ParameterValue)") | join(" ")' \
  "${composition_parameters_file}")"; then
  echo "Unable to convert composition parameters for AWS CLI: ${composition_parameters_file}" >&2
  exit 1
fi
echo "Deploying composition stack ${stack_name} with ${composition_parameter_count} parameters."

aws cloudformation deploy \
  --stack-name "${stack_name}" \
  --template-file "${composition_template}" \
  --role-arn "${REFERENCE_EXECUTION_ROLE_ARN}" \
  --region "${region}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ${composition_parameters} \
  --no-fail-on-empty-changeset \
  --no-cli-pager

expected_asset_path="$(jq -er '.clientAssetUrl' "${REFERENCE_RELEASE_DIR}/release.json")"
deployed_asset_path="$(aws cloudformation describe-stacks \
  --stack-name "${stack_name}" --region "${region}" \
  --query "Stacks[0].Outputs[?OutputKey=='AssetPath'].OutputValue" --output text)"
deployed_artifact_key="$(aws cloudformation describe-stacks \
  --stack-name "${stack_name}" --region "${region}" \
  --query "Stacks[0].Parameters[?ParameterKey=='LambdaArtifactKey'].ParameterValue" --output text)"
[ "${deployed_asset_path}" = "${expected_asset_path}" ]
[ "${deployed_artifact_key}" = "${artifact_key}" ]

invoke_health() {
  local output_path="$1"
  local output_key="$2"
  local function_arn
  function_arn="$(aws cloudformation describe-stacks \
    --stack-name "${stack_name}" --region "${region}" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" --output text)"
  aws lambda invoke --function-name "${function_arn}" --invocation-type RequestResponse \
    --payload '{"version":"2.0","rawPath":"/health","requestContext":{"http":{"method":"GET"}}}' \
    --cli-binary-format raw-in-base64-out --region "${region}" "${output_path}"
  jq -e '.statusCode == 200' "${output_path}" > /dev/null
}

invoke_health /tmp/reference-secrets-health.json SecretsFunctionArn
invoke_health /tmp/reference-parameter-health.json ParameterFunctionArn
