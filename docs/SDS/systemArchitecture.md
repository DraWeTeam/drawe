# 2. System Architecture

![DraWe System Architecture](./img/systemArchitecture.png)

> 정식 아키텍처/배포 다이어그램(인프라 팀 제공). 아래는 구성요소·통신·배포·운영 설명.

## 2.1 구성요소

| 영역 | 구성요소 | 책임 |
|---|---|---|
| **Client / Edge** | Frontend(Cloudflare Pages), Proxy/Edge, ALB | UI 서빙, HTTPS·라우팅 |
| **Compute**<br/>(ECS on EC2, Graviton ARM64) | **Backend**(Spring Boot) | 도메인 로직, AI 파이프라인 오케스트레이션, 인증 |
| | **fastapi-embed** | CLIP 텍스트/이미지 임베딩 |
| | **fastapi-guide** | 업로드 그림 비전 진단·코칭(growth) |
| | alloy-daemon | OTEL 수집 사이드카 |
| **Data Stores** | **MySQL RDS** | 메인 메타(이미지·프로젝트·세션·메시지·로그) |
| | **drawe_guide RDS** | 가이드 전용 DB |
| | Redis(Valkey) | 단기메모리·세션 |
| | S3 | 이미지·업로드 스토리지 |
| **External** | **Pinecone** | 채팅 추천 벡터 검색 |
| | **Qdrant Cloud** | 가이드 레퍼런스 벡터 |
| | LLM Providers | Grok·Claude·Gemini |

## 2.2 통신
- **Client → Edge → Backend**: Cloudflare → ALB → Backend. REST(JSON) + JWT.
- **Backend → fastapi-embed/guide**: 컴퓨트 내부 호출.
- **Backend → Pinecone / LLM**, **fastapi-guide → Qdrant Cloud**: 외부 HTTPS. Resilience4j(서킷브레이커·리트라이)로 격리.

## 2.3 배포
- **AWS ECS on EC2 (Graviton ARM64)**.
- **CI/CD**: GitHub Actions → Amazon ECR → **ECS rolling deploy**.
- **IaC**: Terraform.
- **설정**: `application.properties`(env-var) ← **SSM Parameter Store**(비밀). 로컬은 gitignore 프로필이 덮음.

## 2.4 제어 / 운영 (Control Plane)
- **Secrets**: SSM Parameter Store.
- **Observability**: alloy-daemon → **Alloy → Grafana Cloud**(dev/prod), OTEL 메트릭·트레이스.
- **Alerts**: SNS → Lambda → **Discord** 알림.
