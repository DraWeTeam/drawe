############################################################
# modules/eks-platform — required providers
#
# helm 은 v2 계열(2.17)로 고정한다. helm provider v3 는 set 블록 문법이
# `set = [{...}]` 리스트 attribute 로 바뀌어 이 모듈의 set {} 블록과 호환되지 않는다.
# v3 로 올릴 때 set 문법을 함께 수정할 것.
#
# kubectl(gavinbunney) 은 CRD(EC2NodeClass/NodePool/ClusterSecretStore/Application)을
# plan 시점 API 검증 없이 apply 하기 위해 사용한다. kubernetes_manifest 는 plan 때
# 라이브 API 를 호출하므로 "CRD 가 아직 없는 최초 apply"에서 실패한다(chicken-egg).
############################################################
terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    kubectl = {
      source  = "gavinbunney/kubectl"
      version = "~> 1.14"
    }
  }
}
