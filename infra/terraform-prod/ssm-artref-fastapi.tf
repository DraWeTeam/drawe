############################################################
# fastapi(artref) 서비스용 추가 env/secrets — 플래그 게이트
#
# 현재 fastapi 컨테이너는 CLIP 임베딩만 하는 미니멀 서비스라, artref 본체
# env(S3 artref·Pinecone·DB·임베딩)를 지금 바로 주입하면 안 맞을 수 있음.
# 그래서 artref_fastapi_enabled 플래그로 게이트한다:
#   false(기본): fastapi = 임베더 + Qdrant 배선만 → 지금 apply 안전
#   true       : artref 본체 합류 후 아래 env/secrets 까지 주입
#
# 켜기 전 준비:
#   - RDS 에 artref 스키마 + 계정/grant (또는 기존 drawe DB 재사용 결정)
#   - artref-db-dsn SSM 값 채우기(아래 put-parameter)
#   - pinecone-* SSM 값(백엔드 제공) 채우기
#   - artref_embedding_model 을 artref 코드가 읽는 형식과 정확히 일치
#   - stores/s3.py: 키 없을 때 IAM 롤 폴백 + ensure_bucket() prod 스킵(코드 변경)
############################################################

variable "artref_fastapi_enabled" {
  description = "true 면 fastapi 컨테이너에 artref 본체 env(S3 artref·Pinecone·DB_DSN·임베딩) 주입. artref 서비스 배포 준비되면 켜기."
  type        = bool
  default     = false
}

variable "artref_embedding_model" {
  description = "artref EMBEDDING_MODEL. artref config 가 읽는 형식과 정확히 일치시킬 것(768 모델). 코드가 open_clip:NAME:WEIGHTS 형식이면 그 형식으로."
  type        = string
  default     = "openai/clip-vit-large-patch14"
}

# DB_DSN 전체 문자열(스키마·계정 포함)을 SecureString 으로 둠. 값은 콘솔/CLI 로:
#   aws ssm put-parameter --name /<project>/<env>/artref-db-dsn \
#     --value "mysql+pymysql://<user>:<pw>@<rds-endpoint>:3306/artref" \
#     --type SecureString --overwrite
resource "aws_ssm_parameter" "artref_db_dsn" {
  name  = "/${var.project}/${var.env}/artref-db-dsn"
  type  = "SecureString"
  value = "CHANGE_ME_artref_db_dsn"
  lifecycle { ignore_changes = [value] }
}

locals {
  # 플래그 on 일 때만 fastapi 에 추가되는 env. ecs.tf 의 fastapi environment 에서 concat.
  artref_env = var.artref_fastapi_enabled ? [
    { name = "S3_BUCKET", value = aws_s3_bucket.artref.bucket },
    # AWS S3 리전 엔드포인트. presigned 가 AWS 를 가리키게. (s3.py 가 endpoint_url 요구)
    { name = "S3_ENDPOINT", value = "https://s3.${var.aws_region}.amazonaws.com" },
    { name = "S3_PUBLIC_ENDPOINT", value = "https://s3.${var.aws_region}.amazonaws.com" },
    { name = "EMBEDDING_MODEL", value = var.artref_embedding_model },
  ] : []

  # 플래그 on 일 때만 fastapi 에 추가되는 secrets. ecs.tf 의 fastapi secrets 에서 concat.
  artref_secrets = var.artref_fastapi_enabled ? [
    { name = "DB_DSN", valueFrom = aws_ssm_parameter.artref_db_dsn.arn },
    { name = "PINECONE_API_KEY", valueFrom = aws_ssm_parameter.pinecone_api_key.arn },
    { name = "PINECONE_HOST", valueFrom = aws_ssm_parameter.pinecone_host.arn },
    { name = "PINECONE_INDEX", valueFrom = aws_ssm_parameter.pinecone_index.arn },
  ] : []
}
