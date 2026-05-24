############################################################
# ACM Certificate
#
# domain_name 과 grafana.{domain_name} 둘 다 SAN.
# 검증은 Cloudflare DNS (cloudflare.tf 의 cloudflare_record.cert_validation 가
# 등록한 CNAME 으로 자동 처리).
############################################################
resource "aws_acm_certificate" "main" {
  domain_name = var.domain_name
  subject_alternative_names = [
    "grafana.${var.domain_name}",
  ]
  validation_method = "DNS"

  lifecycle { create_before_destroy = true }

  tags = { Name = "${local.name_prefix}-cert" }
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn = aws_acm_certificate.main.arn

  # Cloudflare DNS 에 등록된 검증 CNAME 들의 hostname.
  # 이 의존성 덕분에 ACM 이 검증 시도 전에 CNAME 이 propagate 됨.
  validation_record_fqdns = [
    for r in cloudflare_record.cert_validation : r.hostname
  ]

  timeouts { create = "10m" }
}
