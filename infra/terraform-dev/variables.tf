############################################################
# General
############################################################
variable "project" {
  default = "drawe"
}

variable "env" {
  default = "dev"
}

variable "aws_region" {
  default = "ap-northeast-2"
}

############################################################
# VPC / Network
############################################################
variable "vpc_cidr" {
  default = "10.0.0.0/16"
}

variable "az_a" {
  default = "ap-northeast-2a"
}

variable "az_c" {
  default = "ap-northeast-2c"
}

############################################################
# ECS (EC2 기반, Graviton ARM64)
############################################################
# t4g.medium(4GB)에서 backend(1.5GB) + fastapi(1.5GB) + sidecar 2개(1GB) +
# alloy daemon(256MB) + OS(~500MB) 합치면 4GB 초과 → task 배치 실패.
# t4g.large(8GB)로 상향. dev 비용 영향 +$15/월 수준.
variable "ecs_instance_type" {
  description = "ECS 클러스터 EC2 인스턴스 타입 (Graviton ARM64)"
  default     = "t4g.large"
}

variable "ecs_desired_instances" {
  description = "ASG desired capacity (dev=1, stop 시 0)"
  default     = 1
}

# ── Backend 앱 컨테이너 자원 (sidecar 제외) ──
variable "backend_cpu" {
  default = 768
}

variable "backend_memory" {
  default = 1536
}

variable "backend_desired_count" {
  default = 1
}

variable "backend_min_capacity" {
  default = 1
}

variable "backend_max_capacity" {
  default = 2
}

# ── FastAPI 앱 컨테이너 자원 ──
variable "fastapi_cpu" {
  default = 768
}

variable "fastapi_memory" {
  default = 1536
}

variable "fastapi_desired_count" {
  default = 1
}

variable "fastapi_min_capacity" {
  default = 1
}

variable "fastapi_max_capacity" {
  default = 2
}

# ── Alloy sidecar 자원 (모든 app task 공통) ──
variable "alloy_sidecar_cpu" {
  default = 256
}

variable "alloy_sidecar_memory" {
  default = 512
}

# Observability
variable "otel_sampling_rate" {
  description = "Trace sampling rate (Alloy probabilistic): 0~100"
  default     = "10"
}

# RDS
variable "db_instance_class" {
  default = "db.t4g.micro"
}

variable "db_name" {
  default = "drawe_db"
}

variable "db_username" {
  default = "drawe_admin"
}

variable "db_backup_retention_days" {
  description = "RDS backup retention (dev=1, prod≥30)"
  default     = 1
}

# DB / Valkey 비밀번호 — 비워두면 random_password 자동 생성
variable "db_password" {
  description = "RDS master password. 비워두면 32자 random 자동 생성. 본인 지정 시 환경변수 TF_VAR_db_password 권장."
  type        = string
  default     = ""
  sensitive   = true
}

variable "valkey_password" {
  description = "Valkey AUTH 토큰. 비워두면 32자 random 자동 생성."
  type        = string
  default     = ""
  sensitive   = true
}

# NAT Instance
variable "nat_instance_type" {
  default = "t4g.micro"
}

# Valkey EC2 (dev — prod 는 ElastiCache)
variable "valkey_instance_type" {
  default = "t4g.small" # t4g.small Free Trial 사용
}

variable "key_pair_name" {
  description = "EC2 SSH key pair name (must exist in AWS)"
  type        = string
}

# Domain / TLS  (Cloudflare DNS 기반 ACM 검증)
variable "frontend_url" {
  description = "Cloudflare Pages frontend URL (예: https://dev.drawe.xyz)"
  type        = string
  default     = "https://dev.drawe.pages.dev"
}

variable "domain_name" {
  description = <<-EOT
    ALB 에 붙일 도메인 (예: api-dev.drawe.xyz).

    빈 문자열이면 HTTPS listener 생성 X (HTTP only — OAuth 동작 안 함).
    설정하면 ACM 인증서 자동 발급 + ALB HTTPS listener 활성화.

    Cloudflare DNS 를 사용하므로 cloudflare_zone_id 도 같이 설정해야 함.
  EOT
  type        = string
  default     = ""
}

variable "cloudflare_zone_id" {
  description = <<-EOT
    Cloudflare zone ID. domain_name 설정 시 필수.
    대시보드 Overview 페이지 우측 사이드바에서 복사.

    빈 문자열이면 ACM 검증 CNAME 자동 등록 안 됨 (수동 등록 필요).
  EOT
  type        = string
  default     = ""
}

variable "cloudflare_api_token" {
  description = <<-EOT
    Cloudflare API token (Zone > DNS > Edit 권한).
    빈 문자열이면 환경변수 CLOUDFLARE_API_TOKEN 사용 (권장).

    Token 생성:
      Cloudflare → My Profile → API Tokens → Create Token
      → "Edit zone DNS" 템플릿 → 해당 zone 만 선택
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

variable "cloudflare_proxied" {
  description = <<-EOT
    Cloudflare proxy (orange cloud) 켤지 여부.

    true:  Cloudflare 가 TLS 종단 + WAF / DDoS / cache 적용. prod 패턴.
    false: DNS only (gray cloud). dev 에서 디버깅 편함 (CF cache / WAF 영향 없음).

    dev 권장: false. CORS / 캐시 이슈 디버깅이 단순해짐.
  EOT
  type        = bool
  default     = false
}

# Cost Schedule
variable "enable_cost_schedule" {
  description = "EventBridge stop/start 스케줄 (dev=true, prod=false)"
  default     = true
  type        = bool
}

# Tags
locals {
  common_tags = {
    Project     = var.project
    Environment = var.env
    ManagedBy   = "terraform"
  }
  name_prefix = "${var.project}-${var.env}"

  # ── ACM / Cloudflare 자동 검증 활성 조건 ──
  # use_https 는 alb.tf 에서 이미 정의되어 있으니 여기서 다시 정의하지 않음.
  # ACM 검증 CNAME 을 cloudflare_record 로 자동 등록할지 여부.
  use_cloudflare_dns = var.domain_name != "" && var.cloudflare_zone_id != ""
}
