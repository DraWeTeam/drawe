############################################################
# eks/prod/2-cluster — required providers (루트 모듈)
# 모듈(modules/eks-cluster)이 aws + tls 만 쓰므로 root 도 동일.
# 명시 안 해도 모듈에서 받아쓸 수 있지만, root 에 두는 게 terraform 권장 패턴.
############################################################
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}
