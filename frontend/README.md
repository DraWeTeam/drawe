# frontend

> Drawe 의 **사용자 웹 UI** — React + Vite 기반 SPA. 모노레포 `frontend/` 디렉터리에 위치합니다.

axios 로 backend API(`api.drawe.xyz`)를 호출하며, 배포는 GitHub Actions 가 아니라 **Cloudflare Pages 의 push 감지 자동 빌드**로 이루어집니다.

## 스택

- **React 19 · Vite 8 · React Router 7**
- **axios** (API 통신)
- **ESLint + Prettier**

## 화면 구조

```text
src/pages/
├── login/         # Google 로그인
├── onboarding/    # 취향 태그 온보딩
├── projects/      # 프로젝트 목록·관리
└── chat/          # 프로젝트 작업 공간 (레퍼런스 검색 + 이미지 가이드)
```

작업의 중심은 `chat/` 입니다.

- **레퍼런스 검색** — `ReferenceGrid` · `ReferencePage` : 검색어/이미지로 유사 레퍼런스 그리드 탐색(backend → Pinecone).
- **이미지 가이드(한 끗 가이드)** — `GuideForm`(그림 업로드) → `GuideModal`(생성된 가이드 카드: 한 끗 포인트·추천 연습·참고 이미지·도식 표시, 👍/👎 피드백·새로고침) → `guidePdf.js`(가이드를 PDF 로 내보내기).
- 보조: `AttachmentPicker` · `AuthedImage`(인증 필요한 이미지 로드) · `TutorialCoachmark`(첫 사용 안내) · `api.js`(API 클라이언트) · `imageUtils.js`.

## 실행 방법

```bash
cp .env.example .env      # VITE_API_URL=http://localhost:8080
npm install
npm run dev               # http://localhost:5173
```

> 로컬 backend 가 필요하면 [`infra`](../infra/README.md) 의 docker-compose 스택을 먼저 띄우세요(backend → `:8080`).

## 환경변수

| 변수           | 설명                  | 로컬 값                 |
| -------------- | --------------------- | ----------------------- |
| `VITE_API_URL` | 백엔드 API 베이스 URL | `http://localhost:8080` |

그 외 키는 `.env.example` 참고. 참고 이미지/도식은 backend 가 내려주는 URL(가이드 서비스의 public URL)로 로드합니다.

## 빌드 (`build:cf`)

`build:cf` 스크립트가 **브랜치별 API 엔드포인트를 자동 선택**합니다(`CF_PAGES_BRANCH` 기준).

| 브랜치 | API 엔드포인트                    |
| ------ | --------------------------------- |
| `main` | `https://api.drawe.xyz` (prod)    |
| 그 외  | `https://api-dev.drawe.xyz` (dev) |

```bash
npm run build:cf          # → dist/
```

| 스크립트 | 동작 |
| --- | --- |
| `dev` | 개발 서버(Vite) |
| `build` / `build:cf` | 프로덕션 빌드 / 브랜치별 API 자동선택 빌드 |
| `lint` · `format` · `format:check` | ESLint · Prettier |
| `preview` | 빌드 결과 미리보기 |

## 배포 (Cloudflare Pages)

- 별도 GitHub Actions CD 가 **없습니다**.
- **Cloudflare Pages 가 레포 push 를 감지**해 `frontend` 를 빌드/배포합니다.
  - Root directory: `frontend`
  - Build command: `npm run build:cf`
  - Output directory: `dist`
- CI(`frontend-ci`)는 빌드/린트 **검증만** 담당합니다.

## 관련 문서

- [루트 README](../README.md) — 전체 아키텍처
- [`backend/README.md`](../backend/README.md) — API 서버
- [`fastapi/README.md`](../fastapi/README.md) — 임베딩·이미지 가이드 서버
- [`infra/README.md`](../infra/README.md) — 배포·환경