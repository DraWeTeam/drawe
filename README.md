# Drawe

> **AI 기반 드로잉 창작 지원 서비스** — 그리고 그 서비스를 구성하는 네 개의 축(backend · fastapi · frontend · infra)을 담은 모노레포.

---

## 🎯 배경 (왜 만들었나)

드로잉 학습자는 두 지점에서 창작 흐름이 끊깁니다.

1. **레퍼런스 탐색** — 참고 자료를 찾고 정리하느라 그리던 맥락을 놓칩니다.
2. **막힘** — 막상 그리다 막혔을 때 "무엇을 어떻게 고쳐야 하는지" 짚어주는 피드백을 받기 어렵습니다.

Drawe는 **레퍼런스 탐색을 CLIP 기반 검색과 LLM 추천으로 자동화**하고, 한발 더 나아가 사용자가 올린 그림에서
**관찰 가능한 시각 신호**(지평선·시점·명암·무게중심 등)를 바탕으로 개선 포인트를 코칭(이미지 가이드)함으로써,
창작 흐름을 유지하도록 돕는 서비스입니다.

> ⚠️ 이미지 가이드는 **그림의 "실력"을 점수로 평가하지 않습니다.** taxonomy 로 정의된 *관찰 가능한 신호*를 근거로
> "이 축을 이렇게 보면 더 좋아진다"는 **코칭과 연습 과제**를 제시합니다.

## 💡 해결 방식

Drawe 는 사용자의 텍스트를 **CLIP 임베딩**으로 벡터화하고, **Pinecone** 벡터 검색으로 의미가 비슷한 레퍼런스를 찾아 추천합니다. 여기에 **LLM**(Grok · Claude · Gemini) 기반 추천·대화를 결합해, 프로젝트 단위로 레퍼런스를 모으고 태깅·피드백하며 발전시킬 수 있습니다.

별도의 **이미지 가이드(한 끗 가이드)** 파이프라인은 그림에서 관찰 가능한 시각 신호를 추출하고, **OpenCLIP** 임베딩으로 **Qdrant** 참고 코퍼스에서 유사 레퍼런스를 찾아, LLM 코칭으로 **개선 포인트·연습 과제·참고 이미지·도식**을 함께 제시합니다.

> 이 레포는 원래 `drawe-backend` · `drawe-fastapi` · `drawe-frontend` · `drawe-deploy` 네 개의 폴리레포였던 것을 하나로 합친 모노레포입니다.

---

## 🎨 이미지 가이드 — 무엇이 나오나

> **입력**: 사용자가 올린 풍경 스케치 → **출력**: 한 끗 포인트 · 추천 연습 · 참고 이미지 · 도식이 담긴 가이드 카드

```text
┌ 가이드 카드 (구성 예시) ─────────────────────────────────┐
│ 한 끗 포인트   지평선을 화면 위/아래 1/3 지점에 두면        │
│               공간 깊이가 더 안정적으로 읽힙니다           │
│ 추천 연습     지평선 높이를 바꿔 같은 풍경을 3번 그려보기    │
│ 도식         [horizon_thirds — 지평선 1/3 배치 도식]     │
│ 참고 이미지    참고1   참고2   참고3                      │
└────────────────────────────────────────────────────────┘
```

### 파이프라인

```mermaid
flowchart LR
  IMG([사용자 그림 업로드]) --> EMB[OpenCLIP ViT-L/14<br/>768-dim 임베딩]
  EMB --> SIG[관찰 신호 추출<br/>taxonomy · what_to_observe<br/>+ mediapipe 손/포즈 게이트]
  SIG --> RET[Qdrant 유사 레퍼런스 검색<br/>reference_images_env]
  RET --> COACH[LLM 코칭 생성<br/>Grok]
  COACH --> OUT[한 끗 포인트 · 추천 연습<br/>참고 이미지 · 도식]
```

> 챗 레퍼런스 검색(embed + **Pinecone**)과 가이드 코퍼스(**Qdrant**)는 **분리**되어 섞이지 않습니다.

---

