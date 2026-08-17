terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    # Only to zip the placeholder function body, so `apply` doesn't require a built artifact.
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # State is local and gitignored for now. It is a prototype with one operator; a state bucket is
  # worth adding the moment a second person or a CI apply enters the picture.
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "ze-great-dashboard"
      ManagedBy = "terraform"
    }
  }
}

# CloudFront reads certificates only from us-east-1, regardless of where anything else lives.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = "ze-great-dashboard"
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
