############################################################
# EKS 컨트롤플레인 + cluster IAM role
############################################################
locals {
  name_prefix  = var.name_prefix != "" ? var.name_prefix : "${var.project}-${var.env}"
  cluster_name = var.cluster_name != "" ? var.cluster_name : "${var.project}-${var.env}"

  common_tags = merge({
    Project     = var.project
    Environment = var.env
    ManagedBy   = "terraform"
    Layer       = "2-cluster"
  }, var.tags)
}

# ── cluster IAM role ──
resource "aws_iam_role" "cluster" {
  name = "${local.name_prefix}-eks-cluster"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "eks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "cluster_policy" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

# Security Groups for Pods(branch ENI) 활성화에 필요 — 3-platform §5-C A안 전제
resource "aws_iam_role_policy_attachment" "cluster_vpc_resource_controller" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSVPCResourceController"
}

# ── 클러스터 ──
resource "aws_eks_cluster" "this" {
  name     = local.cluster_name
  version  = var.k8s_version
  role_arn = aws_iam_role.cluster.arn

  vpc_config {
    # private 에 노드/ENI, public 은 ALB 자동탐색용 — 둘 다 클러스터에 등록
    subnet_ids              = concat(var.private_subnet_ids, var.public_subnet_ids)
    endpoint_private_access = true
    endpoint_public_access  = var.endpoint_public_access
    public_access_cidrs     = var.public_access_cidrs
  }

  # 접근제어는 Access Entry(API) 사용. 클러스터 생성자는 자동 admin → 바로 kubectl 가능.
  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true
  }

  # 컨트롤플레인 로깅(감사/디버깅)
  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]

  tags = merge(local.common_tags, { Name = local.cluster_name })

  depends_on = [
    aws_iam_role_policy_attachment.cluster_policy,
    aws_iam_role_policy_attachment.cluster_vpc_resource_controller,
  ]
}
