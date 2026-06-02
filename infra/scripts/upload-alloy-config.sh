#!/usr/bin/env bash
# ── Grafana Cloud 시크릿을 SSM 에 업로드 (dev 전용) ──────────
#
# ⚠️ Alloy config(sidecar/daemon)는 더 이상 이 스크립트로 올리지 않습니다.
#    Terraform 이 단일 source of truth 로 관리합니다:
#      - dev : terraform-dev/ssm.tf  (alloy-sidecar.alloy / alloy-daemon.alloy)
#      - prod: terraform-prod/ssm.tf (alloy-sidecar-prod.alloy / alloy-daemon-prod.alloy)
#    (과거: 이 스크립트가 prod 에서도 dev daemon 파일을 올리는 버그가 있었음 → 제거)
#
# 이 스크립트는 Terraform 이 placeholder(CHANGE_ME)로 두고 ignore_changes 처리한
# Grafana Cloud 시크릿 3종만 out-of-band 로 채웁니다. (prod 는 self-host 라 불필요.)
set -euo pipefail

PROJECT="drawe"
ENV="${1:?usage: $0 <dev>}"
REGION="ap-northeast-2"

if [ "$ENV" != "dev" ]; then
  echo "prod 는 self-host 라 Grafana Cloud 시크릿이 없습니다. dev 에서만 실행하세요."
  exit 1
fi

: "${GRAFANA_OTLP_ENDPOINT:?set GRAFANA_OTLP_ENDPOINT}"
: "${GRAFANA_CLOUD_INSTANCE_ID:?set GRAFANA_CLOUD_INSTANCE_ID}"
: "${GRAFANA_CLOUD_TOKEN:?set GRAFANA_CLOUD_TOKEN}"

put() { # name value type
  aws ssm put-parameter --name "$1" --value "$2" --type "$3" \
    --overwrite --region "$REGION"
  echo "✔ $1"
}

put "/${PROJECT}/${ENV}/grafana-otlp-endpoint" "$GRAFANA_OTLP_ENDPOINT" "String"
put "/${PROJECT}/${ENV}/grafana-instance-id"   "$GRAFANA_CLOUD_INSTANCE_ID" "String"
put "/${PROJECT}/${ENV}/grafana-cloud-token"   "$GRAFANA_CLOUD_TOKEN" "SecureString"

echo ""
echo "✅ Grafana Cloud 시크릿 업로드 완료. ECS 서비스 force new deployment 로 반영하세요."
