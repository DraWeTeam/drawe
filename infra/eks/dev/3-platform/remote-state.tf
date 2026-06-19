############################################################
# 공유 인프라(network=ECS) + 2-cluster output 읽기
############################################################

# 1-network = 기존 ECS dev 스택 (VPC/subnet/RDS SG). §4-4 에서 outputs 추가 필요.
data "terraform_remote_state" "ecs_dev" {
  backend = "s3"
  config = {
    bucket = "drawe-terraform-state-570515227314"
    key    = "dev/terraform.tfstate"
    region = "ap-northeast-2"
  }
}

# 2-cluster = eks/dev/2-cluster 스택 (cluster_name/oidc/node_sg). 먼저 apply 되어 있어야 함.
data "terraform_remote_state" "eks_cluster_dev" {
  backend = "s3"
  config = {
    bucket = "drawe-terraform-state-570515227314"
    key    = "eks/dev/cluster/terraform.tfstate"
    region = "ap-northeast-2"
  }
}

locals {
  cluster_name = data.terraform_remote_state.eks_cluster_dev.outputs.cluster_name
}

# provider 인증용 — 라이브 cluster endpoint/CA 조회
data "aws_eks_cluster" "this" {
  name = local.cluster_name
}
