# ACM Certificate (var.domain_name 설정 시만 생성)
# 검증은 Cloudflare DNS 기반.

resource "aws_acm_certificate" "main" {
  count             = local.use_https ? 1 : 0
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${local.name_prefix}-cert" }
}

# 검증 record 등록은 cloudflare.tf 의 cloudflare_record.cert_validation 가 담당.
## 여기서는 검증 완료 wait 만 처리.
resource "aws_acm_certificate_validation" "main" {
  count           = local.use_https ? 1 : 0
  certificate_arn = aws_acm_certificate.main[0].arn

  # cloudflare_zone_id 있으면 cloudflare_record.cert_validation 의 hostname 들을 wait.
  # 없으면 null → ACM 이 자체적으로 DNS 폴링 (사람이 수동 등록해야 진행됨).
  validation_record_fqdns = local.use_cloudflare_dns ? [
    for r in cloudflare_record.cert_validation : r.hostname
  ] : null

  timeouts {
    create = "10m"
  }
}
