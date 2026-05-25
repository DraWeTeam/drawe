#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# seed-local.sh — 로컬 통합 스택에 reference 데이터 + 온보딩 시드 적재
#
# 위치:  infra/scripts/seed-local.sh
# 용도:  docker-compose.local.yml 의 mysql 에
#          1) reference 데이터(images, image_drawe_tags) 적재
#          2) 온보딩 시드(01_onboarding_images.sql) 실행
#        를 한 번에. (스키마는 백엔드의 Flyway 가 만들고, 데이터만 이 스크립트가 채움)
#
# 사용:  infra/ 에서  ./scripts/seed-local.sh [reference_data_파일경로]
#          기본 경로: infra/reference_data.sql
#        Windows 는 Git Bash 또는 WSL 에서:  bash scripts/seed-local.sh
#
# 전제:  reference_data.sql 은 18MB 라 git 에 없습니다.
#        공유 스토리지에서 받아 infra/ 에 두거나, 경로를 인자로 넘기세요.
#        (※ reference_data*.sql 은 .gitignore 에 추가해 커밋되지 않게 하세요)
#
# reference_data.sql 다운로드:
# https://drive.google.com/file/d/12UN8Z5pCxPvLUIOeCk6Q7BiKahst1sOF/view?usp=sharing
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$INFRA_DIR/.." && pwd)"

COMPOSE="docker compose -f $INFRA_DIR/docker-compose.local.yml"

# DB 접속값: infra/.env 가 있으면 사용, 없으면 기본값(compose 기본값과 동일)
if [ -f "$INFRA_DIR/.env" ]; then set -a; . "$INFRA_DIR/.env"; set +a; fi
DB_USER="${DB_USERNAME:-drawe_user}"
DB_PASS="${DB_PASSWORD:-drawe_pass}"
DB_NAME="drawe_db"

REF_SQL="${1:-$INFRA_DIR/reference_data.sql}"
SEED_SQL="$REPO_DIR/backend/src/main/resources/db/seeds/01_onboarding_images.sql"

mysql_exec() { $COMPOSE exec -T mysql mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" "$@"; }

# 0) reference 파일 존재 확인
if [ ! -f "$REF_SQL" ]; then
  echo "✗ reference SQL 을 찾을 수 없습니다: $REF_SQL"
  echo "  공유 스토리지에서 reference_data.sql 을 받아 infra/ 에 두거나,"
  echo "  경로를 인자로 주세요:  ./scripts/seed-local.sh /path/to/reference_data.sql"
  exit 1
fi

# 1) 스택 기동 보장 (멱등 — 이미 떠 있으면 no-op)
echo "▶ 스택 기동 확인 (up -d)"
$COMPOSE up -d

# 2) mysql + 스키마(images 테이블) 준비될 때까지 대기 (Flyway 가 만들 때까지)
echo "▶ mysql / 스키마 준비 대기 (최대 ~120s)..."
ready=0
for i in $(seq 1 60); do
  if mysql_exec -e "SELECT 1 FROM images LIMIT 1;" >/dev/null 2>&1; then
    echo "  ✓ images 테이블 확인 — 스키마 준비됨"
    ready=1; break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "✗ images 테이블이 생기지 않았습니다. 백엔드가 떠서 Flyway 가 스키마를 만들었는지 확인하세요:"
  echo "    $COMPOSE logs --tail=80 backend"
  exit 1
fi

# 3) reference 데이터 적재 (바이트 보존을 위해 컨테이너로 복사 후 내부에서 source)
echo "▶ reference 데이터 적재: $(basename "$REF_SQL")"
$COMPOSE cp "$REF_SQL" mysql:/tmp/reference_data.sql
$COMPOSE exec -T mysql sh -c "mysql -u$DB_USER -p$DB_PASS $DB_NAME < /tmp/reference_data.sql"

# 4) 온보딩 시드 적재
echo "▶ 온보딩 시드 적재: $(basename "$SEED_SQL")"
$COMPOSE cp "$SEED_SQL" mysql:/tmp/seed.sql
$COMPOSE exec -T mysql sh -c "mysql -u$DB_USER -p$DB_PASS $DB_NAME < /tmp/seed.sql"

# 5) 검증 (onboarding 이 12 면 정상)
echo "▶ 검증:"
mysql_exec -e "SELECT COUNT(*) AS images FROM images;
               SELECT COUNT(*) AS tags FROM image_drawe_tags;
               SELECT COUNT(*) AS onboarding FROM images WHERE is_onboarding=1;"

echo "✓ 완료 — onboarding 이 12 면 정상입니다."