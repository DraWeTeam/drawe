# dev 스토어 백필 런북

> 목적: dev 환경에서 가이딩 응답의 **레퍼런스 포인터(`ref_id`)가 끝까지 해소**되게 한다.
> 해소 경로: `Qdrant(reference_images_dev) → reference_images(행) → S3 presigned URL`.
> 이 런북은 **P1/P2(코드)와 병렬**로 굴릴 수 있다(데이터·인프라 작업이라 코드와 독립).
>
> **종료 기준**: 임의의 `ref_id` 하나가 `Qdrant → reference_images → S3 presigned`로 브라우저에서 열린다.

개인 repo(artref)의 로컬 스택은 **MySQL `artref` + MinIO `artref` 버킷 + Qdrant 로컬**이다.
dev 는 **`drawe_guide`(같은 RDS, 별도 DB) + AWS S3 dev 버킷 + Qdrant Cloud `reference_images_dev`**.
즉 *벡터는 재사용*, *행과 에셋만 백필*한다.

---

## 0. 확정값 (마스터 플랜 §1 기준)

| 항목 | dev 값 | 출처 |
| --- | --- | --- |
| 가이딩 벡터 | Qdrant Cloud `reference_images_dev` (어제 시드, **재사용**) | 플랜 §1 |
| 영속 DB | `drawe_guide` (artref RDS 안 별도 DB) | 플랜 §1 |
| 에셋 버킷 | AWS S3 dev 버킷 = `aws_s3_bucket.artref` (Terraform 관리) | `infra/terraform-dev/s3-artref.tf` |
| 임베더 | **OpenCLIP ViT-L/14 (openai) = 768차원** | ECS env `EMBEDDING_MODEL=open_clip:ViT-L-14:openai` |
| SSM 파라미터 | `/drawe/dev/fastapi/*` (DB_DSN·QDRANT_*·S3_*·GEMINI·XAI) | `ssm-artref-fastapi.tf`, `ssm-qdrant.tf` |

> ⚠️ **차원 일치 게이트**: dev 배포 task 는 `ViT-L-14(768)` 로 임베딩한다.
> 따라서 `reference_images_dev` 컬렉션이 **반드시 768차원**으로 시드돼 있어야 검색이 동작한다.
> (로컬 artref `.env.example` 은 `ViT-B-32(512)` 이므로, 로컬 기준으로 시드한 컬렉션을 그대로 쓰면 차원 불일치로 검색이 실패한다.) → **§5 에서 검증**.

> 🧭 **두 레퍼런스 시스템은 분리** — 헷갈리지 말 것.
> - **한 끗 가이드(이미지 기반 가이딩)에 나오는 자료 전부** = **fastapi + Qdrant Cloud**, env 별 컬렉션(`reference_images_dev` / `reference_images_prod`). 이 백필이 다루는 대상이자 **이 guide 서비스가 책임진다.**
> - **채팅 옆 "레퍼런스 추천" 그리드(이미지만 뜨는 레퍼런스 보드)** = **Pinecone**(별도 백엔드/플로우). 이 런북·guide 서비스에서 만지지 않는다.
> - 두 풀은 **섞이지 않는다**: guide(Qdrant) 자료가 Pinecone 그리드에 들어가지 않고, 그 반대도 아니다.
> guide ECS task 에는 Pinecone 시크릿이 주입되지 않는다(`ecs-guide.tf` 는 Qdrant 만).

> ℹ️ **SSM 파라미터 이름 주의**: DB DSN 파라미터 이름은 기존 머지 그대로 `…/artref-db-dsn` 이다(리소스명 `aws_ssm_parameter.artref_db_dsn`).
> *이름만* artref 이고, 가리키는 **DB 는 `drawe_guide`** 다. 값에 `…/drawe_guide` 를 넣으면 된다(이름은 안 바꿔도 무방).

---

## 1. 사전 준비

