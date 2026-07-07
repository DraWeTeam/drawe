############################################################
# Bedrock 이미지 생성(ai_fallback) — ECS task role 정책.
#   ★EKS 롤백 보험: EKS IRSA(eks/prod/3-platform/guide-irsa.tf)의 fastapi_guide_bedrock 과
#   동일 권한을 ECS 공용 task 롤(aws_iam_role.ecs_task)에도 부여 — 두 경로가 같은 시점에 동작.
#   Stability stable-image-core(us-west-2) InvokeModel 한정. 와일드카드 금지 — 이 모델 ARN 만.
#   서울엔 이미지 생성 모델이 없어 us-west-2 사용(코드 BEDROCK_IMAGE_REGION 과 일치).
############################################################
resource "aws_iam_role_policy" "ecs_task_bedrock" {
  name = "${local.name_prefix}-ecs-task-bedrock"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ImageGenStability"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:us-west-2::foundation-model/stability.stable-image-core-v1:1"
      },
      {
        # VLM 관찰(vision.py) — Claude Haiku 4.5 크로스리전 프로파일. 프로파일 ARN + 라우팅 3리전
        #   foundation-model ARN 모두 필요(get_inference_profile 실측). IRSA(guide-irsa.tf)와 패리티.
        Sid      = "VlmClaudeHaiku45"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = [
          "arn:aws:bedrock:us-west-2:933832340498:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        ]
      }
    ]
  })
}
