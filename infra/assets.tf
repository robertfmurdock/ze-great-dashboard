# The published client versions: an S3 bucket, private, reached only through CloudFront.
#
# Its own bucket rather than a folder in assets.zegreatrob.com, because that one is Coupling's and
# its CORS allowlists specific origins. This design needs `Access-Control-Allow-Origin: *`, and
# widening Coupling's posture to get it would be trading someone else's security for convenience.

resource "aws_s3_bucket" "assets" {
  bucket = "${var.name}-assets"
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id

  # Published versions live at distinct paths and are never overwritten, so object versioning adds
  # nothing — except for index.html, which a re-run of the same build does overwrite. Cheap
  # insurance on the one mutable object in the bucket.
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  # Wide open on purpose, and safe precisely because of what this bucket holds: immutable build
  # artifacts with zero environment values and zero secrets in them. Any origin may read them
  # because there is nothing here that isn't already public to anyone who loads the page.
  #
  # It has to be wide: the server fetches index.html cross-origin from wherever it happens to run,
  # which includes localhost, Lambda, and any future environment. Enumerating those would mean
  # editing infrastructure to add a developer.
  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id
  policy = data.aws_iam_policy_document.assets_bucket.json
}

data "aws_iam_policy_document" "assets_bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.assets.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    # Only this distribution, not "any CloudFront distribution in any account".
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.assets.arn]
    }
  }
}

resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "${var.name}-assets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# The response headers CORS needs. A managed policy rather than hand-rolled headers, because
# getting CORS subtly wrong here would show up as an unexplained blank board.
data "aws_cloudfront_response_headers_policy" "cors" {
  name = "Managed-CORS-With-Preflight"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "assets" {
  enabled         = true
  comment         = "${var.name} client assets"
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"

  aliases = var.assets_domain == "" ? [] : [var.assets_domain]

  origin {
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id                = "assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  default_cache_behavior {
    target_origin_id       = "assets"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.cors.id
  }

  # No custom_error_response and no default_root_object: this is an asset host, not a web app host.
  # SPA routing is the server's job, which is exactly what makes any board path serveable.

  viewer_certificate {
    cloudfront_default_certificate = var.assets_domain == ""
    acm_certificate_arn            = var.assets_domain == "" ? null : aws_acm_certificate.assets[0].arn
    ssl_support_method             = var.assets_domain == "" ? null : "sni-only"
    minimum_protocol_version       = var.assets_domain == "" ? null : "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}

# Validation is manual (DNS_VALIDATION at GoDaddy), so this is applied first and on its own — see
# README.md for the sequence. Terraform cannot wait for a record it cannot create.
resource "aws_acm_certificate" "assets" {
  count    = var.assets_domain == "" ? 0 : 1
  provider = aws.us_east_1

  domain_name       = var.assets_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}
