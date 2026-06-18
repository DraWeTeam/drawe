############################################################
# S3 - artref 레퍼런스 코퍼스 저장소
#
# 용도: 코칭 시스템(artref/FastAPI)의 레퍼런스 이미지 묶음.
#       museum(CC0) · self_render(Blender) · ai_example(Bria 생성)이
#       하나의 코퍼스로 들어간다. 키 규약: images/{ref_id}.png
#       (앱 생성 이미지용 bria 버킷과 출처/수명주기/접근패턴이 달라 분리)
#
# 읽기: 브라우저가 presigned URL(/image/{ref_id}, /guide-asset/{ref_id})로
#       S3 를 직접 read. 쓰기: ingest 파이프라인이 PutObject.
# 비공개(Block Public Access ON) + presigned 조합 → 버킷정책/ACL 불필요.
#
# 큐레이션된 정적 자산이라 lifecycle 만료 없음(영구 보존).
# 컴퓨트(ECS/EKS)와 무관 → EKS 전환 시 그대로 재사용.
############################################################

variable "artref_bucket_name" {
  description = "artref 레퍼런스 코퍼스 버킷명(S3 는 전역 유일). 비우면 <project>-<env>-artref 자동 사용."
  type        = string
  default     = ""
}

locals {
  artref_bucket_name = var.artref_bucket_name != "" ? var.artref_bucket_name : "${local.name_prefix}-artref"
}

resource "aws_s3_bucket" "artref" {
  bucket = local.artref_bucket_name
  tags   = { Name = local.artref_bucket_name }
}

resource "aws_s3_bucket_public_access_block" "artref" {
  bucket = aws_s3_bucket.artref.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artref" {
  bucket = aws_s3_bucket.artref.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "artref" {
  bucket = aws_s3_bucket.artref.id
  versioning_configuration {
    status = "Disabled" # 레퍼런스는 key 단위 immutable - versioning 불필요
  }
}

# (선택) 브라우저가 presigned URL 을 <img src>/리다이렉트가 아니라 fetch()/XHR
# 로 읽을 때만 필요. 단순 렌더링이면 이 리소스 삭제 가능. frontend_url 비면 미생성.
resource "aws_s3_bucket_cors_configuration" "artref" {
  count  = var.frontend_url != "" ? 1 : 0
  bucket = aws_s3_bucket.artref.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = concat([var.frontend_url], var.cors_extra_origins)
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

output "artref_bucket_name" {
  description = "artref 레퍼런스 코퍼스 버킷 확정명 (ingest/서빙 서비스의 버킷 env 와 동일 값)"
  value       = aws_s3_bucket.artref.bucket
}

output "artref_bucket_arn" {
  description = "artref 레퍼런스 코퍼스 버킷 ARN"
  value       = aws_s3_bucket.artref.arn
}
