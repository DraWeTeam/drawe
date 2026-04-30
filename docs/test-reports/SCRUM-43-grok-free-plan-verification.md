# SCRUM-43 — 무료 플랜(Grok) 동작 검증 결과

**테스트 일시:** 2026-04-30 02:11 KST
**대상 브랜치:** `feature/SCRUM-43-LLM-TEST`
**테스트 방식:** 실제 HTTP 호출 1회 (토큰 절약). 나머지는 정적/상태 검증.

## 테스트 환경

| 항목 | 값 |
|------|-----|
| 앱 포트 | 8081 |
| 테스트 user | id=1, email=alice@example.com, plan=FREE |
| 테스트 project | id=1, name=test-project-grok |
| 모델 | `grok-4-fast-non-reasoning` (xAI, 비전 지원) |

## 검증 항목

### 1. plan 기반 라우팅 (FREE → GROK)

| 구분 | 내용 |
|------|------|
| **기대값** | user.plan=FREE인 경우 `LlmProvider.GROK` 선택 |
| **결과값** | `llm_messages.provider` 컬럼에 `GROK` 저장됨 |
| **차이** | 없음. 라우팅 정상 |

### 2. 페르소나 시스템 메시지 저장

| 구분 | 내용 |
|------|------|
| **기대값** | 새 ChatSession 생성 시 `PersonaRegistry.FRIENDLY_01` 시스템 메시지가 `llm_messages`에 저장 |
| **결과값** | role=SYSTEM, content에 페르소나 텍스트(약 800자) 저장 확인 |
| **차이** | 없음. 단, 저장 과정에서 기존 버그 발견 → fix함 (아래 "발견된 이슈" 참조) |

### 3. Grok API 호출 및 응답

요청:
```json
POST /projects/1/chat
Authorization: Bearer <jwt>
{ "message": "hi" }
```

응답 (HTTP 200, 0.63초):
```json
{
  "success": true,
  "data": {
    "sessionId": "eadab762-dde3-4111-9157-995f7b3a1676",
    "type": "guide",
    "message": "안녕! 오늘 뭐 그려볼까요? 😊",
    "references": [],
    "followUp": null
  }
}
```

| 구분 | 내용 |
|------|------|
| **기대값** | 200 OK, 페르소나(친근한 친구) 톤의 한국어 응답, 세션 ID 발급, GROK provider로 저장 |
| **결과값** | 200 OK, "안녕! 오늘 뭐 그려볼까요? 😊" — 페르소나 톤 반영(부드러운 존댓말, 이모지 1개), 세션 ID 정상 발급 |
| **차이** | 없음 |

### 4. 메시지 영속화

DB 확인 (`llm_messages` 테이블, session_id=`eadab762-...`):

| id | role | provider | model | latency_ms | status |
|----|------|----------|-------|------------|--------|
| 10 | SYSTEM | NULL | NULL | NULL | NULL |
| 11 | USER | NULL | NULL | NULL | NULL |
| 12 | ASSISTANT | **GROK** | **grok-4-fast-non-reasoning** | **572** | **SUCCESS** |

| 구분 | 내용 |
|------|------|
| **기대값** | SYSTEM/USER/ASSISTANT 3개 row 저장, ASSISTANT는 provider/model/latency/status 채워짐 |
| **결과값** | 동일 |
| **차이** | 없음 |

## 발견된 이슈 (테스트 중 fix)

### A. xAI 모델명 변경 (외부 요인)
- **증상**: 초기 호출에서 `400 Bad Request: Model not found: grok-2-vision-1212`
- **원인**: xAI 측에서 `grok-2-vision-1212` 모델 라인업 폐기. `grok-4-fast-*` 등 새 모델로 교체된 상태
- **조치**: `application-llm.properties`와 `.example`을 `grok-4-fast-non-reasoning`으로 갱신
- **참고**: `GET https://api.x.ai/v1/models`로 사용 가능 모델 list 조회 가능

### B. `llm_messages.content` 컬럼 사이즈 부족 (기존 코드 버그, SCRUM-43 범위 내)
- **증상**: 세션 생성 시 `Data truncation: Data too long for column 'content' at row 1`
- **원인**: `LlmMessage.content`가 `@Lob` + `String`이었는데, MySQL Hibernate 매핑이 처음 생성 시 `tinytext`(255 byte)로 만들어진 것. 페르소나 텍스트 800자(UTF-8 기준 1.5KB+) 저장 불가
- **조치**:
  1. 엔티티에 `@Column(columnDefinition = "TEXT")` 명시 (`error_message`도 동일하게 처리)
  2. DB 컬럼 ALTER: `MODIFY COLUMN content TEXT NOT NULL`, `MODIFY COLUMN error_message TEXT`
- **재발 방지**: `@Lob` 대신 명시적 `columnDefinition` 사용

## 토큰 사용량

- **Grok API 호출 횟수**: 1회 (성공한 호출만)
- 이전 실패는 모두 400(모델명) / 503(DB) 등 호출 자체 거부 또는 도달 전 단계라 **추론 토큰 발생 없음**

## 결론

무료 플랜 Grok 라우팅 및 채팅 흐름이 의도대로 동작함을 확인. 발견된 두 이슈는 모두 fix 완료.

**다음 단계**:
- 유료 플랜(Claude) 검증 — `User.plan` 값을 `PAID`로 임시 변경 후 동일 테스트, 캐시 사용량(`cache_creation_input_tokens` / `cache_read_input_tokens`) 로그 확인
- 비전 입력 검증 — `imageUrl` 필드 채워서 멀티모달 호출 동작 확인
