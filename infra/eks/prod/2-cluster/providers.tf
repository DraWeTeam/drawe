############################################################
# providers — aws + tls 만 (이 레이어는 K8s API 접속 안 함)
############################################################
provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = var.project
      Environment = var.env
      ManagedBy   = "terraform"
      Layer       = "2-cluster"
    }
  }
}

provider "tls" {}
