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

# Bedrock — 이미지 생성(ai_fallback) + VLM 관찰(observe_hand/face/pose). 둘 다 InvokeModel,
#   ARN 한정(와일드카드 금지). 같은 prod 계정(933) 내 호출이라 크로스계정 불필요.
data "aws_iam_policy_document" "guide_bedrock" {
  # 이미지 생성 — Stability stable-image-core(us-west-2; 서울엔 이미지 생성 모델 없음).
  statement {
    sid       = "ImageGenStability"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:us-west-2::foundation-model/stability.stable-image-core-v1:1"]
  }
  # VLM 관찰 — Claude Haiku 4.5 크로스리전 추론 프로파일(us.*). InvokeModel 은 프로파일 ARN +
  #   프로파일이 라우팅하는 3개 리전 foundation-model ARN 을 모두 요구한다(get_inference_profile
  #   실측: us-east-1·us-east-2·us-west-2). 모델 교체(BEDROCK_VLM_MODEL) 시 이 ARN 들도 갱신.
  statement {
    sid       = "VlmClaudeHaiku45"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel"]
    resources = [
      "arn:aws:bedrock:us-west-2:933832340498:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
      "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
      "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
      "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
    ]
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
