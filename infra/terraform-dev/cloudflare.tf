############################################################
# Cloudflare DNS records — dev
#
# 동작 조건:
#   var.domain_name != ""  AND  var.cloudflare_zone_id != ""
# (위 두 조건이 모두 충족 → local.use_cloudflare_dns == true)
#
# 등록되는 record:
#   1) ACM 검증용 CNAME (proxied=false 강제)
#   2) api-dev.drawe.xyz (또는 var.domain_name) → ALB DNS CNAME
#      proxied 는 var.cloudflare_proxied 로 제어 (dev default: false)
#
# prod 와 다른 점:
#   - prod 는 항상 proxied=true (orange cloud + Full Strict)
#   - dev 는 default proxied=false (gray cloud) — CORS / cache 디버깅 용이
#   - dev 는 grafana 서브도메인 없음 (Grafana Cloud SaaS 사용)
############################################################

############################################################
# ACM 검증용 CNAME
#
# AWS 가 발급한 _xxx.acm-validations.aws 로 향하는 CNAME.
# proxied=false 필수 — proxy 켜면 ACM 검증 query 가 깨짐.
############################################################
resource "cloudflare_record" "cert_validation" {
  for_each = local.use_cloudflare_dns ? {
    for dvo in aws_acm_certificate.main[0].domain_validation_options :
    dvo.domain_name => {
      name    = dvo.resource_record_name
      content = dvo.resource_record_value
      type    = dvo.resource_record_type
    }
  } : {}

  zone_id = var.cloudflare_zone_id
  name    = each.value.name
  content = each.value.content
  type    = each.value.type
  ttl     = 60
  proxied = false
  comment = "ACM cert DNS validation (DraWe dev)"
}

# DNS record — api-dev.drawe.xyz → ALB
resource "cloudflare_record" "api" {
  count = local.use_cloudflare_dns ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = var.domain_name           # FQDN — CF 가 알아서 zone 매칭
  type    = "CNAME"
  content = local.api_target_alb_dns # 우선순위: override > EKS 컷오버(태그탐색) > ECS ALB — cutover-eks.tf
  ttl     = var.cloudflare_proxied ? 1 : 300   # proxied=true 면 ttl 무시 (1=auto)
  proxied = var.cloudflare_proxied
  comment = "Managed by Terraform — DraWe dev API"
}

############################################################
# EKS 컷오버 스위치 — api-dev DNS 가 가리킬 ALB 오버라이드
#   "" (기본) → ECS ALB(aws_lb.main.dns_name)
#   "<eks-alb-dns>" → EKS ALB 로 컷오버. 롤백 = 다시 "" 로 apply.
#   dev 는 proxied=false·ttl=300 → 전파 ~5분.
############################################################
variable "api_alb_dns_override" {
  description = "api-dev 가 가리킬 ALB DNS 강제 지정(EKS 전환용). 빈 값이면 ECS ALB."
  type        = string
  default     = ""
}
