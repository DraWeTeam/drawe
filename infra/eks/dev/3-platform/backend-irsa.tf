############################################################
# backend IRSA — SA(drawe-${var.env}/backend) → bria-ai S3 RW
#   backend 는 /images/{id} 서빙·업로드·이미지생성 저장에 bria-ai 버킷을 RW.
#   ECS task role 에 있던 bria_s3_access 를 EKS 에선 IRSA 로 부여.
############################################################
locals {
  backend_oidc_url = replace(
    data.terraform_remote_state.eks_cluster_dev.outputs.oidc_provider_url, "https://", "")
}

data "aws_iam_policy_document" "backend_irsa_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.terraform_remote_state.eks_cluster_dev.outputs.oidc_provider_arn]
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
  policy_arn = data.terraform_remote_state.ecs_dev.outputs.bria_s3_policy_arn
}

# Cost Explorer — 어드민 비용 탭. dev 는 현재 꺼져 있고 비용 탭을 dev 에서 검증하지 않아
#   이번엔 prod 만 부여했다(eks/prod/3-platform/backend-irsa.tf). dev 에서 비용 탭을
#   검증하려면 prod 와 동일하게 ce:GetCostAndUsage(Resource "*") 정책을 여기 추가하면 된다.

output "backend_irsa_role_arn" {
  description = "backend SA annotation(eks.amazonaws.com/role-arn) 에 넣을 IRSA 롤 ARN"
  value       = aws_iam_role.backend.arn
}
