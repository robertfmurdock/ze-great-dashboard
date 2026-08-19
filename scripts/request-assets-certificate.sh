#!/usr/bin/env bash
set -euo pipefail

assets_domain="${1:-public-assets.zegreatrob.com}"
aws_region="us-east-1"

aws sts get-caller-identity --no-cli-pager > /dev/null

certificate_arn="$(aws acm list-certificates \
  --region "$aws_region" \
  --certificate-statuses ISSUED PENDING_VALIDATION \
  --query "CertificateSummaryList[?DomainName=='${assets_domain}'] | [0].CertificateArn" \
  --output text \
  --no-cli-pager)"

if [[ -z "$certificate_arn" || "$certificate_arn" == "None" ]]; then
  certificate_arn="$(aws acm request-certificate \
    --region "$aws_region" \
    --domain-name "$assets_domain" \
    --validation-method DNS \
    --key-algorithm RSA_2048 \
    --options CertificateTransparencyLoggingPreference=ENABLED \
    --tags \
      Key=Project,Value=ze-great-dashboard \
      Key=Purpose,Value=public-assets \
    --query CertificateArn \
    --output text \
    --no-cli-pager)"
  echo "Requested a new certificate."
else
  echo "Reusing the existing certificate request."
fi

echo "Waiting for ACM to produce its DNS validation record..."
validation_name=""
for _ in {1..30}; do
  validation_name="$(aws acm describe-certificate \
    --region "$aws_region" \
    --certificate-arn "$certificate_arn" \
    --query 'Certificate.DomainValidationOptions[0].ResourceRecord.Name' \
    --output text \
    --no-cli-pager)"

  if [[ -n "$validation_name" && "$validation_name" != "None" ]]; then
    break
  fi

  sleep 2
done

if [[ -z "$validation_name" || "$validation_name" == "None" ]]; then
  echo "ACM did not produce a validation record within 60 seconds." >&2
  echo "Certificate ARN: $certificate_arn" >&2
  exit 1
fi

validation_value="$(aws acm describe-certificate \
  --region "$aws_region" \
  --certificate-arn "$certificate_arn" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord.Value' \
  --output text \
  --no-cli-pager)"

godaddy_name="${validation_name%.}"
godaddy_name="${godaddy_name%.zegreatrob.com}"

cat <<EOF

Certificate ARN:
$certificate_arn

Add this record to the zegreatrob.com DNS zone in GoDaddy:

Type:  CNAME
Name:  $godaddy_name
Value: $validation_value
TTL:   1 hour

Keep this CNAME permanently so ACM can renew the certificate.

After adding it, check validation with:

aws acm wait certificate-validated --region $aws_region --certificate-arn $certificate_arn
aws acm describe-certificate --region $aws_region --certificate-arn $certificate_arn --query 'Certificate.Status' --output text --no-cli-pager
EOF
