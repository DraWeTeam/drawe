#!/usr/bin/env bash
# ── drawe-deploy/scripts/deploy.sh ───────────────────────
# 수동 배포 또는 초기 이미지 푸시용 스크립트.
# 타겟: linux/arm64 (Graviton EC2)
#
# 사용법:
#   ./scripts/deploy.sh backend         # Backend 빌드 & 배포
#   ./scripts/deploy.sh fastapi         # FastAPI 빌드 & 배포
#   ./scripts/deploy.sh all             # 둘 다
#
# 사전 요구:
#   docker buildx ls 로 docker-container builder 사용 가능 확인.
#   x86 머신에서는 QEMU 에뮬레이션 자동 활성 (느림 — 첫 빌드 30분~).

set -euo pipefail

AWS_REGION="ap-northeast-2"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_BASE="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "manual")
PLATFORM="linux/arm64"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DraWe Manual Deploy"
echo "  Account:  ${ACCOUNT_ID}"
echo "  Region:   ${AWS_REGION}"
echo "  Platform: ${PLATFORM}"
echo "  Tag:      ${TAG}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── buildx builder 준비 (x86 머신에서 ARM 빌드 시 QEMU) ──
if ! docker buildx inspect drawe-builder &>/dev/null; then
  echo "▶ Creating buildx builder 'drawe-builder'..."
  docker buildx create --name drawe-builder --driver docker-container --use
  docker buildx inspect --bootstrap
else
  docker buildx use drawe-builder
fi

# ── ECR 로그인 ────────────────────────────────────────────
aws ecr get-login-password --region "${AWS_REGION}" | \
  docker login --username AWS --password-stdin "${ECR_BASE}"

build_and_push() {
  local context="$1" repo="$2" service_name="$3"
  local image="${ECR_BASE}/${repo}"

  echo ""
  echo "▶ Building ${repo} for ${PLATFORM}..."
  docker buildx build \
    --platform "${PLATFORM}" \
    --tag "${image}:${TAG}" \
    --tag "${image}:latest" \
    --push \
    "${context}"

  echo "▶ Updating ECS service ${service_name}..."
  aws ecs update-service \
    --cluster drawe-dev-cluster \
    --service "${service_name}" \
    --force-new-deployment \
    --region "${AWS_REGION}" \
    --no-cli-pager

  echo "✅ ${repo} deployed: ${image}:${TAG}"
}

deploy_backend() {
  build_and_push "../drawe-backend" "drawe-dev-backend" "drawe-dev-backend"
}

deploy_fastapi() {
  build_and_push "../drawe-fastapi" "drawe-dev-fastapi" "drawe-dev-fastapi"
}

case "${1:-all}" in
  backend)  deploy_backend  ;;
  fastapi)  deploy_fastapi  ;;
  all)      deploy_backend; deploy_fastapi ;;
  *)        echo "Usage: $0 {backend|fastapi|all}"; exit 1 ;;
esac

echo ""
echo "━━ Done ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
