# ai_description 배포 가이드

레퍼런스/핀 이미지를 LLM 이 "픽셀 없이 태그로만" 설명하던 한계(없는 디테일 환각) 보강용.
Unsplash 네이티브 AI 캡션(문장)을 `images.ai_description` 에 채워, 주입·검색 rerank 에 사용한다.

## 배포 환경(dev/prod)마다 3가지

| | 항목 | 자동/수동 | 비고 |
|---|---|---|---|
| ① | **컬럼 생성** | ✅ 자동 | 코드 배포 → Flyway `V13__images_add_ai_description.sql` 이 컬럼 추가 (멱등) |
| ② | **데이터 백필** | ⚠️ 수동 1회 | 이 디렉터리의 `backfill_ai_description.sh` — 환경별 RDS 에 각각 |
| ③ | **live 플래그** | ⚙️ env | ECS task def 의 `WORKFLOW_LIVE_INTENTS` (예: `NEW_SEARCH,KEEP,...`) |

> ②를 안 돌리면 컬럼은 생기지만 전부 NULL → 앱은 정상이나 **개선 효과 0**(태그 폴백). 깨지지는 않음.

## ② 백필 실행

선행: ①배포 완료(컬럼 존재) + RDS 파라미터그룹 `local_infile=1` + RDS 도달 가능한 호스트.

```bash
# ai_descriptions.csv 준비 (Colab, photos.csv 에서):
#   photos[["photo_id","ai_description"]].rename(columns={"photo_id":"source_id"}).to_csv("ai_descriptions.csv", index=False)

DB_HOST=<rds-endpoint> DB_NAME=drawe_db DB_USER=<user> DB_PASS=<pass> \
  ./backfill_ai_description.sh ai_descriptions.csv
```

성공 기준: 출력의 `with_desc` 가 Unsplash 적재 수와 비슷(`unsplash_missing` 은 원본이 빈 소수 행).
재실행 안전(멱등). AI 이미지는 매칭 안 돼 NULL 유지(정상 — prompt 사용).

## 검증(선택)

```sql
SELECT COUNT(*) AS images, SUM(ai_description IS NOT NULL) AS with_desc FROM images;
-- 원본 CSV 와 대조: 임의 source_id 의 ai_description 이 CSV 행과 같은지 spot-check
```
