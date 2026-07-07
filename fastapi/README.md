# fastapi

모노레포 `fastapi/` 디렉터리는 **두 개의 FastAPI 서비스**를 담습니다. 같은 디렉터리에 있지만 **별도 이미지·별도 배포(Deployment)·별도 CD 워크플로**로 운영됩니다.

| 서비스 | 진입점 | Dockerfile | CD 워크플로 | 역할 |
| --- | --- | --- | --- | --- |
| **embed** | `main:app` | `Dockerfile` | `fastapi-cd` (`fastapi/**`) | 텍스트/이미지 → CLIP 임베딩(벡터 생성) |
| **guide** | `guide.app:app` | `Dockerfile.guide` | `fastapi-guide-cd` (`fastapi/guide/**` 등) | 한 끗 가이드 — 코칭 에이전트 파이프라인 |

> 두 서비스는 모두 **AWS EKS (Graviton ARM64)** 에 배포되며(ClusterIP 내부 전용, backend 가 호출), 이미지는 ARM64 로 빌드해야 합니다.
> 책임이 분리되어 있습니다 — **embed = 벡터 생성**, **guide = 그림 코칭**. 단일 "AI 호출 서버"가 아니라 서로 다른 도메인 서비스입니다.

---

## 1. embed — CLIP 임베딩 서버

### 역할

- Drawe 백엔드([`backend`](../backend/README.md))의 임베딩 요청을 처리합니다.
- CLIP ViT-Large/14 모델로 텍스트/이미지를 **768차원 벡터**로 변환해 **반환**합니다.
- 벡터의 **저장·검색은 호출자(backend)의 책임**입니다 — embed 자체엔 벡터 저장소 코드가 없습니다(챗/보드 검색 벡터는 backend 가 **Pinecone** 에 적재).

### 스택

- FastAPI + uvicorn
- PyTorch + transformers
- CLIP (`openai/clip-vit-large-patch14`)

### API

| 메서드 · 경로 | 설명 |
| --- | --- |
| `GET /health` | 헬스 체크 |
| `POST /embed/text` | 텍스트(JSON) → 768-dim 벡터 |
| `POST /embed/image` | 이미지(멀티파트 `UploadFile`, ≤10MB) → 768-dim 벡터 |

**`POST /embed/text`**
```json
// Request
{ "text": "cherry blossoms spring" }
// Response  (TextEmbedResponse)
{ "embedding": [0.123, -0.456, "..."], "dimension": 768 }
```

### 의존 시스템

- **호출자**: backend (Spring Boot)
- **모델**: HuggingFace CLIP (`openai/clip-vit-large-patch14`)
- **벡터 저장소**: 없음(반환만) — Pinecone 적재는 backend 소관

---

## 2. guide — 한 끗 가이드(코칭 에이전트)

### 역할 한 줄

올린 그림에서 *관찰 가능한 시각 신호*를 근거로 "지금 한 끗을 바꾸면 좋아지는 지점"을 그림 위에서 짚어주는 **코칭 에이전트 파이프라인**(+ 그 코칭에 쓰이는 CLIP 참고 검색).

> ⚠️ **그림의 "실력"을 점수로 평가하지 않습니다.** 자유 서술 채점이 아니라, taxonomy 로 정의된 *관찰 가능한 신호*(지평선·시점·명암·무게중심 등)를 근거로 한 코칭입니다.

### 에이전트 루프

한 끗 가이드는 단일 프롬프트 호출이 아니라, 다음을 수행하는 **에이전트 파이프라인**입니다.