## ✨ 핵심 기능

- **AI 레퍼런스 검색** — CLIP 임베딩 + Pinecone 벡터 검색
- **이미지 가이드(한 끗 가이드)** — 관찰 신호 추출 → OpenCLIP + Qdrant 참고 검색 → LLM 코칭으로 개선 포인트·연습·참고 이미지·도식 제시

## 🗺 아키텍처

```mermaid
flowchart TD
  U([User]) -->|웹 UI 로드| CF[Cloudflare Pages<br/>frontend SPA · drawe.xyz]
  U -->|API 호출 · axios| CFP[Cloudflare<br/>api.drawe.xyz]
  CFP --> ALB[ALB]
  ALB --> BE

  subgraph ECS["AWS ECS · EC2 Graviton (ARM64)"]
    BE[Backend<br/>Spring Boot]
    FA[FastAPI · embed<br/>CLIP ViT-L/14]
    GA[FastAPI · guide<br/>OpenCLIP · 이미지 가이드]
  end

  BE --> DB[(MySQL · RDS)]
  BE --> RC[(Valkey / Redis)]
  BE -->|임베딩 요청| FA
  BE -->|이미지 가이드 요청| GA
  BE -->|벡터 검색| PC[(Pinecone)]
  BE -->|LLM 라우팅| LLM[Grok · Claude · Gemini]
  FA -->|768-dim 벡터| PC
  GA -->|가이딩 ref 검색| QD[(Qdrant)]
  GA --> GDB[(drawe_guide · RDS)]
  GA --> S3[(S3 · 참고 이미지/에셋)]
```

| 서비스 | 역할 | 핵심 스택 | 배포 | 문서 |
| --- | --- | --- | --- | --- |
| **frontend** | 사용자 웹 UI (SPA) | React 19 · Vite 8 · React Router 7 · axios | Cloudflare Pages | [↗](frontend/README.md) |
| **backend** | 핵심 API · 인증 · LLM 라우팅 · 도메인 로직 | Spring Boot 3.2.4 · Java 17 · JPA · MySQL · Valkey | AWS ECS (EC2, ARM64) | [↗](backend/README.md) |
| **fastapi · embed** | CLIP 임베딩 서버 (텍스트/이미지 → 벡터) | FastAPI · PyTorch · transformers CLIP | AWS ECS (EC2, ARM64) | [↗](fastapi/README.md) |
| **fastapi · guide** | 이미지 가이드 (관찰 신호 → 코칭·참고·도식) | FastAPI · OpenCLIP · Qdrant · MySQL(drawe_guide) · S3 · mediapipe | AWS ECS (EC2, ARM64) | [↗](fastapi/README.md) |
| **infra** | IaC · 배포 · 관측성 구성 | Terraform · ECS · ALB · RDS · Cloudflare | — | [↗](infra/README.md) |

> 각 서비스의 스택·도메인·API 등 **상세는 위 표의 하위 README** 를 참고하세요. 루트 문서는 전체 그림과 공통 운영 흐름만 다룹니다.

---

## 🚀 실행 방법

```bash
# 0. 클론
git clone https://github.com/DraWeTeam/drawe.git
cd drawe

# 1. 백엔드 스택(MySQL · Valkey · backend · fastapi · guide) 기동
cd infra
docker compose -f docker-compose.local.yml up -d

# 2. 프론트엔드 개발 서버
cd ../frontend
cp .env.example .env      # VITE_API_URL=http://localhost:8080
npm install && npm run dev      # http://localhost:5173
```

| 포트 | 서비스 |
| --- | --- |
| 3306 | MySQL |
| 6379 | Valkey |
| 8080 | Backend (Spring Boot) |
| 8000 | FastAPI · embed |
| 8001 | FastAPI · guide (이미지 가이드) |
| 5173 | Frontend (`npm run dev`) |

> 환경변수(LLM·OAuth·Pinecone·Qdrant 키 등)는 각 서비스의 `.env.example` 을 참고해 채워주세요.
> 레퍼런스/온보딩/가이드 시드 데이터가 필요하면 [`infra/README.md`](infra/README.md) 의 로컬 데이터 시드 및 스토어 백필 런북을 참고하세요.

