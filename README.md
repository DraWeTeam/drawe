# Drawe

> **AI 기반 드로잉 창작 지원 서비스** — 그리고 그 서비스를 구성하는 네 개의 축(backend · fastapi · frontend · infra)을 담은 모노레포.

---

## 🎯 배경 (왜 만들었나)

드로잉 학습자는 레퍼런스를 찾고 정리하는 과정에서
창작 흐름이 자주 끊깁니다.

Drawe는 이 과정을 CLIP 기반 검색과 LLM 추천으로 자동화하여
창작 흐름을 유지하도록 돕는 서비스입니다.

## 💡 해결 방식

Drawe 는 사용자의 텍스트/이미지를 **CLIP 임베딩**으로 벡터화하고, **Pinecone** 벡터 검색으로 의미가 비슷한 레퍼런스를 찾아 추천합니다. 여기에 **LLM**(Grok · Claude · Gemini) 기반 추천·대화를 결합해, 프로젝트 단위로 레퍼런스를 모으고 태깅·피드백하며 발전시킬 수 있습니다. → **레퍼런스 탐색을 자동화해 창작자가 흐름을 유지**하도록 하는 것이 목표입니다.

> 이 레포는 원래 `drawe-backend` · `drawe-fastapi` · `drawe-frontend` · `drawe-deploy` 네 개의 폴리레포였던 것을, **git subtree 로 커밋 히스토리·기여자 그래프를 보존한 채** 하나로 합친 모노레포입니다.
>
> **상태**: 활발히 개발 중인 팀 프로젝트입니다.

## ✨ 핵심 기능

- **AI 레퍼런스 검색** — CLIP 임베딩 + Pinecone 벡터 검색
- **프로젝트 기반 관리** — 레퍼런스 수집·태깅·피드백
- **LLM 추천/대화** — Grok · Claude · Gemini 라우팅

---

## 🗺 아키텍처

```mermaid
flowchart TD
  U([User]) -->|웹 UI 로드| CF[Cloudflare Pages<br/>frontend SPA · drawe.xyz]
  U -->|API 호출 · axios| CFP[Cloudflare<br/>api.drawe.xyz]
  CFP --> ALB[ALB]
  ALB --> ECS

  subgraph ECS["AWS ECS · EC2 Graviton (ARM64)"]
    BE[Backend<br/>Spring Boot]
    FA[FastAPI<br/>CLIP ViT-L/14]
  end

  BE --> DB[(MySQL · RDS)]
  BE --> RC[(Valkey / Redis)]
  BE -->|임베딩 요청| FA
  BE -->|벡터 검색| PC[(Pinecone)]
  BE -->|LLM 라우팅| LLM[Grok · Claude · Gemini]
  FA -->|768-dim 벡터| PC
```

| 서비스 | 역할 | 핵심 스택 | 배포 | 문서 |
| --- | --- | --- | --- | --- |
| **frontend** | 사용자 웹 UI (SPA) | React 19 · Vite 8 · React Router 7 · axios | Cloudflare Pages | [↗](frontend/README.md) |
| **backend** | 핵심 API · 인증 · LLM 라우팅 · 도메인 로직 | Spring Boot 3.2.4 · Java 17 · JPA · MySQL · Valkey | AWS ECS (EC2, ARM64) | [↗](backend/README.md) |
| **fastapi** | CLIP 임베딩 서버 (텍스트/이미지 → 벡터) | FastAPI · uvicorn · PyTorch · transformers | AWS ECS (EC2, ARM64) | [↗](fastapi/README.md) |
| **infra** | IaC · 배포 · 관측성 구성 | Terraform · ECS · ALB · RDS · Cloudflare | — | [↗](infra/README.md) |

> 각 서비스의 스택·도메인·API 등 **상세는 위 표의 하위 README** 를 참고하세요. 루트 문서는 전체 그림과 공통 운영 흐름만 다룹니다.

---

## 🚀 실행 방법

