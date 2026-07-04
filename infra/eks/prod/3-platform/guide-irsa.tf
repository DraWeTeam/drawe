############################################################
# fastapi-guide IRSA — SA(drawe-${var.env}/fastapi-guide) → artref S3 RW
#   artref S3 정책은 ECS 스택 소유(공용) → 브리지 output(artref_s3_policy_arn) 으로 attach.
############################################################
locals {
  guide_oidc_url = replace(
    data.terraform_remote_state.eks_cluster_prod.outputs.oidc_provider_url, "https://", "")
}

data "aws_iam_policy_document" "guide_irsa_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.terraform_remote_state.eks_cluster_prod.outputs.oidc_provider_arn]
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
  policy_arn = data.terraform_remote_state.ecs_prod.outputs.artref_s3_policy_arn
}

# Bedrock 이미지 생성(ai_fallback) — Stability stable-image-core(us-west-2) InvokeModel 만.
#   서울엔 이미지 생성 모델이 없어 us-west-2 사용. 이 모델 ARN 한정(와일드카드 금지).
#   같은 prod 계정(933) 내 호출이라 크로스계정 불필요 — SA(IRSA) 기본 자격체인 그대로.
data "aws_iam_policy_document" "guide_bedrock" {
  statement {
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:us-west-2::foundation-model/stability.stable-image-core-v1:1"]
  }
}

resource "aws_iam_role_policy" "fastapi_guide_bedrock" {
  name   = "${var.project}-${var.env}-fastapi-guide-bedrock"
  role   = aws_iam_role.fastapi_guide.id
  policy = data.aws_iam_policy_document.guide_bedrock.json
}

output "fastapi_guide_irsa_role_arn" {
  description = "fastapi-guide SA annotation(eks.amazonaws.com/role-arn) 에 넣을 IRSA 롤 ARN"
  value       = aws_iam_role.fastapi_guide.arn
}