1. **관찰** — 포즈/손 **키포인트**(mediapipe) + **VLM 관찰**. VLM 백엔드는 `VLM_BACKEND` 로 분기: `aistudio`(Gemini) / `vertex` / **`bedrock`(AWS Bedrock Claude Vision, prod)**. 애매대역에서만 주제 VLM 에스컬레이션.
2. **진단** — 관찰 신호 → taxonomy `what_to_observe` 로 개선 축(`sub_problem`) 판정. 관찰 못 한 것은 말하지 않습니다(환각 방지 게이트).
3. **우선순위 결정** — 어떤 지점을 짚을지는 **관찰 신호 기반 결정 로직**이 정합니다(LLM 아님). 동일한 관찰 신호에는 추적 가능한 동일 기준의 근거가 적용됩니다.
4. **레퍼런스 검색** — **Qdrant**(`reference_images_{env}`)에서 **저장 축(sub_problem)의 정적 질의**로 후보를 찾고, 온보딩 **무드 취향(persona_lean)** 을 **soft boost**(연습 목적 적합성이 항상 우선)로 반영. 노출분은 **exclude** 로 누적해 재탐색.
5. **코칭** — **Grok**(xAI)이 축별 관찰·방향을 자연 문장으로 **표현**합니다. 분류·연습·도식·로드맵은 코드가 결정적으로 채웁니다.
6. **사용자 피드백 루프** — 추천이 안 맞으면 **🔄 재추천(`/reroll`)**: 같은 축·노출분 제외로 새 컷을 받되 LLM 0콜. 후보가 **소진**되면 **AI 생성(backfill, AWS Bedrock Stability)** 으로 전환하고, **품질 검수(QC)** 를 통과한 생성물만 코퍼스에 편입합니다.

> **그림 위 오버레이** — 포즈 키포인트 좌표로 개선 지점을 사용자 그림 위에 ①② 마커로 렌더합니다(반복+측정된 축에 한함). 무드 취향이 참조와 결이 맞으면 그 사실을 **"취향 결"** 로 표시만 합니다(스코어링·부스트와 무관, 관찰만).

### 역할 분리 원칙

**VLM 은 관찰**하고 · **결정 로직이 판단**(무엇을 짚을지)하고 · **검색이 후보**를 대고 · **LLM 은 표현**만 합니다. 그래서 코칭이 재현 가능하고, 도식/연습이 실제 자산과 항상 일치하며, 추천 이유를 추적할 수 있습니다. 성장(`growth`)은 **측정=사실로만** 서술합니다(점수가 아님) — LLM 이 배열한 문장은 가드레일 검증을 통과한 뒤 `note` 로만 들어가고, 없으면 구조 필드로 폴백합니다.