```bash
# 도구
aws --version          # AWS CLI v2
rclone version         # 에셋 동기화
mysql --version        # 행 백필

# 자격증명 — dev 계정으로 (SSM/S3/RDS 접근)
export AWS_PROFILE=drawe-dev
export AWS_REGION=ap-northeast-2

# SSM 에서 dev 값 읽기 (P4 에서 적재됨)
DB_DSN=$(aws ssm get-parameter --with-decryption --name /drawe/dev/fastapi/DB_DSN --query Parameter.Value --output text)
QDRANT_URL=$(aws ssm get-parameter --name /drawe/dev/fastapi/QDRANT_URL --query Parameter.Value --output text)
QDRANT_API_KEY=$(aws ssm get-parameter --with-decryption --name /drawe/dev/fastapi/QDRANT_API_KEY --query Parameter.Value --output text)
DEV_BUCKET=$(cd infra/terraform-dev && terraform output -raw artref_bucket_name 2>/dev/null || echo "drawe-dev-artref")
```

소스(로컬 artref) 접속값 — `artref/.env.example` 참고:

```
# 소스 DB
SRC_DB_DSN=mysql+pymysql://root:devpass@127.0.0.1:3306/artref
# 소스 MinIO
SRC_S3_ENDPOINT=http://127.0.0.1:9000
SRC_S3_KEY=minio
SRC_S3_SECRET=minio12345
SRC_S3_BUCKET=artref
```

> 소스 스택이 안 떠 있으면 개인 repo 에서 `docker compose up -d mysql minio qdrant` 로 띄운 뒤 진행.

---

## 2. dev S3 버킷 (Terraform 관리 — 확인만)

버킷은 수동 생성하지 않는다. 스토어 스택(`s3-artref.tf`, `iam-s3-artref.tf`)이 이미 머지돼 있으므로 **apply 로 보장**한다.

```bash
cd infra/terraform-dev
terraform init
terraform apply -target=aws_s3_bucket.artref \
                -target=aws_iam_role_policy.ecs_task_artref_s3   # 이름은 iam-s3-artref.tf 기준
aws s3 ls "s3://${DEV_BUCKET}" >/dev/null && echo "bucket OK: ${DEV_BUCKET}"
```

> 참고: 런타임 코드(`fastapi/guide/stores/s3.py`)는 **키가 비면 ECS task role 자격증명 체인**으로 폴백하고,
> 매니지드 버킷(Terraform 생성) 전제로 `ensure_bucket()` 에서 **CreateBucket 을 시도하지 않는다**(head 만).
> 따라서 task role 에 CreateBucket 권한은 필요 없다(S3 RW 만).

---

## 3. `drawe_guide` DB + 유저 + 스키마

### 3-1. DB / 유저

같은 RDS 인스턴스 안에 **별도 데이터베이스**를 만든다(Spring 의 `drawe` 와 분리).

```sql
-- RDS 관리자로 1회
CREATE DATABASE IF NOT EXISTS drawe_guide
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'drawe_guide'@'%' IDENTIFIED BY '<SECRET>';
GRANT ALL PRIVILEGES ON drawe_guide.* TO 'drawe_guide'@'%';
FLUSH PRIVILEGES;
```

> 이 DSN(`mysql+pymysql://drawe_guide:<SECRET>@<rds-host>:3306/drawe_guide`)을
> **SSM `/drawe/dev/fastapi/DB_DSN`(SecureString)** 에 넣어 둔다(P4). ECS task 가 이걸 주입받는다.

### 3-2. 마이그레이션 전체 실행

이제 평문 SQL 러너가 **순서·멱등·동시성**을 보장한다(`schema_version` 추적 테이블 + `GET_LOCK`).
DSN 은 서비스 설정(`settings.db_dsn`, SSM 주입)을 그대로 쓴다 — 별도 접속 문자열 불필요.

