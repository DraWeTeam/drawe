############################################################
# S3 - Bria AI 생성 이미지 저장소
#
# 용도: Bria AI 로 생성한 이미지를 MySQL(image_blobs BLOB) 대신 S3 에 저장.
#       업로드는 백엔드(서버)가 PutObject, 읽기는 브라우저가 presigned
#       URL(GetObject 위임)로 S3 를 직접 read 한다.
#
# 비공개 버킷(Block Public Access ON) + presigned URL 조합:
#   presigned URL 은 서명 주체(ECS task role)의 GetObject 권한으로 동작하므로
#   퍼블릭 공개 / 버킷 정책 / ACL 이 전혀 필요 없다.
#
# 이 리소스는 컴퓨트(ECS/EKS)와 무관 → 추후 EKS 전환 시 그대로 재사용.
############################################################

variable "bria_bucket_name" {
  description = "Bria 이미지 버킷명(S3 는 전역 유일). 비우면 <project>-<env>-bria-ai 자동 사용."
  type        = string
  default     = ""
}

variable "s3_storage_enabled" {
  description = <<-EOT
    true  : 백엔드 task 에 SPRING_PROFILES_ACTIVE=s3 주입 → S3 저장 활성화.
    false : 버킷/IAM/버킷 env 는 준비하되 앱은 기존 MySQL(BLOB) 유지(안전).
    버킷·IAM apply 로 먼저 인프라를 깔고, e2e 검증 후 true 로 cutover 권장.
  EOT
  type        = bool
  default     = false
}

locals {
  bria_bucket_name = var.bria_bucket_name != "" ? var.bria_bucket_name : "${local.name_prefix}-bria-ai"

  # 백엔드 컨테이너에 추가 주입할 env. ecs.tf 의 backend environment 에서 concat 한다.
  #   S3_BUCKET / S3_REGION 은 항상 주입(s3 프로파일 꺼져 있으면 앱이 무시 → 무해).
  #   SPRING_PROFILES_ACTIVE=s3 는 s3_storage_enabled=true 일 때만 → 안전한 단계적 전환.
  s3_env = concat(
    [
      { name = "S3_BUCKET", value = aws_s3_bucket.bria.bucket },
      { name = "S3_REGION", value = var.aws_region },
    ],
    var.s3_storage_enabled ? [
      { name = "SPRING_PROFILES_ACTIVE", value = "s3" },
    ] : []
  )
}

resource "aws_s3_bucket" "bria" {
  bucket = local.bria_bucket_name

  tags = { Name = local.bria_bucket_name }
}

resource "aws_s3_bucket_public_access_block" "bria" {
  bucket = aws_s3_bucket.bria.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "bria" {
  bucket = aws_s3_bucket.bria.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "bria" {
  bucket = aws_s3_bucket.bria.id
  versioning_configuration {
    status = "Disabled" # 이미지는 key 단위 immutable - versioning 불필요
  }
}

# (선택) 브라우저가 presigned URL 을 <img src> 가 아니라 fetch()/XHR 로
# 읽을 때만 필요. 단순 <img> 렌더링이면 CORS 불필요 → 이 리소스 삭제 가능.
# frontend_url 이 비어 있으면 생성하지 않음(count guard).
resource "aws_s3_bucket_cors_configuration" "bria" {
  count  = var.frontend_url != "" ? 1 : 0
  bucket = aws_s3_bucket.bria.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = [var.frontend_url]
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

output "bria_bucket_name" {
  description = "Bria 이미지 버킷 확정명 (백엔드 S3_BUCKET 과 동일 값)"
  value       = aws_s3_bucket.bria.bucket
}

output "bria_bucket_arn" {
  description = "Bria 이미지 버킷 ARN"
  value       = aws_s3_bucket.bria.arn
}
