############################################################
# backend IRSA — SA(drawe-${var.env}/backend) → bria-ai S3 RW
#   ECS task role 에 있던 bria_s3_access 를 EKS 에선 IRSA 로 부여.
#   bria S3 정책은 ECS 스택 소유(공용) → 브리지 output(bria_s3_policy_arn) 으로 attach.
############################################################
locals {
  backend_oidc_url = replace(
    data.terraform_remote_state.eks_cluster_prod.outputs.oidc_provider_url, "https://", "")
}

data "aws_iam_policy_document" "backend_irsa_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.terraform_remote_state.eks_cluster_prod.outputs.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.backend_oidc_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.backend_oidc_url}:sub"
      values   = ["system:serviceaccount:${var.project}-${var.env}:backend"]
    }
  }
}

resource "aws_iam_role" "backend" {
  name               = "${var.project}-${var.env}-backend"
  assume_role_policy = data.aws_iam_policy_document.backend_irsa_trust.json
}

resource "aws_iam_role_policy_attachment" "backend_bria_s3" {
  role       = aws_iam_role.backend.name
  policy_arn = data.terraform_remote_state.ecs_prod.outputs.bria_s3_policy_arn
}

# Cost Explorer — 어드민 비용 탭(AwsCostService → GetCostAndUsage). WP4-b(IAM).
#   Resource 는 반드시 "*" — Cost Explorer 는 리소스 레벨 권한을 지원하지 않는다.
#   현재 코드는 GetCostAndUsage 만 호출(GetCostForecast 미사용) → 액션도 그것만 부여.
data "aws_iam_policy_document" "backend_cost_explorer" {
  statement {
    sid       = "CostExplorerReadOnly"
    effect    = "Allow"
    actions   = ["ce:GetCostAndUsage"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "backend_cost_explorer" {
  name   = "${var.project}-${var.env}-backend-cost-explorer"
  role   = aws_iam_role.backend.id
  policy = data.aws_iam_policy_document.backend_cost_explorer.json
}

output "backend_irsa_role_arn" {
  description = "backend SA annotation(eks.amazonaws.com/role-arn) 에 넣을 IRSA 롤 ARN"
  value       = aws_iam_role.backend.arn
}
