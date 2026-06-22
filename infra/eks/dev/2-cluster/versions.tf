############################################################
# eks/dev/2-cluster — required providers (루트 모듈)
# 모듈(modules/eks-cluster)이 aws + tls 만 쓰므로 root 도 동일.
############################################################
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}