```bash
# 가이드 컨테이너 안에서(ECS exec) 또는 bastion 의 동일 파이썬 환경에서
python -m guide.stores.migrate
# → "적용 N건". 재실행해도 안전(이미 적용분은 건너뜀, 부분 적용 DB 도 보정).
```

ECS 배포에 묶으려면 같은 명령을 **one-off task** 로 1회 실행하고, dev/로컬은
`GUIDE_AUTO_MIGRATE=1` 로 기동 시 자동 적용한다(락으로 다중 태스크 동시 적용 안전). prod 는 기본
비활성 → 위 통제 적용 권장.

> 수동 폴백(러너를 못 쓰는 환경): 순서 **베이스(`ddl.sql`) → 증분(`002` … `012`)**. (001 은 `ddl.sql` 이 대신함.)
> ```bash
> SCHEMA=fastapi/guide/schema
> DEV_DB="mysql --force -h <rds-host> -u drawe_guide -p drawe_guide"
> $DEV_DB < $SCHEMA/ddl.sql
> for f in $(ls $SCHEMA/migrations/0*.sql | sort); do echo ">> $f"; $DEV_DB < "$f"; done
> ```

적용되는 증분(요약): `002` 라이브러리 컬럼 · `003` practice_log · `004` ai_example_source ·
`005` ai_qc_audit · `006` user_goal · `007` adopt_disliked · `008` ref_id 폭 확장 ·
`009` observable_action · `010` user_plan · `011` practice_instrument ·
**`012` guide_request(= request_id at-most-once 디둡 테이블, P2)**.

---

## 4. 백필

### 4-1. 에셋: MinIO → S3 (rclone, **키 보존**)

`reference_images.image_key` / `thumb_key` 는 **버킷 내 객체 키**다. 이 키가 양쪽에서 동일해야
행이 가리키는 객체가 그대로 해소된다 → **rclone 으로 키를 1:1 복사**(리네이밍 금지).

```bash
# rclone remote 2개 정의(환경변수 방식)
export RCLONE_CONFIG_SRC_TYPE=s3 RCLONE_CONFIG_SRC_PROVIDER=Minio \
       RCLONE_CONFIG_SRC_ENDPOINT=$SRC_S3_ENDPOINT \
       RCLONE_CONFIG_SRC_ACCESS_KEY_ID=$SRC_S3_KEY \
       RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY=$SRC_S3_SECRET

export RCLONE_CONFIG_DST_TYPE=s3 RCLONE_CONFIG_DST_PROVIDER=AWS \
       RCLONE_CONFIG_DST_REGION=$AWS_REGION RCLONE_CONFIG_DST_ENV_AUTH=true

# 전체 객체를 같은 키로 복사 (dry-run 으로 먼저 확인)
rclone copy SRC:$SRC_S3_BUCKET DST:$DEV_BUCKET --checksum --dry-run
rclone copy SRC:$SRC_S3_BUCKET DST:$DEV_BUCKET --checksum
rclone check SRC:$SRC_S3_BUCKET DST:$DEV_BUCKET --one-way   # 누락 0 확인
```

### 4-2. 행: `reference_images` (mysqldump `--no-create-info`)

스키마는 §3 에서 이미 만들었으므로 **데이터만** 덤프해서 적재한다.

```bash
# 소스에서 데이터만 (CREATE TABLE 제외)
mysqldump --no-create-info --complete-insert --single-transaction \
          -h 127.0.0.1 -u root -pdevpass artref reference_images \
          > /tmp/reference_images.dev.sql

# dev DB 로 적재
$DEV_DB < /tmp/reference_images.dev.sql
$DEV_DB -e "SELECT COUNT(*) AS n, MIN(embedding_model) em FROM reference_images;"
```

> `008_widen_ref_id.sql` 적용 후이므로 `ref_id` 폭이 충분하다(소스 키 잘림 없음).
> 라이선스/출처 컬럼(`license`,`attribution`,`commercial_ok`)도 함께 넘어온다(가드레일이 참조).

