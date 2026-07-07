############################################################
# 공유 인프라(network=ECS prod) + 2-cluster output 읽기 (read-only)
############################################################

# 기존 ECS prod 스택 (VPC/subnet/RDS·Valkey SG/S3 정책). 브리지 outputs 사용.
data "terraform_remote_state" "ecs_prod" {
  backend = "s3"
  config = {
    bucket = "drawe-tfstate-933832340498"
    key    = "drawe/prod/terraform.tfstate"
    region = "ap-northeast-2"
  }
}

# eks/prod/2-cluster 스택 (cluster_name/oidc/node_sg). 먼저 apply 되어 있어야 함.
data "terraform_remote_state" "eks_cluster_prod" {
  backend = "s3"
  config = {
    bucket = "drawe-tfstate-933832340498"
    key    = "eks/prod/cluster/terraform.tfstate"
    region = "ap-northeast-2"
  }
}

locals {
  cluster_name = data.terraform_remote_state.eks_cluster_prod.outputs.cluster_name
}

# provider 인증용 — 라이브 cluster endpoint/CA 조회
data "aws_eks_cluster" "this" {
  name = local.cluster_name
}
