############################################################
# eks/prod/3-platform — required providers (루트 모듈)
# 루트에서 provider "kubectl" 를 쓰므로 source(gavinbunney)를 명시.
# 안 하면 hashicorp/kubectl 로 찾으려다 init 실패.
############################################################
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
    kubectl = {
      source  = "gavinbunney/kubectl"
      version = "~> 1.14"
    }
  }
}