---

## 📦 레포 구조

```text
drawe/
├── .github/workflows/   # 모노레포 CI/CD (경로 필터 기반)
├── backend/             # Spring Boot API 서버
├── fastapi/             # CLIP 임베딩(embed) + 이미지 가이드(guide) 서버
├── frontend/            # React + Vite SPA
└── infra/               # Terraform (dev/prod) + 관측성 config + 로컬 compose + 런북
```

> **모노레포 원칙** — `.git` 은 루트에 하나만 존재하고, 버전 관리 단위는 레포 전체(push 는 루트에서 한 번)입니다. **배포 단위는 워크플로의 경로 필터(`paths`)** 로 분리되므로, `frontend/` 만 바꾼 커밋은 backend/fastapi 배포를 발동시키지 않습니다.

---

## ⚙️ 인프라 · 운영 하이라이트

DevOps 관점에서 이 프로젝트의 핵심은 다음 셋입니다. (환경 비교·관측성·Terraform 실행법 등 **상세는 [`infra/README.md`](infra/README.md)**)

- **ECS on EC2 · Graviton(ARM64)** — backend·fastapi(embed·guide)를 ARM64 컨테이너로 ECS(EC2) 에서 운영. dev/prod 를 **별도 AWS 계정**으로 분리하고, dev 는 EventBridge 스케줄로 자동 on/off 해 비용을 최소화합니다.
- **GitHub OIDC 기반 CI/CD** — AWS 자격증명을 저장하지 않고 **OIDC 로 역할을 assume**. 경로 필터로 서비스별 배포를 분리하고, ECS Circuit Breaker 로 실패 시 자동 롤백합니다.
- **OpenTelemetry 관측성 (Alloy)** — daemon + sidecar 로 OTLP 를 수집해 환경별 destination(dev → Grafana Cloud / prod → AMP + self-host)으로 라우팅. 외부 전송 전 **PII redaction** 을 적용합니다.

| 워크플로 | 트리거 경로 | 동작 |
| --- | --- | --- |
| `backend-cd` | `backend/**` | JAR → Docker(ARM64) → ECR → ECS 배포 (Circuit Breaker 롤백) |
| `fastapi-cd` | `fastapi/**`(embed) | 이미지 빌드 → ECR → ECS 업데이트 |
| `fastapi-guide-cd` | `fastapi/guide/**` · `fastapi/assets/**` · `Dockerfile.guide` | guide 이미지(ARM64) 빌드 → ECR → ECS 업데이트 |
| `qdrant-keepalive` | (cron, 3일) | Qdrant Cloud 무료 클러스터 keep-alive 핑 |
| `*-ci` | 각 서비스 | 빌드/검증 (PR 기준) |

- **브랜치 → 환경**: `develop` → dev 자동 배포, `main` → prod 배포(Required reviewers 통과 후)
- **프론트엔드**: 별도 GitHub Actions CD 없음 — **Cloudflare Pages 가 push 를 감지해 빌드/배포**(`frontend-ci` 는 검증만)

---

## 🌿 브랜치 / 기여

- 기본 개발 브랜치는 `develop`, 배포 기준 브랜치는 `main` 입니다.
- 모노레포 전환 이후 **모든 작업은 `DraWeTeam/drawe` 한 곳**에서 진행합니다(옛 폴리레포는 아카이브 대상).
- 변경은 해당 서비스 디렉터리 안에서 이루어지며, 커밋·push 는 레포 루트에서 합니다.

---

## 📚 관련 문서

- [`backend/README.md`](backend/README.md) — 스택·도메인·API·실행
- [`fastapi/README.md`](fastapi/README.md) — 임베딩(embed)·이미지 가이드(guide) 엔드포인트·모델
- [`frontend/README.md`](frontend/README.md) — 실행·빌드·배포
- [`infra/README.md`](infra/README.md) — Terraform·환경·배포·관측성 상세 + 설계 의도