############################################################
# 서브넷/SG 디스커버리 태깅 (aws_ec2_tag = 태그 1개만 관리, 공존 안전)
#   ALB Controller : public=role/elb, private=role/internal-elb
#   Karpenter      : subnet·node SG 에 karpenter.sh/discovery=<cluster>
############################################################
locals {
  cluster        = data.terraform_remote_state.eks_cluster_prod.outputs.cluster_name
  public_subnets = data.terraform_remote_state.ecs_prod.outputs.public_subnet_ids
  priv_subnets   = data.terraform_remote_state.ecs_prod.outputs.private_subnet_ids
  node_sg        = data.terraform_remote_state.eks_cluster_prod.outputs.node_security_group_id
}

resource "aws_ec2_tag" "pub_elb" {
  for_each    = toset(local.public_subnets)
  resource_id = each.value
  key         = "kubernetes.io/role/elb"
  value       = "1"
}

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

resource "aws_ec2_tag" "priv_cluster" {
  for_each    = toset(local.priv_subnets)
  resource_id = each.value
  key         = "kubernetes.io/cluster/${local.cluster}"
  value       = "shared"
}

resource "aws_ec2_tag" "node_sg_karpenter" {
  resource_id = local.node_sg
  key         = "karpenter.sh/discovery"
  value       = local.cluster
}
