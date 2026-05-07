#!/usr/bin/env bash
# ── Alloy 설정 + Grafana 비밀번호를 SSM에 업로드 ─────────
set -euo pipefail

PROJECT="drawe"
ENV="dev"
REGION="ap-northeast-2"

upload_b64() {
  local file="$1" key="$2" label="$3"
  if [ ! -f "$file" ]; then echo "ERROR: $file not found"; exit 1; fi

  local b64
  b64=$(base64 -w 0 "$file" 2>/dev/null || base64 "$file" | tr -d '\n')

  echo "▶ ${label}: $(echo -n "$b64" | wc -c) bytes → ${key}"
  aws ssm put-parameter \
    --name "$key" --value "$b64" \
    --type SecureString --tier Advanced \
    --overwrite --region "$REGION"
}

# ── Alloy 설정 두 개 업로드 ──────────────────────────────
upload_b64 "configs/alloy-sidecar.alloy" \
  "/${PROJECT}/${ENV}/alloy-config-b64" "Sidecar config"

upload_b64 "configs/alloy-daemon.alloy" \
  "/${PROJECT}/${ENV}/alloy-daemon-config-b64" "Daemon config"

# ── Grafana 어드민 비밀번호 ──────────────────────────────
read -rsp "Enter Grafana admin password: " GF_PASSWORD
echo

aws ssm put-parameter \
  --name "/${PROJECT}/${ENV}/grafana-admin-password" \
  --value "$GF_PASSWORD" \
  --type SecureString \
  --overwrite --region "$REGION"

echo ""
echo "✅ Alloy 설정 + Grafana 비밀번호 업로드 완료"
echo ""
echo "Grafana 접속: http://<ALB-DNS>:3000 (admin / 위에서 설정한 비밀번호)"
