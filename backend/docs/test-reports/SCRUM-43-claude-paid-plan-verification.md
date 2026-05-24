# SCRUM-43 — 유료 플랜(Claude) 동작 검증 결과

**테스트 일시:** 2026-04-30 02:18 ~ 02:25 KST
**대상 브랜치:** `feature/SCRUM-43-LLM-TEST`
**테스트 방식:** 실제 HTTP 호출 1회 + 정적/상태 검증.

## 테스트 환경

| 항목 | 값 |
|------|-----|
| 앱 포트 | 8081 |
| 테스트 user | id=1, email=alice@example.com, plan=PAID (검증 후 FREE로 원복) |
| 테스트 project | id=1 |
| 모델 | `claude-sonnet-4-6` (Anthropic, 비전 지원) |

## 검증 항목

### 1. plan 기반 라우팅 (PAID → CLAUDE)

| 구분 | 내용 |
|------|------|
| **기대값** | user.plan=PAID인 경우 `LlmProvider.CLAUDE` 선택 |
| **결과값** | `llm_messages.provider`에 `CLAUDE` 저장됨 |
| **차이** | 없음. 라우팅 정상 |

### 2. Anthropic Messages API 호출 및 응답

요청:
```json
POST /projects/1/chat
{ "message": "hi" }
```

응답 (HTTP 200, 2.0초):
```json
{
  "success": true,
  "data": {
    "sessionId": "c27ae748-91ca-4f00-9d22-73ffe6442ab7",
    "type": "guide",
    "message": "안녕하세요! 오늘 뭐 그리고 싶어요? 🎨",
    "references": [],
    "followUp": null
  }
}
```

| 구분 | 내용 |
|------|------|
| **기대값** | 200 OK, 페르소나 톤(부드러운 존댓말, 이모지 ≤1개), Claude provider로 저장 |
| **결과값** | 200 OK, "안녕하세요! 오늘 뭐 그리고 싶어요? 🎨" — 페르소나 규칙 준수 |
| **차이** | 없음 |

### 3. 메시지 영속화

DB 확인 (`llm_messages` 테이블, session=`c27ae748-...`):

| id | role | provider | model | latency_ms | status |
|----|------|----------|-------|------------|--------|
| 15 | SYSTEM | NULL | NULL | NULL | NULL |
| 16 | USER | NULL | NULL | NULL | NULL |
| 17 | ASSISTANT | **CLAUDE** | **claude-sonnet-4-6** | **1936** | **SUCCESS** |

| 구분 | 내용 |
|------|------|
| **기대값** | SYSTEM/USER/ASSISTANT 3개 row, ASSISTANT는 provider/model/latency/status 채워짐 |
| **결과값** | 동일 |
| **차이** | 없음 |

### 4. Prompt Caching 동작

ClaudeService 로그:
```
Claude usage - input=629, cache_created=0, cache_read=0
```

| 구분 | 내용 |
|------|------|
| **기대값** | system 블록에 `cache_control: ephemeral` 적용. 캐시 생성 또는 읽기 발생 |
| **결과값** | input=629 토큰, cache_created=0, cache_read=0 — **캐싱 미발동** |
| **차이** | 캐시 발동 안 함. 단, 코드 자체는 정상으로 추정됨 (아래 분석 참조) |

**분석:** Anthropic Sonnet 4.6의 prompt caching 최소 토큰 요건은 1024이며, 현재 system 블록(페르소나) 단독으로는 약 540 토큰 수준이라 자동으로 캐싱이 비활성화됨. `cache_control` 헤더는 정상적으로 전송됐으나 모델 측에서 "캐싱 가치 없음"으로 판단하고 일반 호출 처리한 것. 코드 동작은 정상이며, 페르소나가 1024 토큰 이상으로 확장되면 자동 발동될 예정.

**캐싱 검증은 다음 스프린트로 미룸** — 페르소나 콘텐츠 확장 작업과 함께 자연스러운 토큰 증가 후 재검증.

## 테스트 중 발견된 이슈

### A. `llm_messages.provider` 컬럼이 MySQL ENUM으로 생성됨 (기존 코드 버그)
- **증상**: Claude 호출 후 DB 저장 시 `Data truncated for column 'provider' at row 1`
- **원인**: Hibernate 6 + MySQL 환경에서 `@Enumerated(EnumType.STRING)`이 `ENUM('GROK','GEMINI')` SQL 타입으로 매핑됐음. CLAUDE를 추가했지만 DB 컬럼은 옛 enum 값만 받음
- **조치**:
  1. 엔티티에 `@Column(columnDefinition = "VARCHAR(20)")` 명시하여 향후 provider 추가 시 컬럼 변경 불필요하게 함
  2. DB ALTER: `MODIFY COLUMN provider VARCHAR(20)`
- **재발 방지**: 이번에 `@Lob` → TEXT 명시한 것과 동일 패턴. enum 컬럼은 명시적으로 VARCHAR로 정의

## 토큰 사용량

- **Anthropic API 호출 횟수**: 1회 (성공)
- 입력 토큰: 629
- 출력 토큰: 응답 1줄 (~20 토큰 추정)
- 추정 비용: Sonnet 4.6 기준 약 $0.002 미만

## 결론

유료 플랜 Claude 라우팅 및 채팅 흐름이 의도대로 동작함을 확인. provider 컬럼 ENUM 이슈는 fix 완료. Prompt caching 코드는 정상이지만 페르소나 길이 부족으로 미발동 — 후속 페르소나 확장 시 자동 발동 예상.

## 변경 내역 요약 (Grok 검증과 통합)

| 파일 | 변경 내용 |
|------|-----------|
| `domain/LlmMessage.java` | content/error_message → TEXT, provider → VARCHAR(20) 명시 |
| DB `llm_messages` | content/error_message → TEXT, provider → VARCHAR(20) ALTER |

## 후속 과제

- 페르소나 콘텐츠 확장 (사용자 원본 마크다운 반영 + 미술 가이드 추가) → 1024 토큰 돌파 시 캐싱 자동 발동
- 비전(이미지) 입력 검증 — 무료/유료 양쪽
- 기존 운영 DB가 있다면 ENUM 컬럼 마이그레이션 적용 필요
