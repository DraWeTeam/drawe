############################################################
# Karpenter — 워크로드 노드 오토프로비저닝 (ECS ASG/Capacity Provider 대체)
#
# 구성:
#   1) Node IAM role (Karpenter 가 띄우는 EC2 가 사용) + instance profile
#   2) SQS interruption queue + EventBridge 규칙 (Spot 회수/리밸런스 우아 처리)
#   3) Karpenter controller IRSA role
#   4) helm: karpenter-crd + karpenter
#   5) EC2NodeClass + NodePool (karpenter.k8s.aws/v1, karpenter.sh/v1)
#
# 전제: 2-cluster 에 Karpenter pod 가 상주할 소형 managed node group 이 있어야 한다
#       (Karpenter 는 자기 자신이 띄울 노드 위에서 동작할 수 없음).
############################################################

# ── 1) Node IAM role + instance profile ──────────────
resource "aws_iam_role" "karpenter_node" {
  name = "${local.name_prefix}-karpenter-node"
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
  role       = aws_iam_role.karpenter_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}
resource "aws_iam_role_policy_attachment" "node_cni" {
  role       = aws_iam_role.karpenter_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}
resource "aws_iam_role_policy_attachment" "node_ecr" {
  role       = aws_iam_role.karpenter_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}
# SSH 미개방 — 운영 접속은 SSM Session Manager (보안 체크리스트: 22 미개방)
resource "aws_iam_role_policy_attachment" "node_ssm" {
  role       = aws_iam_role.karpenter_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Karpenter v1 은 instance profile 을 스스로 생성/관리하므로 여기서 만들 필요는 없으나,
# 명시적으로 두면 디버깅이 쉽다(EC2NodeClass.role 로 role 이름을 넘기면 Karpenter 가 처리).

# ── 1.5) Karpenter 노드를 클러스터에 인가 ─────────────
# 이게 없으면 Karpenter 가 띄운 인스턴스는 떠도 kubelet 이 API 서버에 등록을
# 못 한다(Registered=Unknown / NodeNotFound). 매니지드 노드그룹은 EKS 가 자동
# 인가하지만 Karpenter 노드 롤은 직접 access entry 를 만들어야 한다.
# EC2_LINUX 타입이 system:bootstrappers/system:nodes 권한을 자동 부여.
resource "aws_eks_access_entry" "karpenter_node" {
  cluster_name  = var.cluster_name
  principal_arn = aws_iam_role.karpenter_node.arn
  type          = "EC2_LINUX"
}

# ── 2) Spot interruption queue (SQS) + EventBridge ────
resource "aws_sqs_queue" "karpenter_interruption" {
  name                      = "${local.name_prefix}-karpenter"
  message_retention_seconds = 300
  sqs_managed_sse_enabled   = true
  tags                      = local.common_tags
}

resource "aws_sqs_queue_policy" "karpenter_interruption" {
  queue_url = aws_sqs_queue.karpenter_interruption.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["events.amazonaws.com", "sqs.amazonaws.com"] }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.karpenter_interruption.arn
    }]
  })
}

locals {
  karpenter_events = {
    spot_interruption = { source = ["aws.ec2"], "detail-type" = ["EC2 Spot Instance Interruption Warning"] }
    rebalance         = { source = ["aws.ec2"], "detail-type" = ["EC2 Instance Rebalance Recommendation"] }
    instance_state    = { source = ["aws.ec2"], "detail-type" = ["EC2 Instance State-change Notification"] }
    scheduled_change  = { source = ["aws.health"], "detail-type" = ["AWS Health Event"] }
  }
}

resource "aws_cloudwatch_event_rule" "karpenter" {
  for_each      = local.karpenter_events
  name          = "${local.name_prefix}-karpenter-${each.key}"
  event_pattern = jsonencode({ source = each.value.source, "detail-type" = each.value["detail-type"] })
  tags          = local.common_tags
}

resource "aws_cloudwatch_event_target" "karpenter" {
  for_each = local.karpenter_events
  rule     = aws_cloudwatch_event_rule.karpenter[each.key].name
  arn      = aws_sqs_queue.karpenter_interruption.arn
}

# ── 3) Karpenter controller IRSA role ─────────────────
resource "aws_iam_role" "karpenter_controller" {
  name               = "${local.name_prefix}-karpenter-controller"
  assume_role_policy = data.aws_iam_policy_document.karpenter_trust.json
  tags               = local.common_tags
}

