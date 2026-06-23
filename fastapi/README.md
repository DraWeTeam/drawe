# fastapi

모노레포 `fastapi/` 디렉터리는 **두 개의 FastAPI 서비스**를 담습니다. 같은 디렉터리에 있지만 **별도 이미지·별도 배포(Deployment)·별도 CD 워크플로**로 운영됩니다.

| 서비스 | 진입점 | Dockerfile | CD 워크플로 | 역할 |
| --- | --- | --- | --- | --- |
| **embed** | `main:app` | `Dockerfile` | `fastapi-cd` (`fastapi/**`) | 텍스트/이미지 → CLIP 임베딩(벡터 생성) |
| **guide** | `guide.app:app` | `Dockerfile.guide` | `fastapi-guide-cd` (`fastapi/guide/**` 등) | 이미지 가이드(관찰 신호 → 구조화된 코칭) |

> 두 서비스는 모두 **AWS EKS (Graviton ARM64)** 에 배포되며(ClusterIP 내부 전용, backend 가 호출), 이미지는 ARM64 로 빌드해야 합니다.
> 책임이 분리되어 있습니다 — **embed = 벡터 생성**, **guide = 그림 코칭**. 단일 "AI 호출 서버"가 아니라 서로 다른 도메인 서비스입니다.

---

## 1. embed — CLIP 임베딩 서버

### 역할

- Drawe 백엔드([`backend`](../backend/README.md))의 임베딩 요청을 처리합니다.
- CLIP ViT-Large/14 모델로 텍스트/이미지를 **768차원 벡터**로 변환합니다.
- 결과 벡터는 **Pinecone** 에 저장되거나 검색에 사용됩니다.

### 스택

- FastAPI + uvicorn
- PyTorch + transformers
- CLIP (`openai/clip-vit-large-patch14`)

### API

| 메서드 · 경로 | 설명 |
| --- | --- |
| `GET /health` | 헬스 체크 |
| `POST /embed/text` | 텍스트 → 768-dim 벡터 |
| `POST /embed/image` | 이미지 → 768-dim 벡터 |

**`POST /embed/text`**
```json
// Request
{ "text": "cherry blossoms spring" }
// Response
{ "vector": [0.123, -0.456, "..."] }
```

### 의존 시스템

- **호출자**: backend (Spring Boot)
- **모델**: HuggingFace CLIP (`openai/clip-vit-large-patch14`)
- **벡터 저장소**: Pinecone

---

## 2. guide — 이미지 가이드(한 끗 가이드) 서버

### 역할

사용자가 올린 그림에서 **관찰 가능한 시각 신호를 추출**(OpenCLIP + mediapipe)하고, 유사 레퍼런스를 검색해, **개선 포인트("한 끗 포인트") · 연습 과제 · 참고 이미지 · 도식**을 함께 제시하는 코칭 서비스입니다.

> ⚠️ **그림의 "실력"을 점수로 평가하지 않습니다.** GPT-4o/Vision 류의 자유 서술 평가가 아니라,
> taxonomy 로 정의된 *관찰 가능한 신호*(지평선·시점·명암·무게중심 등)를 근거로 한 코칭입니다.

흐름:

1. **관찰 신호 추출** — 업로드 이미지를 **OpenCLIP ViT-L/14** 로 임베딩(+ mediapipe 손/포즈 게이트).
2. **검색** — **Qdrant**(`reference_images_{env}`)에서 유사 참고 레퍼런스를 찾음.
3. **코칭** — 아래 "구조화된 코칭" 단계로 가이드를 구성.
4. **응답** — 참고 이미지(`/image`)·도식(`/guide-asset`)과 함께 구조화된 가이드를 반환. 노출/채택은 `adoption_log` 로 기록.

> 임베딩·벡터 백엔드는 챗 검색(embed + **Pinecone**)과 **분리**되어 있습니다 — guide 는 **OpenCLIP + Qdrant**(데이터 목적이 다르므로 분리). 절대 섞이지 않습니다.

### 어떻게 다른가 — 구조화된 코칭

