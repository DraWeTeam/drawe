############################################################
# fastapi-guide IRSA — SA(drawe-${var.env}/fastapi-guide) → artref S3 RW
#
# guide 는 reference 이미지를 artref S3 버킷에서 읽고/쓴다. ECS 는 task role 로
# 처리했지만 EKS 는 IRSA(SA↔IAM Role)가 필요. artref S3 정책은 ECS 스택 소유
# (ECS/EKS 공용) → bridge output(artref_s3_policy_arn)으로 받아 attach 한다.
############################################################
locals {
  guide_oidc_url = replace(
    data.terraform_remote_state.eks_cluster_dev.outputs.oidc_provider_url, "https://", "")
}

data "aws_iam_policy_document" "guide_irsa_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.terraform_remote_state.eks_cluster_dev.outputs.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.guide_oidc_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.guide_oidc_url}:sub"
      values   = ["system:serviceaccount:${var.project}-${var.env}:fastapi-guide"]
    }
  }
}

resource "aws_iam_role" "fastapi_guide" {
  name               = "${var.project}-${var.env}-fastapi-guide"
  assume_role_policy = data.aws_iam_policy_document.guide_irsa_trust.json
}

resource "aws_iam_role_policy_attachment" "fastapi_guide_s3" {
  role       = aws_iam_role.fastapi_guide.name
  policy_arn = data.terraform_remote_state.ecs_dev.outputs.artref_s3_policy_arn
}

output "fastapi_guide_irsa_role_arn" {
  description = "fastapi-guide SA annotation(eks.amazonaws.com/role-arn) 에 넣을 IRSA 롤 ARN"
  value       = aws_iam_role.fastapi_guide.arn
}