| 단계 | 무엇을 | 결정 주체 |
| --- | --- | --- |
| 주제 분류 | 관찰 신호 → `sub_problem`(개선 축) | taxonomy `what_to_observe` (코드) |
| 연습 매핑 | 축별 연습 과제 → `focus_practice` | taxonomy `practice_prompt` (코드) |
| 도식 매핑 | 한 끗 포인트 도식 → `guide_asset` | 자산 매니페스트 (코드, 결정적) |
| 성장 로드맵 | 다음 목표·반복 축·추세 → `next_steps`·`growth` | `practice_log` 집계 (코드) |
| 무드 가시화 | 참조 persona ∩ 온보딩 취향 → `mood_profile.persona_lean` | 교집합 '사실'만 표시(#54) |
| 노출/채택 기록 | 피드백 루프 → `adoption_log` | `POST /adopt` |

### 품질 — 측정으로 결정한다

- **골든셋 회귀 검증** — 관찰·진단은 손/인물/얼굴/엣지 골든셋으로 축별 정확도·환각 방지 게이트를 회귀 검증합니다. **프롬프트를 건드리는 변경은 재평가를 짝**으로 합니다.
- **Bedrock 페어드 전환** — 손 VLM 을 동일 코드에서 백엔드만 바꿔 페어드 비교(**골든셋 35장·111콜, 정확도 동급** 확인 후 적용). 이미지 생성·VLM 관찰 모두 **AWS Bedrock 전환·운영 중**이며, 롤백은 env 한 줄.

### 스택

- FastAPI + uvicorn · OpenTelemetry 계측
- **OpenCLIP** (`ViT-L-14:openai`, 768-dim, 지연 로드) · PyTorch(CPU wheel)
- **mediapipe** — 포즈/손 키포인트; **VLM 손 관찰자** 게이트는 `HAND_VLM`(관찰자는 mediapipe 가 아니라 VLM)
- **벡터 검색** — 기본 **Qdrant**(`qdrant-client`); `VECTOR_BACKEND` 로 **Pinecone 병존**(운영 일부) — `guide/stores/vectors.py`
- **AWS Bedrock** — 이미지 생성(Stability `stable-image-core`) · 손 VLM 관찰(Claude Vision). 키 없이 **IRSA/IAM** 자격
- **LLM** — **Grok**(코칭 문장, xAI)
- **MySQL `drawe_guide`** (SQLAlchemy + PyMySQL) — 성장/로그/피드백 · **S3**(boto3) — 참고 이미지·에셋 presign
- Pillow + pillow-heif — 아이폰 HEIC/HEIF 업로드 정규화

### API (주요)

| 메서드 · 경로 | 설명 |
| --- | --- |
| `GET /health` | 헬스 체크(모델 워밍업 전이면 loading) |
| `POST /analyze` | 업로드 이미지에서 관찰 신호 추출(임베딩·게이트·참고 검색) |
| `POST /guide` · `POST /guide/stream` | 가이드 생성(개선 포인트·연습·참고·도식·로드맵·오버레이·무드) |
| `POST /reroll` | 단일 축 재추천 — 노출분 제외 재탐색(LLM 0콜, 소진 시 exhausted) |
| `POST /generate-image` | 개념 → 레퍼런스 이미지 생성(AWS Bedrock Stability) |
| `GET /ref-job/{job_id}` | 생성 중 레퍼런스 폴링 |
| `POST /search` | 참고 레퍼런스 검색 |
| `GET /image/{ref_id}` · `GET /guide-asset/{ref_id}` · `GET /svg/{ref_id}` | 참고 이미지 / 도식 / SVG 해소 |
| `POST /adopt` | 노출/채택/피드백 기록(shown·liked·disliked 등) |
| `GET /roadmap` · `POST /practice` | 성장 로드맵 · 연습 |

> `POST /guide` 폼 파라미터(실측): `message · user_id · intent · track · medium · request_id · project_id · mood`. `mood`(온보딩 취향)가 있으면 응답에 `mood_profile.persona_lean` 이 실립니다(구 가이드 payload 엔 없음 → 프론트 폴백).

### `POST /guide` 응답 스키마(발췌)

> 실제 응답(`GuideResponse`) 구조. `ref_id`·수치·문장 값은 입력마다 달라지고, 구조(필드)는 동일합니다.

```json
{
  "guide_id": "g_01HX…",
  "primary_focus": "value_structure",
  "degraded": false,
  "blocks": [{
    "sub_problem": "명암 대비",
    "observation": "밝은 곳과 어두운 곳의 명도 차가 좁습니다",
    "direction": "가장 밝은/어두운 곳을 먼저 정하고 단계를 벌리세요",
    "reference_ids": ["…"],
    "guide_asset": { "ref_id": "…", "label": "도식", "caption": "…" }
  }],
  "overlay": "<svg …>",                       // 그림 위 ①② 마커(있을 때)
  "visual_mode": { "overlay_axes": ["value_structure", "weight_balance"] },
  "mood_profile": { "persona_lean": ["mood"] }, // #54 온보딩 취향(있을 때)
  "reference_meta": { "…": { "personas": ["light", "mood"], "source_type": "museum" } },
  "next_steps": { "focus": "…", "focus_practice": "…", "track": { "stages": ["…"] } },
  "growth": { "narration": "…", "trend": [], "recurring_stat": { "first_week_hits": 6, "last_week_hits": 1 } }
}
```

### 스키마 마이그레이션

guide DB(`drawe_guide`)는 평문 SQL 마이그레이션 러너로 관리됩니다(`schema/ddl.sql` + `schema/migrations/NNN_*.sql`).

```bash
# DB 가 닿는 환경에서, fastapi/ 디렉터리 기준
python -m guide.stores.migrate
```
- `schema_version` 추적 + `GET_LOCK` 으로 **순서·멱등·동시성** 보장.
- `GUIDE_AUTO_MIGRATE=1` 이면 서비스 기동 시 자동 적용(락으로 다중 태스크 안전).

### 의존 시스템

- **호출자**: backend (Spring Boot, `FASTAPI_GUIDE_URL`)
- **벡터 저장소**: Qdrant Cloud(`reference_images_{env}`) — 운영 일부 Pinecone 병존(`VECTOR_BACKEND`)
- **DB**: MySQL `drawe_guide`(Spring 의 `drawe` 와 분리, 같은 RDS) · **에셋**: S3

---

## 실행 방법

### 권장: docker-compose 스택으로 함께 기동

전체 로컬 스택(MySQL · Valkey · backend · fastapi(embed) · guide)을 함께 띄우려면 [`infra`](../infra/README.md) 의 로컬 compose 를 사용하세요.

```bash
cd ../infra
docker compose -f docker-compose.local.yml up -d
# embed → http://localhost:8000   guide → http://localhost:8001
```

### 단독 실행

```bash
python -m venv venv
.\venv\Scripts\activate        # Windows
source venv/bin/activate       # Mac/Linux
```

**embed**
```bash
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8000
```

**guide** (이 디렉터리 = `fastapi/` 에서 실행 — `guide` 패키지 import)
```bash
pip install -r requirements.guide.txt      # torch 는 Dockerfile.guide 에서 CPU wheel 로 설치
# 핵심 env: DB_DSN(mysql+pymysql://…drawe_guide) · QDRANT_URL/QDRANT_API_KEY(+VECTOR_BACKEND·PINECONE_*) ·
#           XAI_API_KEY(Grok) · VLM_BACKEND(aistudio|vertex|bedrock)·(선택)GEMINI_API_KEY ·
#           AI_GEN_PROVIDER(bedrock|gemini|bria) · BEDROCK_* · S3_BUCKET
uvicorn guide.app:app --host 0.0.0.0 --port 8001
```

---

## 배포

- **타깃**: AWS EKS (Graviton ARM64) — 이미지는 **ARM64 빌드 필요**. 두 서비스 모두 ClusterIP(내부 전용, backend 가 호출).
- **embed**: `Dockerfile` → `fastapi-cd`(`fastapi/**`) → ECR → overlay tag bump → **ArgoCD 롤아웃**.
- **guide**: `Dockerfile.guide` → `fastapi-guide-cd`(`fastapi/guide/**` · `fastapi/assets/**` · `Dockerfile.guide` · `requirements.guide.txt`) → ECR → overlay tag bump → **ArgoCD 롤아웃**.
- guide 시크릿(DB_DSN · Qdrant/Pinecone · Grok)은 SSM → **ESO(External Secrets)** 로 주입되며, **Bedrock 은 키가 아니라 IRSA/IAM** 자격으로 접근합니다. dev 스토어 백필은 [`infra/runbooks/dev_store_backfill.md`](../infra/runbooks/dev_store_backfill.md) 참고.
- 무중단: ArgoCD 롤링 업데이트 + readiness probe(guide 는 워밍업 전 `loading`). spot 회수 시 SIGTERM→draining.
- 환경(dev/prod) 차이는 [`infra/README.md`](../infra/README.md) 참고.

## 관련 문서

- [루트 README](../README.md) — 전체 아키텍처
- [`backend/README.md`](../backend/README.md) — 호출자
- [`frontend/README.md`](../frontend/README.md) — 사용자 UI
- [`infra/README.md`](../infra/README.md) — 배포·환경·관측성