guide 의 코칭은 **단순 LLM 생성이 아닙니다.** 다음 단계로 구조화되며, **LLM 은 "문장 배열"만** 담당하고 **분류·연습·도식·로드맵은 코드가 결정적으로(가드레일 뒤) 채웁니다** — 그래서 재현 가능하고, 도식/연습이 실제 자산과 항상 일치합니다.

| 단계 | 무엇을 | 근거(결정 주체) |
| --- | --- | --- |
| 1. 주제 분류 | 관찰 신호 → `sub_problem`(개선 축) | taxonomy `what_to_observe` (코드) |
| 2. 연습 매핑 | 축별 연습 과제 → `focus_practice` | taxonomy `practice_prompt` (코드) |
| 3. 도식 매핑 | 한 끗 포인트 도식 → `guide_asset` | 자산 매니페스트 (코드, 결정적) |
| 4. 성장 로드맵 | 다음 목표·반복 축·추세 → `next_steps` · `growth` | `practice_log` 집계 (코드) |
| 5. 노출/채택 기록 | 피드백 루프 → `adoption_log` | `POST /adopt` |

> 성장(`growth`)은 **측정=사실로만** 서술합니다(점수가 아님). LLM 이 배열한 자연 문장은 가드레일 검증을 통과한 뒤 `note` 로만 들어가고, 없으면 구조 필드로 폴백합니다.

### 스택

- FastAPI + uvicorn · OpenTelemetry 계측
- **OpenCLIP** (`ViT-L-14:openai`, 768-dim, 지연 로드) · PyTorch(CPU wheel)
- **mediapipe** — 손/포즈 게이트(`HAND_VLM`)
- **Qdrant** (`qdrant-client`) — 가이딩 참고 검색
- **MySQL `drawe_guide`** (SQLAlchemy + PyMySQL) — 성장/로그/피드백
- **S3** (boto3) — 참고 이미지·에셋 해소 및 presign
- **LLM** — Grok(코칭 문장, `XAI_API_KEY`) · Gemini(손 VLM, `GEMINI_API_KEY`, aistudio)
- Pillow + pillow-heif — 아이폰 HEIC/HEIF 업로드 정규화

### API (주요)

| 메서드 · 경로 | 설명 |
| --- | --- |
| `GET /health` | 헬스 체크(모델 워밍업 전이면 loading) |
| `POST /analyze` | 업로드 이미지에서 관찰 신호 추출(임베딩·게이트·참고 검색) |
| `POST /guide` | 가이드 생성(개선 포인트·연습·참고·도식·로드맵) |
| `POST /guide/stream` | 가이드 스트리밍 생성 |
| `POST /search` | 참고 레퍼런스 검색 |
| `GET /image/{ref_id}` | 참고 이미지 해소(reference_images → S3 presign) |
| `GET /guide-asset/{ref_id}` | 한 끗 포인트 도식(SVG/에셋) 해소 |
| `GET /svg/{ref_id}` | 도식 SVG |
| `POST /adopt` | 노출/채택/피드백 이벤트 기록(shown·liked·disliked 등) |
| `GET /roadmap` · `POST /practice` | 성장 로드맵 · 연습 |

### `POST /guide` 응답 예시

> 실제 응답 스키마(`GuideResponse`) 기준의 **예시**입니다. `ref_id`·수치·문장 값은 입력마다 달라지며, 구조(필드)는 동일합니다.

