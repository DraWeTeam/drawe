############################################################
# SSM + env - Qdrant Cloud (fastapi/artref 벡터 백엔드)
#
# === 1-계정 공유 구성(무료 클러스터 1개) ===
# Qdrant Cloud 무료 클러스터 1개를 콘솔에서 생성하고, dev/prod 가 그 클러스터를
# "별도 컬렉션"으로 나눠 씁니다 (reference_images_dev / reference_images_prod).
#  - dev/prod 양쪽 SSM 의 qdrant-url, qdrant-api-key 에는 "같은 클러스터" 값을
#    동일하게 넣습니다 (컬렉션 이름만 env 별로 다름 → 아래 QDRANT_COLLECTION).
#  - dev 가 평일에 규칙적으로 쓰면 공유 클러스터가 살아 있어, prod 컬렉션도
#    "4주 미사용 자동삭제"에서 보호됩니다.
#
# Qdrant Cloud 무료 클러스터는 콘솔에서 생성(URL + API 키 발급).
# 아래 두 파라미터는 placeholder("CHANGE_ME")로 생성되고 ignore_changes 라,
# apply 후 실제 값만 콘솔/CLI 로 넣으면 됩니다(terraform 이 안 덮어씀):
#   aws ssm put-parameter --name /<project>/<env>/qdrant-url \
#       --value "https://xxxx.aws.cloud.qdrant.io:6333" --type String --overwrite
#   aws ssm put-parameter --name /<project>/<env>/qdrant-api-key \
#       --value "<키>" --type SecureString --overwrite
# 실행 롤 SSM 정책이 /<project>/<env>/* 와일드카드라 별도 IAM 변경 불필요.
#
# 코드 선결(백엔드): config.py 에 qdrant_api_key 필드 추가, stores/vectors.py 의
#   _qc() 가 QdrantClient(url=..., api_key=settings.qdrant_api_key or None) 로
#   키를 넘겨야 Cloud 인증됨(로컬 도커 Qdrant 는 키 없이 동작 → or None 으로 호환).
############################################################

resource "aws_ssm_parameter" "qdrant_url" {
  name  = "/${var.project}/${var.env}/qdrant-url"
  type  = "String"
  value = "CHANGE_ME_qdrant_url"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "qdrant_api_key" {
  name  = "/${var.project}/${var.env}/qdrant-api-key"
  type  = "SecureString"
  value = "CHANGE_ME"
  lifecycle { ignore_changes = [value] }
}

locals {
  # fastapi(artref) 컨테이너에 주입. ecs.tf 의 fastapi environment/secrets 에서 concat.
  qdrant_env = [
    # 1-계정 공유: 클러스터는 dev/prod 공통, 컬렉션 이름으로 env 분리.
    # var.env = "dev" → reference_images_dev / "prod" → reference_images_prod.
    { name = "QDRANT_COLLECTION", value = "reference_images_${var.env}" },
    # 전역 단일 백엔드 스위치. "ai_example→Pinecone / 그 외→Qdrant" 분기는
    # stores/vectors.py 의 source_type 라우팅(코드 변경)으로 처리. 그 전까지는 qdrant.
    { name = "VECTOR_BACKEND", value = "qdrant" },
  ]
  qdrant_secrets = [
    { name = "QDRANT_URL", valueFrom = aws_ssm_parameter.qdrant_url.arn },
    { name = "QDRANT_API_KEY", valueFrom = aws_ssm_parameter.qdrant_api_key.arn },
  ]
}
