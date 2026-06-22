# 3. System Architecture

> ⚠️ **정식 아키텍처/배포 다이어그램은 인프라(클라우드) 팀 제공 예정.** 본 섹션은 구성요소·통신·배포를 설명하며, 다이어그램 자리는 아래에 둔다. (개념 그림은 [README](./README.md) 임시본 참고)

## 3.1 구성요소

| 구성요소 | 책임 |
|---|---|
| **Frontend** (React·Vite) | 채팅·프로젝트·갤러리·가이드 UI, OAuth 진입 |
| **Backend** (Spring Boot·Java 17) | 도메인 로직, AI 파이프라인 오케스트레이션, 인증, 데이터 접근 |
| **fastapi-embed** | CLIP 텍스트/이미지 임베딩 |
| **fastapi-guide** | 업로드 그림 비전 파이프라인(장면·포즈·진단·코칭, growth) |
| **MySQL** | 메타데이터(이미지·프로젝트·세션·메시지·가이드·로그) |
| **Redis / Valkey** | 단기메모리(멀티턴), OAuth state 공유 세션 |
| **Pinecone** | 채팅 레퍼런스 추천 벡터(768d) 검색 |
| **Qdrant** | 가이드 레퍼런스 이미지 벡터(취향 매칭, `reference_images`) |
| **외부** | LLM(Gemini·Grok·Claude), Bria(이미지 생성), Google OAuth, GA4, SMTP, S3 |

## 3.2 통신
- **Frontend → Backend**: REST(JSON), JWT 인증.
- **Backend → fastapi-embed/guide**: 클러스터 내부 서비스 호출(Service Connect/짧은 이름).
- **Backend → Pinecone/LLM/Bria**: 외부 HTTPS, **Resilience4j**(서킷브레이커·리트라이)로 격리.
- **Edge**: Cloudflare → ALB → Backend (X-Forwarded-Proto로 HTTPS 보존).

## 3.3 배포
- **EKS**(쿠버네티스) 기반, GitOps 매니페스트.
- 설정: `application.properties`(env-var) + **k8s ConfigMap**(비밀 아닌 값) + **Secret/ExternalSecret**(비밀).
- 로컬: gitignore 프로필(`application-oauth/llm.properties`)이 placeholder를 덮음.

## 3.4 아키텍처 다이어그램
> 📊 **[클라우드 팀 제공 — 컴포넌트 + 배포 토폴로지 다이어그램 삽입 예정]**

(데이터 흐름은 README의 "AI 추천 파이프라인" 및 [sequenceDiagram](./sequenceDiagram.md) 참고)
