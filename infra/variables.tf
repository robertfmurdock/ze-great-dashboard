variable "region" {
  description = "Region for the Lambda function and its role. Assets are global via CloudFront."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Base name for every resource, so one grep finds all of it."
  type        = string
  default     = "ze-great-dashboard"
}

variable "assets_domain" {
  description = <<-EOT
    Custom domain for the assets distribution. The zone is at GoDaddy, not Route53, so this needs
    two manual CNAMEs — see README.md. Set to "" to skip the certificate and alias entirely and use
    the d*.cloudfront.net name instead, which works fine and is a decent way to start.
  EOT
  type        = string
  default     = "assets.dashboard.zegreatrob.com"
}

variable "github_repository" {
  description = "owner/repo allowed to assume the deploy role. Scoping this is the point of OIDC."
  type        = string
  default     = "robertfmurdock/ze-great-dashboard"
}

variable "initial_asset_path" {
  description = <<-EOT
    ASSET_PATH for the function before the first deploy has published anything.

    The server refuses to start without a reachable template, so on a fresh apply the function is
    expected to fail until CI publishes a version and overwrites this. That is the honest state of
    affairs rather than a bug: there is no client yet.
  EOT
  type        = string
  default     = "https://assets.dashboard.zegreatrob.com/dashboard/none"
}
