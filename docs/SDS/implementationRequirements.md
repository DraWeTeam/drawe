# 10. Implementation Requirements

## 10.1 기술 스택
| 영역 | 기술 |
|---|---|
| Frontend | React, Vite |
| Backend | Spring Boot 3.2, Java 17, Spring Data JPA, **QueryDSL**, Flyway, Resilience4j, Spring Security(OAuth2·JWT) |
| AI 서비스 | FastAPI(Python), CLIP(ViT-L/14), mediapipe, Gemini VLM |
| 데이터 | MySQL 8, Redis/Valkey, **Pinecone**(채팅 추천), **Qdrant**(가이드) |
| 인프라 | AWS ECS (EC2 Graviton), Cloudflare, ALB, GitHub Actions, OTEL(관측) |

## 10.2 외부 연동
| 연동 | 용도 | 격리/비고 |
|---|---|---|
| Gemini / Grok / Claude | COMPOSE·키워드·의도 분류 | provider 추상화, 교체 가능 |
| Bria | AI 이미지 생성 | 검색 결과 없을 때 |
| Pinecone / Qdrant | 벡터 검색 (채팅 추천 / 가이드) | Resilience4j 서킷브레이커 |
| fastapi-embed / guide | CLIP·비전 | 클러스터 내부 호출 |
| Google OAuth / GA4 / SMTP / S3 | 인증·분석·메일·스토리지 | |

## 10.3 설정 관리
- `application.properties`는 **전부 `${ENV}` placeholder** (배포 안전).
- 비밀 아닌 값(환경변수) + **SSM Parameter Store**(비밀).
- 로컬은 gitignore 프로필(`application-oauth/llm.properties`)이 placeholder를 덮음.
- **Live 전환**: 환경변수 `WORKFLOW_COMPOSE_LIVE_INTENTS`.

## 10.4 복원력 (Resilience4j)
- 외부 호출(embed·vector)에 **서킷브레이커 + 리트라이**. 검색 실패가 호출자 트랜잭션을 오염시키지 않도록 `REQUIRES_NEW`로 격리.
- 헬스: Flyway·DB·Redis를 readiness에 포함.

## 10.5 보안
- **JWT**(access/refresh) + **Google OAuth2**. OAuth state는 Redis 공유 세션(멀티 파드 대응).
- 비밀값은 **SSM Parameter Store / gitignore 프로필**. 추적 파일엔 placeholder만.
- 과거 커밋 노출분(jwt·pinecone)은 **키 재발급**으로 대응.

## 10.6 운영
- **배포**: GitHub Actions → ECR → ECS rolling deploy. dev → prod 순.
- **관측**: OTEL → Alloy, 내부 메트릭(검색 점수·환각 인용·세션 캐시 hit 등).