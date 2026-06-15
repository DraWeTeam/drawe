############################################################
# IAM - Bria 이미지 버킷 접근 정책
#
# 설계 의도 (EKS 전환 대비 - 이게 핵심):
#   권한 "정의"(aws_iam_policy)를 Role 에 인라인으로 박지 않고
#   독립 standalone 정책으로 분리한다.
#     - 지금(ECS): aws_iam_role.ecs_task 에 attach
#     - 추후(EKS): IRSA 또는 Pod Identity 용 Role 을 별도 terraform 에서
#                  만들고, "동일한 이 정책"을 그대로 attach 하면 끝.
#   ECS→EKS 에서 바뀌는 것은 Role 의 신뢰관계(trust policy)뿐이고,
#   권한 정의(이 정책)와 앱 코드(DefaultCredentialsProvider)는 무변경.
#
#   ▸ EKS root module 에서 재사용하는 방법(둘 중 하나):
#       (a) data "aws_iam_policy" { name = "${name_prefix}-bria-s3-access" }
#           로 이 정책을 참조 후 EKS Role 에 attach (state 공유 없이 ARN 재사용)
#       (b) 이 aws_iam_policy 블록을 공용 module 로 추출해 dev/prod/eks 가 호출
#
# 권한: presigned 방식 최소 2개
#   s3:PutObject  - 서버가 이미지 업로드
#   s3:GetObject  - presigned URL 이 위임하는 읽기
############################################################

resource "aws_iam_policy" "bria_s3_access" {
  name        = "${local.name_prefix}-bria-s3-access"
  description = "Bria 이미지 버킷 PutObject/GetObject. ECS/EKS task role 공용 정책."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "BriaImageObjectRW"
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:GetObject"]
      Resource = "${aws_s3_bucket.bria.arn}/*"
    }]
  })
}

# 지금: ECS 앱 task role 에 attach
resource "aws_iam_role_policy_attachment" "ecs_task_bria_s3" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.bria_s3_access.arn
}
