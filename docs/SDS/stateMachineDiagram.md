# 9. State Machine Diagram

## 9.1 워크플로 라우팅 (의도 → Step)
의도(`IntentCode`)에 따라 실행 단계(`StepType`) 경로가 결정된다. (live 경로 `IntentRouting.ROUTING` 기준)

```mermaid
stateDiagram-v2
    [*] --> 의도분류
    의도분류 --> EXTRACT_KEYWORDS : NEW_SEARCH
    의도분류 --> COMPOSE : KEEP·SKIP·FOLLOWUP·COMPARE<br/>COMPOSITION·LIGHTING·COLOR·TECHNIQUE·OUT_OF_DOMAIN
    의도분류 --> CRITIQUE_UPLOAD : SELF_CRITIQUE
    의도분류 --> TRANSLATE : GENERATE
    EXTRACT_KEYWORDS --> SEARCH
    SEARCH --> COMPOSE
    CRITIQUE_UPLOAD --> COMPOSE
    TRANSLATE --> GENERATE_IMAGE
    COMPOSE --> [*] : 응답(레퍼런스 + 조언)
    GENERATE_IMAGE --> [*] : 생성 이미지
```

| 의도 | Step 경로 |
|---|---|
| NEW_SEARCH | EXTRACT_KEYWORDS → SEARCH → COMPOSE |
| KEEP·SKIP·FOLLOWUP·COMPARE·COMPOSITION·LIGHTING·COLOR·TECHNIQUE·OUT_OF_DOMAIN | COMPOSE |
| SELF_CRITIQUE | CRITIQUE_UPLOAD → COMPOSE |
| GENERATE | TRANSLATE → GENERATE_IMAGE |

> live 의도는 **COMPOSE로 끝나는 것만 허용**(부팅 검증) → GENERATE는 legacy 전용.

## 9.2 대화 세션 (멀티턴)
```mermaid
stateDiagram-v2
    [*] --> 생성 : 첫 메시지(페르소나·맥락 주입)
    생성 --> 활성
    활성 --> 활성 : NEW_SEARCH(새 검색) / KEEP(직전 레퍼런스 재사용)
    활성 --> 초기화 : 대화 초기화(DB 메시지 + Redis 단기메모리 삭제)
    초기화 --> 활성 : 새 메시지
    활성 --> 만료 : Redis TTL 24h 경과
    만료 --> 활성 : MySQL 직전 ASSISTANT references 로 복원
```
- **단기메모리**(Redis)는 KEEP 멀티턴의 진입점. cache miss 시 MySQL로 복원.
- **초기화**는 DB·Redis를 모두 비워야 이전 맥락이 완전히 사라진다.

## 9.3 프로젝트 상태
```mermaid
stateDiagram-v2
    [*] --> IN_PROGRESS : 생성
    IN_PROGRESS --> COMPLETED : 완료 처리(상태 변경)
    COMPLETED --> IN_PROGRESS : 재작업
    IN_PROGRESS --> [*] : 삭제
    COMPLETED --> [*] : 삭제
```
- `ProjectStatus` = `IN_PROGRESS` · `COMPLETED`. 수정 API로 상태 전환, 삭제 시 연관 데이터(세션·메시지·레퍼런스·로그) 정리.