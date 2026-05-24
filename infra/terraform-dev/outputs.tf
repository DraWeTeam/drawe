# Outputs
output "alb_dns_name" {
  description = "ALB DNS name (Cloudflare CNAME 대상)"
  value       = aws_lb.main.dns_name
}

output "rds_endpoint" {
  description = "RDS MySQL endpoint"
  value       = aws_db_instance.main.address
  sensitive   = true
}

output "valkey_private_ip" {
  description = "Valkey EC2 private IP"
  value       = aws_instance.valkey.private_ip
  sensitive   = true
}

output "ecr_backend_url" {
  description = "ECR repo URL — Backend"
  value       = aws_ecr_repository.backend.repository_url
}

output "ecr_fastapi_url" {
  description = "ECR repo URL — FastAPI"
  value       = aws_ecr_repository.fastapi.repository_url
}

output "github_deploy_role_arn" {
  description = "GitHub Actions OIDC role ARN — 각 앱 레포의 AWS_DEPLOY_ROLE_ARN secret 으로 등록. var.github_owner 미설정 시 null."
  value       = var.github_owner != "" ? aws_iam_role.github_deploy[0].arn : null
}

output "fastapi_internal_url" {
  description = "Backend → FastAPI 내부 호출 URL"
  value       = "http://fastapi.${local.name_prefix}.local:8000"
}

############################################################
# ACM cert validation records — fallback 용
#
# var.cloudflare_zone_id 가 비어있으면 cloudflare_record 가 자동 등록 안 되므로
# 이 output 의 CNAME 을 사람이 직접 Cloudflare DNS 에 입력해야 함.
#
# var.cloudflare_zone_id 가 채워져 있으면 cloudflare.tf 가 자동 등록 → 이 output 은 null.
############################################################
output "acm_validation_records" {
  description = "var.domain_name 설정 + var.cloudflare_zone_id 미설정 시, Cloudflare DNS 에 수동 등록할 CNAME 검증 레코드. 둘 다 설정하면 null (자동 등록됨)."
  value = local.use_https && !local.use_cloudflare_dns ? {
    for dvo in aws_acm_certificate.main[0].domain_validation_options :
    dvo.domain_name => {
      name    = dvo.resource_record_name
      value   = dvo.resource_record_value
      type    = dvo.resource_record_type
      proxied = false  # ⚠ ACM 검증 CNAME 은 항상 proxied=false (gray cloud)
    }
  } : null
}

output "alb_https_enabled" {
  description = "HTTPS listener 활성화 여부"
  value       = local.use_https
}

# 운영 편의 output — 도메인 사용 시 최종 접근 URL 표시
output "api_endpoint" {
  description = "백엔드 API 접근 URL (HTTPS 활성 시 Cloudflare 도메인, 아니면 ALB DNS HTTP)"
  value = local.use_https ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
}
