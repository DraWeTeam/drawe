############################################################
# 서브넷/SG 디스커버리 태깅
#
# - ALB Controller : public=kubernetes.io/role/elb, private=internal-elb
# - Karpenter      : subnet·SG 에 karpenter.sh/discovery=<cluster>
#
# aws_ec2_tag 는 리소스를 "소유"하지 않고 태그 1개만 관리 → ECS 가 만든 서브넷에
# 안전하게 태그를 덧붙일 수 있다(공존 안전).
############################################################
locals {
  cluster        = data.terraform_remote_state.eks_cluster_dev.outputs.cluster_name
  public_subnets = data.terraform_remote_state.ecs_dev.outputs.public_subnet_ids
  priv_subnets   = data.terraform_remote_state.ecs_dev.outputs.private_subnet_ids
  node_sg        = data.terraform_remote_state.eks_cluster_dev.outputs.node_security_group_id
}

# ── public 서브넷: 외부 ALB 자동탐색 ──
resource "aws_ec2_tag" "pub_elb" {
  for_each    = toset(local.public_subnets)
  resource_id = each.value
  key         = "kubernetes.io/role/elb"
  value       = "1"
}

# ── private 서브넷: 내부 ALB + Karpenter 노드 배치/탐색 ──
resource "aws_ec2_tag" "priv_internal_elb" {
  for_each    = toset(local.priv_subnets)
  resource_id = each.value
  key         = "kubernetes.io/role/internal-elb"
  value       = "1"
}

resource "aws_ec2_tag" "priv_karpenter" {
  for_each    = toset(local.priv_subnets)
  resource_id = each.value
  key         = "karpenter.sh/discovery"
  value       = local.cluster
}

# 클러스터 소속 표시(권장)
resource "aws_ec2_tag" "priv_cluster" {
  for_each    = toset(local.priv_subnets)
  resource_id = each.value
  key         = "kubernetes.io/cluster/${local.cluster}"
  value       = "shared"
}

# ── Karpenter 가 노드 SG 를 찾도록 node SG 태깅 ──
resource "aws_ec2_tag" "node_sg_karpenter" {
  resource_id = local.node_sg
  key         = "karpenter.sh/discovery"
  value       = local.cluster
}
