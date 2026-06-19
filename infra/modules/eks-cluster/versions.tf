############################################################
# modules/eks-cluster — required providers
#
# 이 모듈은 aws + tls 만 쓴다(컨트롤플레인·OIDC·애드온·노드그룹 전부 AWS API).
# kubernetes/helm provider 불필요 → "클러스터 만들면서 그 클러스터에 접속" 하는
# chicken-egg 자체가 없다. 그 작업은 3-platform 의 몫.
############################################################
terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.40"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}