```json
{
  "guide_id": "g_01HX…",
  "primary_focus": "value_compression_distance",
  "degraded": false,
  "blocks": [
    {
      "sub_problem": "원경 명암 대비",
      "observation": "원경의 명암 대비가 근경과 비슷하게 강합니다",
      "effect": "공간 깊이가 평면처럼 읽힙니다",
      "direction": "멀어질수록 명암 폭을 좁혀 중간 톤으로 모으세요",
      "reference_ids": ["mountain_layers_fade", "value_compression_distance"],
      "confidence": 0.82,
      "guide_asset": {
        "ref_id": "value_compression_distance",
        "label": "도식",
        "caption": "거리에 따른 명암 압축"
      }
    }
  ],
  "one_thing": "원경은 명암을 한 단계 눌러 중간 톤으로",
  "synthesis": "구조(공간)부터 잡고 디테일로 넘어가면 정리가 빨라집니다",
  "next_steps": {
    "focus": "value_compression_distance",
    "focus_practice": "같은 풍경을 원경 명암만 3단계로 눌러 3번 그려보기",
    "next_goal": "near_mid_far_massing",
    "why": "공간이 자리잡은 뒤 디테일로 (구조 먼저)",
    "note": "지난 회차보다 원경 처리가 한결 차분해졌어요",
    "focus_asset": {
      "ref_id": "value_compression_distance",
      "label": "도식",
      "caption": "거리에 따른 명암 압축"
    }
  },
  "growth": {
    "narration": "최근 5회 중 명암 축이 3회 → 1회로 감소",
    "trend": [],
    "delta_note": "원경 명암을 의식적으로 누르기 시작"
  }
}
```

### 스키마 마이그레이션

guide DB(`drawe_guide`)는 평문 SQL 마이그레이션 러너로 관리됩니다(`schema/ddl.sql` + `schema/migrations/NNN_*.sql`).

```bash
# 컨테이너/터널 등 DB 가 닿는 환경에서, fastapi/ 디렉터리 기준
python -m guide.stores.migrate
```
- `schema_version` 추적 테이블 + `GET_LOCK` 으로 **순서·멱등·동시성** 보장.
- `GUIDE_AUTO_MIGRATE=1` 이면 서비스 기동 시 자동 적용(락으로 다중 태스크 안전).

### 의존 시스템

- **호출자**: backend (Spring Boot, `FASTAPI_GUIDE_URL`)
- **벡터 저장소**: Qdrant Cloud (`reference_images_{env}`)
- **DB**: MySQL `drawe_guide` (Spring 의 `drawe` 와 분리, 같은 RDS)
- **에셋**: S3 (참고 이미지·도식)

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
# 가상환경
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
# 필수 env: DB_DSN(mysql+pymysql://...drawe_guide) · QDRANT_URL · QDRANT_API_KEY ·
#           XAI_API_KEY(Grok) · (선택) GEMINI_API_KEY · S3_BUCKET 등
uvicorn guide.app:app --host 0.0.0.0 --port 8001
```

---

## 배포

- **타깃**: AWS EKS (Graviton ARM64) — 이미지는 **ARM64 빌드 필요**. 두 서비스 모두 ClusterIP(내부 전용, backend 가 호출).
- **embed**: `Dockerfile` → `fastapi-cd` (`fastapi/**` 변경 시) → ECR → overlay tag bump → **ArgoCD 롤아웃**.
- **guide**: `Dockerfile.guide` → `fastapi-guide-cd` (`fastapi/guide/**` · `fastapi/assets/**` · `Dockerfile.guide` · `requirements.guide.txt` 변경 시) → ECR → overlay tag bump → **ArgoCD 롤아웃**.
- guide 의 시크릿(DB_DSN · Qdrant · Grok · Gemini)은 SSM → **ESO(External Secrets)** 로 파드에 주입되며, dev 스토어 백필 절차는 [`infra/runbooks/phase3_dev_store_backfill.md`](../infra/runbooks/phase3_dev_store_backfill.md) 참고.
- 무중단: ArgoCD 롤링 업데이트 + readiness probe(guide 는 워밍업 전 `loading`). spot 노드 회수 시 SIGTERM→draining 으로 in-flight 마무리.
- 환경(dev/prod) 차이는 [`infra/README.md`](../infra/README.md) 참고.

## 관련 문서

- [루트 README](../README.md) — 전체 아키텍처
- [`backend/README.md`](../backend/README.md) — 호출자
- [`frontend/README.md`](../frontend/README.md) — 사용자 UI
- [`infra/README.md`](../infra/README.md) — 배포·환경·관측성