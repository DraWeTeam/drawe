############################################################
# SSM Parameter Store - prod
#
# dev 와 차이:
# - Grafana Cloud 시크릿 없음 (self-host 라)
# - Loki / Tempo config (base64 encoded YAML)
# - Grafana admin 비밀번호
############################################################

# ── TF 가 진실의 소스 ──────────────────────────────────
resource "aws_ssm_parameter" "db_username" {
  name  = "/${var.project}/${var.env}/db-username"
  type  = "String"
  value = var.db_username
}

# ★ db-password / redis-password 는 value 를 무시한다.
#   TF_VAR_db_password / TF_VAR_valkey_auth_token 없이 plan 하면 random_password.*[0] 이
#   새로 생성되어 이 파라미터를 "새 암호로 덮겠다"는 diff 가 뜬다. 그대로 apply 하면
#   - db: RDS 와 SSM 이 함께 로테이션(앱 접속 불가),
#   - redis: SSM 만 바뀌고 ElastiCache 는 ignore_changes=[auth_token] 이라 그대로 →
#            SSM 과 실제 토큰이 어긋나는 split-brain.
#   실제 암호의 소스는 이미 배포된 SSM 값이므로 여기서는 값 변경을 무시한다.
#   회전이 필요하면 별도 절차(신규 값 주입 + 앱 재기동)로 명시적으로 수행한다.
#   (discord_webhook 등 다른 외부 주입 파라미터와 동일 패턴)
resource "aws_ssm_parameter" "db_password" {
  name  = "/${var.project}/${var.env}/db-password"
  type  = "SecureString"
  value = local.db_password

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "redis_password" {
  name  = "/${var.project}/${var.env}/redis-password"
  type  = "SecureString"
  value = local.valkey_auth_token

  lifecycle { ignore_changes = [value] }
}

resource "random_password" "grafana_admin" {
  length           = 24
  special          = true
  override_special = "!#$%&*-_=+"
}

resource "aws_ssm_parameter" "grafana_admin_password" {
  name  = "/${var.project}/${var.env}/grafana-admin-password"
  type  = "SecureString"
  value = random_password.grafana_admin.result
}

# Loki / Tempo config - tier="Standard" (압축 안 함, entrypoint 가 gunzip 안 하므로)
resource "aws_ssm_parameter" "loki_config" {
  name  = "/${var.project}/${var.env}/loki-config-b64"
  type  = "SecureString"
  value = base64encode(file("${path.module}/../configs/loki-config.yaml"))
  tier  = "Standard"
}

resource "aws_ssm_parameter" "tempo_config" {
  name  = "/${var.project}/${var.env}/tempo-config-b64"
  type  = "SecureString"
  value = base64encode(file("${path.module}/../configs/tempo-config.yaml"))
  tier  = "Standard"
}

# Alloy config (prod) — base64gzip + Standard
resource "aws_ssm_parameter" "alloy_config" {
  name  = "/${var.project}/${var.env}/alloy-config-b64"
  type  = "SecureString"
  value = base64gzip(file("${path.module}/../configs/alloy-sidecar-prod.alloy"))
  tier  = "Standard"
}

resource "aws_ssm_parameter" "alloy_daemon_config" {
  name  = "/${var.project}/${var.env}/alloy-daemon-config-b64"
  type  = "SecureString"
  value = base64gzip(file("${path.module}/../configs/alloy-daemon-prod.alloy"))
  tier  = "Standard"
}

# ── 사용자 manual update ─────────────────────────────
resource "aws_ssm_parameter" "jwt_secret" {
  name  = "/${var.project}/${var.env}/jwt-secret"
  type  = "SecureString"
  value = "CHANGE_ME_jwt_secret_base64_at_least_64_chars"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "grok_api_key" {
  name  = "/${var.project}/${var.env}/grok-api-key"
  type  = "SecureString"
  value = "CHANGE_ME"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "claude_api_key" {
  name  = "/${var.project}/${var.env}/claude-api-key"
  type  = "SecureString"
  value = "CHANGE_ME"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "gemini_api_key" {
  name  = "/${var.project}/${var.env}/gemini-api-key"
  type  = "SecureString"
  value = "CHANGE_ME"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "google_client_id" {
  name  = "/${var.project}/${var.env}/google-client-id"
  type  = "SecureString"
  value = "CHANGE_ME"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "google_client_secret" {
  name  = "/${var.project}/${var.env}/google-client-secret"
  type  = "SecureString"
  value = "CHANGE_ME"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "pinecone_api_key" {
  name  = "/${var.project}/${var.env}/pinecone-api-key"
  type  = "SecureString"
  value = "CHANGE_ME"
  lifecycle { ignore_changes = [value] }
}

# ── Pinecone host & index - backend application.properties 신규 키 ──
resource "aws_ssm_parameter" "pinecone_host" {
  name  = "/${var.project}/${var.env}/pinecone-host"
  type  = "String"
  value = "CHANGE_ME_pinecone_host_url"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "pinecone_index" {
  name  = "/${var.project}/${var.env}/pinecone-index"
  type  = "String"
  value = "CHANGE_ME_pinecone_index_name"
  lifecycle { ignore_changes = [value] }
}

# ── Bria AI ─────────────────────────────────────────────
resource "aws_ssm_parameter" "bria_api_key" {
  name  = "/${var.project}/${var.env}/bria-api-key"
  type  = "SecureString"
  value = "CHANGE_ME"
  tags  = { Name = "${local.name_prefix}-bria-api-key" }
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "bria_base_url" {
  name  = "/${var.project}/${var.env}/bria-base-url"
  type  = "String"
  value = "https://engine.prod.bria-api.com"
  tags  = { Name = "${local.name_prefix}-bria-base-url" }
  lifecycle { ignore_changes = [value] }
}

# ── Admin 콘솔 ───────────────────────────────────────────
resource "aws_ssm_parameter" "admin_password" {
  name  = "/${var.project}/${var.env}/admin-password"
  type  = "SecureString"
  value = "CHANGE_ME_admin_password"
  tags  = { Name = "${local.name_prefix}-admin-password" }
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "ga4_sa_key" {
  name  = "/${var.project}/${var.env}/ga4-sa-key"
  type  = "SecureString"
  value = "CHANGE_ME" # apply 후 실제 JSON 수동 주입
  tags  = { Name = "${local.name_prefix}-ga4-sa-key" }
  lifecycle { ignore_changes = [value] }
}

# ── Mail / Gmail SMTP (이메일 인증 발송) ────────────────
# 발신용 Gmail 계정. application.properties 의
#   spring.mail.username=${SMTP_USERNAME}
#   spring.mail.password=${SMTP_PASSWORD}
# 두 키에 매핑된다 (기본값 없음 → 미주입 시 앱 기동 실패).
# 첫 apply 후 실제 값 수동 주입:
#   aws ssm put-parameter --name "/drawe/prod/smtp-username" \
#       --value "<발신용@gmail.com>" --type String --overwrite
#   aws ssm put-parameter --name "/drawe/prod/smtp-password" \
#       --value "<16자리 Gmail 앱 비밀번호>" --type SecureString --overwrite
resource "aws_ssm_parameter" "smtp_username" {
  name  = "/${var.project}/${var.env}/smtp-username"
  type  = "String"
  value = "CHANGE_ME_smtp_username"
  tags  = { Name = "${local.name_prefix}-smtp-username" }
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "smtp_password" {
  name  = "/${var.project}/${var.env}/smtp-password"
  type  = "SecureString"
  value = "CHANGE_ME_smtp_app_password"
  tags  = { Name = "${local.name_prefix}-smtp-password" }
  lifecycle { ignore_changes = [value] }
}