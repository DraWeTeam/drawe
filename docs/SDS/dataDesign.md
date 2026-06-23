# 9. Data Design

## 9.1 스토어 구성

| 스토어 | 용도 |
|---|---|
| **MySQL (RDS)** | 메인 메타·관계·트랜잭션(이미지·프로젝트·세션·메시지·가이드·로그) + 업로드 원본 blob(`image_blobs`) |
| **Redis / Valkey** | 단기메모리(`session:{userId}:{projectId}`, TTL 24h) · 이메일 인증 코드(`email:verify:*`, TTL) · OAuth state |
| **S3** | 이미지·업로드 스토리지(`S3ImageStorage`, `@Profile s3`) — 기본 프로필은 MySQL blob 사용 |
| **Pinecone** | **채팅 레퍼런스 추천** 벡터 검색(768d CLIP). 메타 일부만 보관(top-10 태그) |
| **Qdrant** | **가이드** 레퍼런스 벡터(`reference_images`) — fastapi-guide가 취향 매칭(medium·track payload boost)에 사용 |
| **drawe_guide (RDS)** | 가이드 서비스(`fastapi-guide`) 전용 DB — 백엔드 MySQL과 분리 운영 |

- **설계 근거**: 유사도 검색은 벡터 DB가, 풍부한 메타·조인은 RDB가, 휘발성 단기상태는 Redis가, 바이너리는 S3가 담당. 채팅(Pinecone)과 가이드(Qdrant)는 검색 목적·payload가 달라 분리한다.

## 9.2 주요 테이블 (MySQL)

| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `users` | id, email, … | OAuth 사용자 |
| `refresh_tokens` | token, user_id | JWT 갱신 |
| `projects` | id, user_id, name, subject, technique, mood, status, **pinned_image_ids(JSON)**, created_at, updated_at | 그림 작업 단위 |
| `project_references` | id, project_id, image_id, added_at | 프로젝트별 레퍼런스 |
| `images` | id, source(UNSPLASH/AI), source_id, url, embedding_id, raw_tags(JSON), prompt, **ai_description**, created_by_user_id, indexed_at, created_at | 레퍼런스/AI 이미지 메타 |
| `image_blobs` | id, data(MEDIUMBLOB), mime_type, size_bytes, user_id | 업로드 원본(DB 저장 추상화) |
| `image_drawe_tags` | image_id, technique, subject, mood, utility(JSON), free_tags(JSON), tagged_by | GPT 태깅 결과 |
| `image_feedback` | id, user_id, image_id, feedback(LIKE/DISLIKE) | (user_id, image_id) UNIQUE |
| `chat_sessions` | id, user_id, project_id, last_active | 대화 세션 |
| `llm_messages` | id, chat_session_id, role, content, provider, references_json(JSON), status, created_at | SYSTEM/USER/ASSISTANT |
| `guides` / `guide_feedback` | request_id, guide_id, user_id, project_id, payload(JSON) / feedback | 가이드 이력·피드백 |
| `search_logs` | project_id, keyword, scores … | 검색 로그(프로젝트 삭제 시 cascade) |
| `prompt_translation_logs` | user_id, ko, en | KO→EN 생성 프롬프트 변환 로그 |
| `user_pref_tags` | user_id, tag | 온보딩 취향 태그 |
| `analytics_events` | type, user_id, payload, trace_id | 분석 이벤트 |

## 9.3 Pinecone 스키마
- **Vector**: CLIP 768차원 (id = 이미지 source_id).
- **Metadata**: `image_source`, `ai_subject`, `ai_technique`, `ai_mood`, `ai_utility`, `ai_free_tags`, `unsplash_keywords`(top-10).
- 전체 태그·`ai_description`은 MySQL이 보관(검색 후 결합).

**Qdrant (가이드)**: `reference_images` 컬렉션 — CLIP 벡터 + payload(medium·track 등 취향 boost 신호). fastapi-guide 전용.

## 9.4 스키마 관리
- **Flyway**가 기동 시 `db/migration/V*.sql`을 순서대로 적용. prod는 `JPA_DDL_AUTO=validate` + Flyway가 실제 DDL을 관리, dev는 `update`.

## 9.5 데이터 적재
- 이미지·태그·벡터: 외부(Colab) 파이프라인 → MySQL/Pinecone 적재(24K+). 가이드 레퍼런스는 Qdrant 적재.