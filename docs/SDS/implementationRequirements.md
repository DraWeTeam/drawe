# 10. Implementation Requirements

## 10.1 기술 스택
| 영역 | 기술 |
|---|---|
| Frontend | React, Vite |
| Backend | Spring Boot 3.2, Java 17, Spring Data JPA, **QueryDSL**, Flyway, Resilience4j, Spring Security(OAuth2·JWT) |
| AI 서비스 | FastAPI(Python), CLIP(ViT-L/14), ViTPose(바디 포즈)·mediapipe(손), Bedrock Claude VLM(옵트인) |
| 데이터 | MySQL 8, Redis/Valkey, **Pinecone**(채팅 추천), **Qdrant**(가이드) |
| 인프라 | AWS EKS(EC2 Graviton arm64) · ArgoCD(GitOps) · Karpenter · IRSA · External Secrets, Cloudflare, ALB, GitHub Actions(CD), OTEL(관측) |

## 10.2 외부 연동
| 연동 | 용도 | 격리/비고 |
|---|---|---|
| Grok / Claude (Gemini=dev 폴백) | 키워드 추출 폴백(1차=Komoran, Grok=사전 미스율 초과 시 폴백) · COMPOSE·의도 워크플로는 **dormant**(설계만, 런타임=레거시 직접 합성) | provider 추상화, prod=Grok / PAID=Claude |
| Bedrock(Stability) | AI 이미지 생성 | 검색 결과 없을 때 |
| Pinecone / Qdrant | 벡터 검색 (채팅 추천 / 가이드) | Resilience4j 서킷브레이커 |
| fastapi-embed / guide | CLIP·비전 | 클러스터 내부 호출 |
| Google OAuth / GA4 / SMTP / S3 | 인증·분석·메일·스토리지 | |

## 10.3 설정 관리
- `application.properties`는 **전부 `${ENV}` placeholder** (배포 안전).
- 비밀 아닌 값(환경변수) + **SSM Parameter Store**(비밀).
- 로컬은 gitignore 프로필(`application-oauth/llm.properties`)이 placeholder를 덮음.
- **Live 전환**: 프로퍼티 `workflow.compose.live-intents`(기본 비어 있음=전부 레거시). Spring relaxed-binding 환경변수 형태는 하이픈을 제거한 `WORKFLOW_COMPOSE_LIVEINTENTS`.

## 10.4 복원력 (Resilience4j)
- 외부 호출(embed·vector)에 **서킷브레이커 + 리트라이**. 검색 실패가 호출자 트랜잭션을 오염시키지 않도록 `REQUIRES_NEW`로 격리.
- 헬스: Flyway·DB·Redis를 readiness에 포함.

## 10.5 보안
- **JWT**(access/refresh) + **Google OAuth2**. OAuth state는 **Spring Session(Valkey)** 공유 세션(멀티 replica 대응).
- 비밀값은 git에 두지 않음 — **SSM Parameter Store → External Secrets → K8s Secret**(키리스). 추적 파일엔 placeholder만.
- **IRSA**: 정적 액세스키 없이 SA 단위 최소권한(backend→S3 bria(구 bria, 현 Bedrock) · guide→S3 artref 개별 스코프).
- 인프라 보안: **HTTPS**(ACM·ssl-redirect 443), **RDS** private·암호화(`publicly_accessible=false`), **S3** Block Public Access, **SSH(22) 차단**(SSM Session Manager).
- 과거 커밋 노출분(jwt·pinecone)은 **키 재발급**으로 대응.

## 10.6 운영
- **배포(GitOps)**: GitHub Actions(arm64 빌드) → ECR → overlay SHA bump → **ArgoCD 자동 롤아웃**(EKS). 무중단(롤링 + PDB minAvailable 1 + readiness). dev(`develop`) → prod(`main`, Required reviewers).
- **오토스케일**: HPA(backend 2–6, fastapi 1–3 / CPU 70%) + **Karpenter** 노드(consolidation 1m, Spot).
- **관측**: OTEL → Alloy → **Grafana Cloud**(PII redaction), 내부 메트릭(검색 점수·환각 인용·세션 캐시 hit 등).