############################################################
# observability IRSA — SA(observability/*) → AWS 권한 (prod)
#
# ECS 단일 observability_task 롤(iam.tf)을 EKS 에선 SA 별 IRSA 4개로 분리:
#   alloy   → aps:RemoteWrite          (메트릭 push)
#   loki    → Loki S3 버킷 RW           (로그 chunk)
#   tempo   → Tempo S3 버킷 RW          (trace block)
#   grafana → AMP Query + X-Ray Read    (대시보드 조회)
#
# 위치 근거: 앱 IRSA(backend-irsa.tf, guide-irsa.tf)와 동일 계층.
#   self-host observability 자원(AMP/S3)은 prod 에만 존재 → dev+prod 공유
#   modules/eks-platform 이 아니라 prod 전용 3-platform 에 둔다.
#
# 참조 자원: terraform-prod 의 브리지 output
#   (outputs-eks-observability-bridge.tf: loki_bucket_arn / tempo_bucket_arn /
#    amp_workspace_arn). remote_state "ecs_prod" 는 remote-state.tf 에 이미 정의됨.
############################################################

locals {
  obs_oidc_url = replace(
    data.terraform_remote_state.eks_cluster_prod.outputs.oidc_provider_url, "https://", "")

  obs_sas = toset(["alloy", "loki", "tempo", "grafana"])

  loki_bucket_arn   = data.terraform_remote_state.ecs_prod.outputs.loki_bucket_arn
  tempo_bucket_arn  = data.terraform_remote_state.ecs_prod.outputs.tempo_bucket_arn
  amp_workspace_arn = data.terraform_remote_state.ecs_prod.outputs.amp_workspace_arn
}

# ── 공통 trust policy (SA 별 sub 조건) ──────────────────
data "aws_iam_policy_document" "obs_trust" {
  for_each = local.obs_sas

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.terraform_remote_state.eks_cluster_prod.outputs.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.obs_oidc_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.obs_oidc_url}:sub"
      # ★ namespace 는 observability (drawe-prod 아님)
      values = ["system:serviceaccount:observability:${each.value}"]
    }
  }
}

resource "aws_iam_role" "obs" {
  for_each           = local.obs_sas
  name               = "${var.project}-${var.env}-obs-${each.value}"
  assume_role_policy = data.aws_iam_policy_document.obs_trust[each.value].json

  tags = {
    Project   = var.project
    Env       = var.env
    Component = "observability"
    SA        = each.value
  }
}

# ── alloy → AMP RemoteWrite ─────────────────────────────
resource "aws_iam_role_policy" "alloy_amp_write" {
  name = "${var.project}-${var.env}-obs-alloy-amp-write"
  role = aws_iam_role.obs["alloy"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["aps:RemoteWrite"]
      Resource = local.amp_workspace_arn
    }]
  })
}

# ── loki → Loki S3 버킷 RW ──────────────────────────────
resource "aws_iam_role_policy" "loki_s3" {
  name = "${var.project}-${var.env}-obs-loki-s3"
  role = aws_iam_role.obs["loki"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [local.loki_bucket_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${local.loki_bucket_arn}/*"]
      },
    ]
  })
}

# ── tempo → Tempo S3 버킷 RW ────────────────────────────
resource "aws_iam_role_policy" "tempo_s3" {
  name = "${var.project}-${var.env}-obs-tempo-s3"
  role = aws_iam_role.obs["tempo"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [local.tempo_bucket_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${local.tempo_bucket_arn}/*"]
      },
    ]
  })
}

# ── grafana → AMP Query + X-Ray Read ────────────────────
resource "aws_iam_role_policy" "grafana_amp_query" {
  name = "${var.project}-${var.env}-obs-grafana-amp-query"
  role = aws_iam_role.obs["grafana"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "aps:QueryMetrics",
        "aps:GetSeries",
        "aps:GetLabels",
        "aps:GetMetricMetadata",
      ]
      Resource = local.amp_workspace_arn
    }]
  })
}

resource "aws_iam_role_policy" "grafana_xray_read" {
  name = "${var.project}-${var.env}-obs-grafana-xray-read"
  role = aws_iam_role.obs["grafana"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "xray:GetServiceGraph",
        "xray:GetTraceSummaries",
        "xray:GetTraceGraph",
        "xray:BatchGetTraces",
        "xray:GetGroups",
        "xray:GetTimeSeriesServiceStatistics",
      ]
      Resource = "*"
    }]
  })
}

# ── outputs: SA annotation(eks.amazonaws.com/role-arn) 에 넣을 ARN ──
output "obs_alloy_role_arn" {
  description = "alloy SA annotation 용 IRSA 롤 ARN"
  value       = aws_iam_role.obs["alloy"].arn
}

output "obs_loki_role_arn" {
  description = "loki SA annotation 용 IRSA 롤 ARN"
  value       = aws_iam_role.obs["loki"].arn
}

output "obs_tempo_role_arn" {
  description = "tempo SA annotation 용 IRSA 롤 ARN"
  value       = aws_iam_role.obs["tempo"].arn
}

output "obs_grafana_role_arn" {
  description = "grafana SA annotation 용 IRSA 롤 ARN"
  value       = aws_iam_role.obs["grafana"].arn
}
