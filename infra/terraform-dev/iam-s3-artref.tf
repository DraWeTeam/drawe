############################################################
# IAM - artref 레퍼런스 코퍼스 버킷 접근 정책
#
# bria 정책과 동일한 분리형 패턴(EKS 재사용 대비):
#   권한 정의를 standalone aws_iam_policy 로 두고 Role 에 attach.
#     - 지금(ECS): aws_iam_role.ecs_task (backend/fastapi 공용) 에 attach
#     - 추후(EKS): IRSA/Pod Identity Role 에 동일 정책 ARN attach
#   바뀌는 건 Role 의 신뢰관계뿐, 권한 정의는 재사용.
#
# 권한: presigned 방식 최소 2개
#   s3:PutObject - ingest 가 images/{ref_id}.png 업로드
#   s3:GetObject - presigned 서빙(/image, /guide-asset)이 위임하는 읽기
############################################################

resource "aws_iam_policy" "artref_s3_access" {
  name        = "${local.name_prefix}-artref-s3-access"
  description = "artref 레퍼런스 코퍼스 버킷 PutObject/GetObject. ECS/EKS task role 공용 정책."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ArtrefObjectRW"
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:GetObject"]
      Resource = "${aws_s3_bucket.artref.arn}/*"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_artref_s3" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.artref_s3_access.arn
}
