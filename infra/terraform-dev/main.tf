terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    # ⌁ Cloudflare provider 추가 — domain_name 사용 시 ACM 검증 자동화
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.40"
    }
  }

  # ── Remote state (S3) ──────────────────────────────────

  backend "s3" {
    bucket         = "drawe-terraform-state-570515227314"
    key            = "dev/terraform.tfstate"
    region         = "ap-northeast-2"
    use_lockfile = true
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

############################################################
# Cloudflare provider
#
# api_token 은 var.cloudflare_api_token 또는 환경변수 CLOUDFLARE_API_TOKEN.
############################################################
provider "cloudflare" {
  api_token = var.cloudflare_api_token != "" ? var.cloudflare_api_token : null
}

# ── 최신 Amazon Linux 2023 AMI (ARM64 / Graviton) 자동 조회 ─
# x86_64 대신 arm64 — t4g, m7g, c8g 등 Graviton 인스턴스용
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_caller_identity" "current" {}