# 공식 Karpenter controller 정책 기반(필수 액션). 조건은 운영에서 더 좁힐 수 있음.
# 참조: https://karpenter.sh/docs/reference/cloudformation/
data "aws_iam_policy_document" "karpenter_controller" {
  statement {
    sid    = "EC2"
    effect = "Allow"
    actions = [
      "ec2:CreateFleet", "ec2:CreateLaunchTemplate", "ec2:CreateTags",
      "ec2:DeleteLaunchTemplate", "ec2:RunInstances", "ec2:TerminateInstances",
      "ec2:DescribeAvailabilityZones", "ec2:DescribeImages", "ec2:DescribeInstances",
      "ec2:DescribeInstanceTypeOfferings", "ec2:DescribeInstanceTypes",
      "ec2:DescribeLaunchTemplates", "ec2:DescribeSecurityGroups",
      "ec2:DescribeSpotPriceHistory", "ec2:DescribeSubnets",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "SSMAMI"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.aws_region}::parameter/aws/service/*"]
  }
  statement {
    sid       = "Pricing"
    effect    = "Allow"
    actions   = ["pricing:GetProducts"]
    resources = ["*"]
  }
  statement {
    sid       = "Interruption"
    effect    = "Allow"
    actions   = ["sqs:DeleteMessage", "sqs:GetQueueUrl", "sqs:ReceiveMessage"]
    resources = [aws_sqs_queue.karpenter_interruption.arn]
  }
  statement {
    sid       = "PassNodeRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.karpenter_node.arn]
  }
  statement {
    sid    = "InstanceProfile"
    effect = "Allow"
    actions = [
      "iam:CreateInstanceProfile", "iam:AddRoleToInstanceProfile",
      "iam:RemoveRoleFromInstanceProfile", "iam:DeleteInstanceProfile",
      "iam:GetInstanceProfile", "iam:TagInstanceProfile",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "EKSCluster"
    effect    = "Allow"
    actions   = ["eks:DescribeCluster"]
    resources = ["arn:aws:eks:${var.aws_region}:${data.aws_caller_identity.current.account_id}:cluster/${var.cluster_name}"]
  }
}

resource "aws_iam_role_policy" "karpenter_controller" {
  name   = "${local.name_prefix}-karpenter-controller"
  role   = aws_iam_role.karpenter_controller.id
  policy = data.aws_iam_policy_document.karpenter_controller.json
}

# ── 4) Karpenter helm (CRD 차트 분리 설치) ─────────────
resource "helm_release" "karpenter_crd" {
  name       = "karpenter-crd"
  repository = "oci://public.ecr.aws/karpenter"
  chart      = "karpenter-crd"
  version    = var.karpenter_chart_version
  namespace  = "kube-system"
}

resource "helm_release" "karpenter" {
  name       = "karpenter"
  repository = "oci://public.ecr.aws/karpenter"
  chart      = "karpenter"
  version    = var.karpenter_chart_version
  namespace  = "kube-system"

  set {
    name  = "settings.clusterName"
    value = var.cluster_name
  }
  set {
    name  = "settings.interruptionQueue"
    value = aws_sqs_queue.karpenter_interruption.name
  }
  set {
    name  = "serviceAccount.create"
    value = "true"
  }
  set {
    name  = "serviceAccount.name"
    value = "karpenter"
  }
  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = aws_iam_role.karpenter_controller.arn
  }
  # Karpenter 자신은 2-cluster 의 system NG(arm64) 위에 떠야 한다.
  set {
    name  = "controller.resources.requests.cpu"
    value = "0.5"
  }
  set {
    name  = "controller.resources.requests.memory"
    value = "512Mi"
  }

  # ALB 컨트롤러의 mutating webhook(mservice.elbv2.k8s.aws)이 모든 Service 생성을
  # 가로채므로, ALB 컨트롤러가 Ready된 뒤 Karpenter를 설치해 webhook race를 방지.
  depends_on = [helm_release.karpenter_crd, aws_iam_role_policy.karpenter_controller, helm_release.alb_controller]
}

# ── 5) EC2NodeClass + NodePool (v1 API) ────────────────
# 디스커버리: caller(subnet-tags.tf)가 subnet/SG 에 karpenter.sh/discovery=<cluster> 태그를 단다.
resource "kubectl_manifest" "ec2nodeclass" {
  yaml_body = <<-YAML
    apiVersion: karpenter.k8s.aws/v1
    kind: EC2NodeClass
    metadata:
      name: default
    spec:
      role: ${aws_iam_role.karpenter_node.name}
      amiFamily: AL2023
      amiSelectorTerms:
        - alias: al2023@latest
      subnetSelectorTerms:
        - tags:
            karpenter.sh/discovery: ${local.discovery_tag}
      securityGroupSelectorTerms:
        - tags:
            karpenter.sh/discovery: ${local.discovery_tag}
      metadataOptions:
        httpEndpoint: enabled
        httpTokens: required        # IMDSv2 강제 (보안 체크리스트)
        httpPutResponseHopLimit: 1
      blockDeviceMappings:
        - deviceName: /dev/xvda
          ebs:
            volumeSize: ${var.node_volume_size_gib}Gi
            volumeType: gp3
            encrypted: true
            deleteOnTermination: true
      tags:
        karpenter.sh/discovery: ${local.discovery_tag}
        Project: ${var.project}
        Environment: ${var.env}
  YAML

  depends_on = [helm_release.karpenter]
}

resource "kubectl_manifest" "nodepool" {
  yaml_body = <<-YAML
    apiVersion: karpenter.sh/v1
    kind: NodePool
    metadata:
      name: default
    spec:
      template:
        spec:
          nodeClassRef:
            group: karpenter.k8s.aws
            kind: EC2NodeClass
            name: default
          requirements:
            - key: kubernetes.io/arch
              operator: In
              values: ${jsonencode(var.karpenter_arch)}
            - key: kubernetes.io/os
              operator: In
              values: ["linux"]
            - key: karpenter.sh/capacity-type
              operator: In
              values: ${jsonencode(var.karpenter_capacity_types)}
            - key: karpenter.k8s.aws/instance-family
              operator: In
              values: ${jsonencode(var.karpenter_instance_families)}
            # 인스턴스 size 상한(비용 안전장치). dev=2xlarge까지, prod=넓게.
            - key: karpenter.k8s.aws/instance-size
              operator: In
              values: ${jsonencode(var.karpenter_instance_sizes)}
          # guide 서비스의 graceful 110s 보장 — 노드 종료 전 충분한 드레인 여유
          terminationGracePeriod: 5m0s
          expireAfter: 720h
      disruption:
        consolidationPolicy: WhenEmptyOrUnderutilized
        consolidateAfter: 1m
      limits:
        cpu: "${var.karpenter_cpu_limit}"
  YAML

  depends_on = [kubectl_manifest.ec2nodeclass]
}
