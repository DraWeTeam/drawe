# 10. Data Design

## 10.1 스토어 구성 (MySQL + Pinecone + Qdrant)
- **Pinecone** = **채팅 레퍼런스 추천** 벡터 검색(768d CLIP). 메타 일부만 보관(top-10 태그).
- **Qdrant** = **가이드** 레퍼런스 이미지 벡터(`reference_images` 컬렉션). fastapi-guide가 취향 매칭(medium·track payload boost)에 사용.
- **MySQL** = 이미지 **상세 메타·태그·관계**, 세션·메시지·로그 등 트랜잭션 데이터.
- **설계 근거**: 유사도 검색은 벡터 DB가, 풍부한 메타·조인은 RDB가 담당. 채팅(Pinecone)과 가이드(Qdrant)는 검색 목적·payload가 달라 분리.

## 10.2 주요 테이블 (MySQL)

| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `users` | id, email, … | OAuth 사용자 |
| `refresh_tokens` | token, user_id | JWT 갱신 |
| `projects` | id, user_id, name, subject, technique, mood, status, **pinned_image_ids(JSON)**, created_at, updated_at | 그림 작업 단위 |
| `project_references` | id, project_id, image_id, added_at | 프로젝트별 레퍼런스 |
| `images` | id, source(UNSPLASH/AI), source_id, url, embedding_id, raw_tags(JSON), prompt, **ai_description**, created_by_user_id, indexed_at, created_at | V13에 ai_description 추가 |
| `image_drawe_tags` | image_id, technique, subject, mood, utility(JSON), free_tags(JSON), tagged_by | GPT 태깅 결과 |
| `chat_sessions` | id, user_id, project_id, last_active | 대화 세션 |
| `llm_messages` | id, chat_session_id, role, content, provider, references_json(JSON), status, created_at | SYSTEM/USER/ASSISTANT |
| `guides` / `guide_feedback` | … | 가이드·피드백 |
| `analytics_events` | type, user_id, payload, trace_id | 분석 이벤트 |

## 10.3 Pinecone 스키마
- **Vector**: CLIP 768차원 (id = 이미지 source_id).
- **Metadata**: `image_source`, `ai_subject`, `ai_technique`, `ai_mood`, `ai_utility`, `ai_free_tags`, `unsplash_keywords`(top-10).
- 전체 태그·`ai_description`은 MySQL이 보관(검색 후 결합).

**Qdrant (가이드)**: `reference_images` 컬렉션 — CLIP 벡터 + payload(medium·track 등 취향 boost 신호). fastapi-guide 전용.

## 10.4 마이그레이션 (Flyway)
- `V1`(baseline) ~ `V13`. 주요: `V5`(이미지 AI 메타), `V12`(created_at), **`V13`(ai_description 컬럼)**.
- prod: `JPA_DDL_AUTO=validate` + Flyway가 실제 DDL. dev: `update`.

## 10.5 데이터 적재 / 백필
- 이미지·태그·벡터: 외부(Colab) 파이프라인 → MySQL/Pinecone 적재(24K+).
- **`ai_description`**: 외부 CSV → RDS **수동 백필 1회**(`source_id` 조인). 컬럼은 V13 자동 생성. 미적재 시 NULL → 태그 폴백(앱 안 깨짐).