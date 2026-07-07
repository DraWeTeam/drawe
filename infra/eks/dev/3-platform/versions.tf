############################################################
# eks/dev/3-platform — required providers (루트 모듈)
#
# 루트에서 provider "kubectl" 를 설정하므로 그 source(gavinbunney)를
# 여기서 명시해야 한다. 안 하면 Terraform 이 kubectl 을 기본 네임스페이스
# hashicorp/kubectl 로 찾으려다 init 이 실패한다.
# (aws/kubernetes/helm 도 함께 선언해 버전 고정.)
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
