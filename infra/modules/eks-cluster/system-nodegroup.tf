############################################################
# system Managed Node Group (arm64) — 플랫폼 pod 상주용
#
# Karpenter 는 자기 자신이 띄울 노드 위에서 동작할 수 없으므로, ALB Controller·
# ESO·Karpenter·ArgoCD·CoreDNS 가 올라갈 작은 고정 노드그룹을 먼저 둔다.
# 이후 앱 pod 는 Pending → Karpenter 가 새 노드를 띄워 처리(3-platform).
############################################################
resource "aws_iam_role" "node" {
  name = "${local.name_prefix}-eks-node"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "node_worker" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}
resource "aws_iam_role_policy_attachment" "node_cni" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}
resource "aws_iam_role_policy_attachment" "node_ecr" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}
# SSH 미개방 — 접속은 SSM Session Manager (보안 체크리스트: 22 미개방)
resource "aws_iam_role_policy_attachment" "node_ssm" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_eks_node_group" "system" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "${local.name_prefix}-system"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = var.private_subnet_ids

  # AL2023 arm64 (Graviton) — DraWe 이미지가 전부 arm64
  ami_type       = "AL2023_ARM_64_STANDARD"
  instance_types = var.system_instance_types
  capacity_type  = "ON_DEMAND" # 플랫폼 핵심 pod 라 안정적으로(Spot 아님)
  disk_size      = var.system_disk_size_gib

  scaling_config {
    desired_size = var.system_desired_size
    min_size     = var.system_min_size
    max_size     = var.system_max_size
  }

  update_config {
    max_unavailable = 1
  }

  labels = {
    role = "system"
    # 참고: kubernetes.io/arch 는 kubelet 이 자동 설정(arm64). EKS 가 kubernetes.io/* 라벨을
    # 직접 지정하는 것을 거부하므로 여기서 넣지 않는다.
  }

  # taint 는 일부러 안 검. 플랫폼 헬름 차트들이 별도 toleration 없이도 스케줄되도록.
  # (엄격 분리가 필요하면 추후 CriticalAddonsOnly taint + toleration 추가)

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-system-ng" })

  # Prefix Delegation 설정이 노드 기동 전에 적용되도록 vpc-cni 애드온 이후 생성
  depends_on = [
    aws_eks_addon.vpc_cni,
    aws_iam_role_policy_attachment.node_worker,
    aws_iam_role_policy_attachment.node_cni,
    aws_iam_role_policy_attachment.node_ecr,
  ]

  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }
}
