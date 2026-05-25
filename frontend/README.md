# frontend

> Drawe 의 **사용자 웹 UI** — React + Vite 기반 SPA. 모노레포 `frontend/` 디렉터리에 위치합니다.

axios 로 backend API(`api.drawe.xyz`)를 호출하며, 배포는 GitHub Actions 가 아니라 **Cloudflare Pages 의 push 감지 자동 빌드**로 이루어집니다.

## 스택

- **React 19 · Vite 8 · React Router 7**
- **axios** (API 통신)
- **ESLint + Prettier**

## 실행 방법

```bash
cp .env.example .env      # VITE_API_URL=http://localhost:8080
npm install
npm run dev               # http://localhost:5173
```

> 로컬 backend 가 필요하면 [`infra`](../infra/README.md) 의 docker-compose 스택을 먼저 띄우세요(backend → `:8080`).

## 환경변수

| 변수 | 설명 | 로컬 값 |
| --- | --- | --- |
| `VITE_API_URL` | 백엔드 API 베이스 URL | `http://localhost:8080` |

그 외 키는 `.env.example` 참고.

## 빌드 (`build:cf`)

`build:cf` 스크립트가 **브랜치별 API 엔드포인트를 자동 선택**합니다.

| 브랜치 | API 엔드포인트 |
| --- | --- |
| `main` | `https://api.drawe.xyz` (prod) |
| 그 외 | `https://api-dev.drawe.xyz` (dev) |

```bash
npm run build:cf          # → dist/
```

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
- [`infra/README.md`](../infra/README.md) — 배포·환경