### 4-3. Qdrant: **재사용**(시드 금지) + 일관성 확인

벡터는 이미 `reference_images_dev` 에 있다. **재시드하지 않는다.**
다만 행/객체와 **포인트 ID(=ref_id) 정합**과 **차원 정합**만 확인한다(§5).

---

## 5. 종단 해소 검증 (종료 기준)

```bash
# (a) 차원 게이트 — 컬렉션이 768(ViT-L/14)인지
curl -s -H "api-key: $QDRANT_API_KEY" \
     "$QDRANT_URL/collections/reference_images_dev" \
  | python3 -c "import sys,json; d=json.load(sys.stdin)['result']; \
print('dim=', d['config']['params']['vectors']['size'])"
# → dim= 768  이어야 함. 512 면 ViT-B/32 로 시드된 것 → ViT-L/14 로 재시드 필요(차원 불일치).

# (b) 컬렉션에서 임의 포인트 1개의 id(ref_id) 뽑기
REF_ID=$(curl -s -H "api-key: $QDRANT_API_KEY" -H 'content-type: application/json' \
  -d '{"limit":1,"with_payload":false}' \
  "$QDRANT_URL/collections/reference_images_dev/points/scroll" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['points'][0]['id'])")
echo "REF_ID=$REF_ID"

# (c) 그 ref_id 가 dev DB 행으로 해소되는지
$DEV_DB -e "SELECT ref_id, image_key, thumb_key FROM reference_images WHERE ref_id='$REF_ID';"

# (d) image_key 가 S3 객체로 존재 + presigned 로 브라우저 열람 가능
KEY=$($DEV_DB -N -e "SELECT image_key FROM reference_images WHERE ref_id='$REF_ID';")
aws s3 ls "s3://$DEV_BUCKET/$KEY" && \
aws s3 presign "s3://$DEV_BUCKET/$KEY" --expires-in 600
```

(a)~(d) 가 모두 통과하면 **종료**.

---

## 6. 코드 측 적응

배포(IAM task role)로 굴리기 위해 런타임 코드를 다음과 같이 맞춰 두었다:

- `fastapi/guide/config.py` — `s3_endpoint/s3_key/s3_secret/embedding_model` **기본값을 빈 문자열**로.
  (로컬은 MinIO 키 주입, AWS 는 비워서 IAM 폴백.)
- `fastapi/guide/stores/s3.py` — 키가 없으면 boto3 클라이언트에서 자격증명 인자를 빼 **ECS task role 체인**으로 폴백,
  `endpoint_url` 도 비우면 **AWS 리전 기본 엔드포인트** 사용. `ensure_bucket()` 은 매니지드 버킷 전제로 생성 생략.
- `fastapi/guide/app.py` — `CORS_ORIGINS` 를 미들웨어에 적용(브라우저가 `/guide-asset`·presigned 에 직접 접근).

> dev ECS task env(`infra/terraform-dev/ecs-guide.tf`)는 위 전제에 맞춰
> `S3_ENDPOINT/S3_PUBLIC_ENDPOINT = https://s3.<region>.amazonaws.com`, `S3_KEY/SECRET` 미주입,
> `EMBEDDING_MODEL=open_clip:ViT-L-14:openai`, `QDRANT_COLLECTION=reference_images_dev` 로 설정돼 있다.

---

## 7. prod 승격(P10) 차이만

같은 절차를 prod 계정으로. 바뀌는 것은 **값**뿐이다:
- 버킷 = prod `aws_s3_bucket.artref`(terraform-prod), Qdrant 컬렉션 = `reference_images_prod`,
  DB = prod RDS 의 `drawe_guide`, SSM 경로 = `/drawe/prod/fastapi/*`.
- prod Qdrant 컬렉션도 **768(ViT-L/14)** 로 시드돼 있어야 한다.
