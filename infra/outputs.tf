output "assets_bucket" {
  description = "Sync published client versions here. Matches ASSETS_BUCKET in the CI workflow."
  value       = aws_s3_bucket.assets.bucket
}

output "assets_distribution_domain" {
  description = <<-EOT
    The d*.cloudfront.net name. Usable as an ASSET_PATH base immediately, with no DNS work at all —
    which is itself a demonstration of the one-variable property.
  EOT
  value       = aws_cloudfront_distribution.assets.domain_name
}

output "server_url" {
  description = "The Function URL. This is the dashboard."
  value       = aws_lambda_function_url.server.function_url
}

output "deploy_role_arn" {
  description = "Goes in the CI workflow's role-to-assume."
  value       = aws_iam_role.deploy.arn
}

output "certificate_validation_record" {
  description = <<-EOT
    The CNAME to add at GoDaddy to validate the certificate. Phase 1 of the apply — see README.md.
    Empty when assets_domain is "".
  EOT
  value = var.assets_domain == "" ? null : {
    name  = one(aws_acm_certificate.assets[0].domain_validation_options).resource_record_name
    value = one(aws_acm_certificate.assets[0].domain_validation_options).resource_record_value
  }
}

output "alias_record" {
  description = "The second GoDaddy CNAME: the custom domain pointed at the distribution."
  value = var.assets_domain == "" ? null : {
    name  = var.assets_domain
    value = aws_cloudfront_distribution.assets.domain_name
  }
}