```bash
# 0. 클론
git clone https://github.com/DraWeTeam/drawe.git
cd drawe

# 1. 백엔드 스택(MySQL · Valkey · backend · fastapi) 기동
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
| 8000 | FastAPI |
| 5173 | Frontend (`npm run dev`) |

> 환경변수(LLM·OAuth·Pinecone 키 등)는 각 서비스의 `.env.example` 을 참고해 채워주세요.
> 레퍼런스/온보딩 시드 데이터가 필요하면 [`infra/README.md`](infra/README.md) 의 로컬 데이터 시드 참고.

---

## 📦 레포 구조

```text
drawe/
├── .github/workflows/   # 모노레포 CI/CD (경로 필터 기반)
├── backend/             # Spring Boot API 서버
├── fastapi/             # CLIP 임베딩 서버
├── frontend/            # React + Vite SPA
└── infra/               # Terraform (dev/prod) + 관측성 config + 로컬 compose
```

> **모노레포 원칙** — `.git` 은 루트에 하나만 존재하고, 버전 관리 단위는 레포 전체(push 는 루트에서 한 번)입니다. **배포 단위는 워크플로의 경로 필터(`paths`)** 로 분리되므로, `frontend/` 만 바꾼 커밋은 backend/fastapi 배포를 발동시키지 않습니다.

---

## ⚙️ 인프라 · 운영 하이라이트

DevOps 관점에서 이 프로젝트의 핵심은 다음 셋입니다. (환경 비교·관측성·Terraform 실행법 등 **상세는 [`infra/README.md`](infra/README.md)**)

- **ECS on EC2 · Graviton(ARM64)** — backend·fastapi 를 ARM64 컨테이너로 ECS(EC2) 에서 운영. dev/prod 를 **별도 AWS 계정**으로 분리하고, dev 는 EventBridge 스케줄로 자동 on/off 해 비용을 최소화합니다.
- **GitHub OIDC 기반 CI/CD** — AWS 자격증명을 저장하지 않고 **OIDC 로 역할을 assume**. 경로 필터로 서비스별 배포를 분리하고, ECS Circuit Breaker 로 실패 시 자동 롤백합니다.
- **OpenTelemetry 관측성 (Alloy)** — daemon + sidecar 로 OTLP 를 수집해 환경별 destination(dev → Grafana Cloud / prod → AMP + self-host)으로 라우팅. 외부 전송 전 **PII redaction** 을 적용합니다.

| 워크플로 | 트리거 경로 | 동작 |
| --- | --- | --- |
| `backend-cd` | `backend/**` | JAR → Docker(ARM64) → ECR → ECS 배포 (Circuit Breaker 롤백) |
| `fastapi-cd` | `fastapi/**` | 이미지 빌드 → ECR → ECS 업데이트 |
| `*-ci` | 각 서비스 | 빌드/검증 (PR 기준) |

- **브랜치 → 환경**: `develop` → dev 자동 배포, `main` → prod 배포(Required reviewers 통과 후)
- **프론트엔드**: 별도 GitHub Actions CD 없음 — **Cloudflare Pages 가 push 를 감지해 빌드/배포**(`frontend-ci` 는 검증만)

---

## 🌿 브랜치 / 기여

- 기본 개발 브랜치는 `develop`, 배포 기준 브랜치는 `main` 입니다.
- 모노레포 전환 이후 **모든 작업은 `DraWeTeam/drawe` 한 곳**에서 진행합니다(옛 폴리레포는 아카이브 대상).
- 변경은 해당 서비스 디렉터리 안에서 이루어지며, 커밋·push 는 레포 루트에서 합니다.

> **마이그레이션 상태**: 모노레포 통합·CI/CD 재배선·dev 배포 검증은 완료. 프론트 도메인(`drawe.xyz`) 및 prod 컷오버는 베타 종료 시점에 진행 예정입니다.

---

## 📚 관련 문서

- [`backend/README.md`](backend/README.md) — 스택·도메인·API·실행
- [`fastapi/README.md`](fastapi/README.md) — 임베딩 엔드포인트·모델
- [`frontend/README.md`](frontend/README.md) — 실행·빌드·배포
- [`infra/README.md`](infra/README.md) — Terraform·환경·배포·관측성 상세 + 설계 의도