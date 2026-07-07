#!/usr/bin/env bash
#
# images.ai_description RDS 백필 (1회성, 재실행 안전).
#
# 무엇: Unsplash 네이티브 AI 캡션(ai_descriptions.csv)을 이미 적재된 images 행에 source_id 조인으로 채운다.
# 왜:  ai_description 데이터는 앱이 만드는 게 아니라 외부(Unsplash photos.csv)에서 오므로,
#      배포(Flyway V13 가 컬럼 생성)만으론 전부 NULL → 이 백필을 돌려야 값이 채워진다.
#
# 선행조건:
#   1) 코드 배포 완료 → Flyway V13 가 images.ai_description 컬럼을 이미 만들어 둠 (이 스크립트는 컬럼을 만들지 않음).
#   2) RDS 파라미터그룹: local_infile = 1 (ON).  ← 없으면 "LOAD DATA LOCAL INFILE is forbidden" 에러.
#   3) RDS 에 네트워크 도달 가능한 호스트에서 실행 (bastion / 같은 VPC).
#   4) ai_descriptions.csv 준비 (헤더 'source_id,ai_description', 콤마 구분, \n 줄바꿈).
#      Colab: photos[["photo_id","ai_description"]].rename(columns={"photo_id":"source_id"}).to_csv(...)
#
# 사용:
#   DB_HOST=... DB_NAME=drawe_db DB_USER=... DB_PASS=... ./backfill_ai_description.sh ai_descriptions.csv
#   (DB_PORT 기본 3306)
#
# 멱등: UPDATE 는 결정적이라 재실행해도 같은 값으로 다시 세팅될 뿐 안전.
# AI(Bria) 이미지: source_id 가 CSV 에 없어 매칭 안 됨 → ai_description NULL 유지(정상, 그쪽은 prompt 사용).
#
# 로컬에서 겪은 함정 3개 반영:
#   - ESCAPED BY ''        : 캡션이 백슬래시로 끝나는 행이 다음 줄과 병합되는 것 방지
#   - staging INDEX(source_id): images 풀스캔 폭주(락 timeout) 방지 — images 1회 스캔 + 인덱스 lookup
#   - NULLIF(TRIM(...))    : 빈 캡션은 NULL, 끝의 \r 제거
set -euo pipefail

CSV="${1:?usage: $0 <ai_descriptions.csv>}"
DB_HOST="${DB_HOST:?set DB_HOST}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:?set DB_NAME}"
DB_USER="${DB_USER:?set DB_USER}"
DB_PASS="${DB_PASS:?set DB_PASS}"

[ -f "$CSV" ] || { echo "CSV 파일 없음: $CSV" >&2; exit 1; }

echo "백필 시작 → ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}  CSV=${CSV}"

mysql --local-infile=1 -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" <<SQL
-- (컬럼이 없으면 — 즉 Flyway V13 배포 전이면 — 아래 UPDATE 가 "Unknown column 'i.ai_description'" 로 명확히 실패한다.)
CREATE TEMPORARY TABLE _ai_desc (
  source_id VARCHAR(100) COLLATE utf8mb4_0900_ai_ci,
  ai_description TEXT,
  INDEX idx_src (source_id)
);

LOAD DATA LOCAL INFILE '${CSV}'
  INTO TABLE _ai_desc
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY ''
  LINES TERMINATED BY '\n'
  IGNORE 1 LINES
  (source_id, ai_description);

UPDATE images i JOIN _ai_desc s ON i.source_id = s.source_id
  SET i.ai_description = NULLIF(TRIM(TRAILING '\r' FROM TRIM(s.ai_description)), '');

-- 검증 출력
SELECT COUNT(*) AS staged_rows FROM _ai_desc;
SELECT COUNT(*)                                          AS images_total,
       SUM(ai_description IS NOT NULL)                   AS with_desc,
       SUM(source = 'UNSPLASH' AND ai_description IS NULL) AS unsplash_missing
  FROM images;
SELECT source_id, LEFT(ai_description, 55) AS sample
  FROM images WHERE ai_description IS NOT NULL ORDER BY id LIMIT 5;
SQL

echo "백필 완료 — 위 with_desc 가 Unsplash 적재 수와 비슷하면 성공 (unsplash_missing 는 원본이 빈 소수 행)."
