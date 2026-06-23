# 11. Glossary (용어 정의)

## 도메인 용어
| 용어 | 정의 |
|---|---|
| **레퍼런스(Reference)** | 사용자에게 추천되는 참고 이미지. 채팅 응답에서 `[N]`으로 인용된다. |
| **핀(Pin)** | 사용자가 보드에 고정한 레퍼런스(프로젝트당 최대 3). 채팅에서 "고정 N번"으로 지칭. |
| **프로젝트(Project)** | 한 그림 작업 단위. 주제·기법·분위기·핀 목록을 가진다. |
| **가이드(Guide)** | 사용자가 업로드한 그림을 비전으로 진단·코칭한 결과. |
| **완성작 갤러리** | 사용자가 생성한 AI 이미지 모음. |
| **레퍼런스 아카이브** | 프로젝트별로 모은 레퍼런스 이미지 모음. |
| **성장(growth)** | 가이드 사용 이력 기반 사용자 진척 데이터(축별 약점 등). user_id 단위. |

## AI / 기술 용어
| 용어 | 정의 |
|---|---|
| **CLIP** | 이미지·텍스트를 같은 벡터 공간으로 임베딩하는 모델(ViT-L/14, 768차원). |
| **임베딩(Embedding)** | 텍스트/이미지를 벡터로 변환. fastapi-embed가 수행. |
| **Pinecone** | 벡터 유사도 검색 DB(**채팅 추천**). 이미지 벡터 + 메타. |
| **Qdrant** | 벡터 검색 DB(**가이드**). 레퍼런스 이미지 벡터 + 취향 payload(medium·track). |
| **의도(Intent)** | 사용자 발화의 분류. `IntentCode`: NEW_SEARCH·KEEP·SKIP·COMPOSITION·LIGHTING·COLOR·TECHNIQUE·FOLLOWUP·COMPARE·OUT_OF_DOMAIN·SELF_CRITIQUE·GENERATE. |
| **키워드 추출** | 한국어 요청 → 검색용 영문 키워드. Komoran 형태소 + 미술 사전 + LLM 폴백. |
| **Komoran** | 한국어 형태소 분석기. |
| **미술 사용자 사전(ArtTerms)** | 미술 용어 KO→EN 매핑 사전(247개). 복합어 보존·도메인 정확도. |
| **IDF re-rank** | CLIP 점수에 태그 IDF 가중 overlap을 더해 재정렬하는 하이브리드 방식. |
| **ai_description** | 이미지의 실제 내용을 묘사하는 캡션(Unsplash 네이티브 AI alt-text). LLM 설명 근거. |
| **할루시네이션** | LLM이 근거 없는 디테일을 지어내는 현상(예: 없는 꽃 묘사). |
| **COMPOSE** | 페르소나·레퍼런스 컨텍스트로 최종 응답을 생성하는 LLM 합성 단계. |
| **무결성 검증** | 응답의 `[N]` 인용이 실제 레퍼런스 범위인지 검사해 환각 인용 제거. |
| **StepExecutor / 워크플로** | live 경로의 단계 실행기(EXTRACT_KEYWORDS·SEARCH·COMPOSE 등). |
| **단기메모리** | Redis에 보관하는 직전 턴 레퍼런스(멀티턴 KEEP용). |
| **점수 가드** | 검색 점수(avg/max)가 낮으면 무관 결과로 보고 차단. |
| **legacy / live** | legacy=직접 합성, live=StepExecutor 워크플로. 의도별 게이트로 전환. |

## 인프라 용어
| 용어 | 정의 |
|---|---|
| **EKS** | AWS 관리형 Kubernetes(EC2 Graviton arm64). ROUND 2 배포 플랫폼(ECS에서 마이그레이션). |
| **GitOps / ArgoCD** | git을 단일 진실원으로 매니페스트 변경을 자동 동기화·롤아웃하는 배포 모델. |
| **Karpenter** | 노드 오토스케일러 — 부하 시 빠른 프로비저닝, 유휴 시 consolidation. |
| **IRSA** | IAM Roles for Service Accounts — 정적 키 없이 SA 단위 최소권한(OIDC). |
| **External Secrets(ESO)** | SSM Parameter Store 시크릿을 K8s Secret으로 동기화(시크릿 git 미보관). |
| **Flyway** | DB 스키마 마이그레이션(V1–V13). |
| **QueryDSL** | 타입 안전 동적 쿼리(프로젝트 정렬·검색). |
| **Resilience4j** | 서킷브레이커·리트라이(외부 호출 복원력). |
| **JWT / OAuth** | 토큰 기반 인증 / Google 소셜 로그인. |