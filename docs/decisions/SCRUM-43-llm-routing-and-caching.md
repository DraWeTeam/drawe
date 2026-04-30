# SCRUM-43 — LLM 라우팅 및 Prompt Caching 결정사항

## 배경

LLM 그림 가이드 채팅 API에서 무료/유료 플랜에 따라 다른 LLM을 사용하기로 결정.
- 무료 플랜: Grok (xAI)
- 유료 플랜: Claude (Anthropic)

비용 효율을 위해 Claude 호출에 prompt caching을 적용한다.

## 결정사항

### 1. 모델 선정

| 플랜 | LLM | 모델 | 비고 |
|------|-----|------|------|
| FREE | Grok | `grok-2-vision-1212` | 비전 지원 |
| PAID | Claude | `claude-sonnet-4-6` | 비전 지원, 가성비 우선 |

**선정 근거**
- 두 플랜 모두 그림(이미지) 입력을 받으므로 비전 모델 필수
- Claude는 Haiku 4.5(저가) / Sonnet 4.6(중간) / Opus 4.7(고가) 중 가성비 관점에서 Sonnet 선택
  - Haiku: 그림 해석 품질이 떨어질 위험
  - Opus: Sonnet 대비 약 5배 비싸 그림 가이드 용도엔 과함

### 2. 플랜 모델링

`User` 엔티티에 enum 필드 직접 추가하는 단순한 방식 채택.

```java
@Enumerated(EnumType.STRING)
@Column(name = "plan", nullable = false, length = 20)
private UserPlan plan = UserPlan.FREE;
```

**선정 근거**
- 현재 결제·구독·만료일 같은 도메인이 아직 없어서 별도 `Subscription` 엔티티는 과한 설계
- enum 한 칸으로 시작 → 나중에 결제 시스템 붙일 때 자연스럽게 `Subscription` 테이블로 확장 가능
- boolean `isPaid`보다 enum이 미래 확장(ENTERPRISE 등) 시 마이그레이션 부담이 작음

**대안과 거절 사유**
- `Subscription` 엔티티 분리: 결제 도메인 미존재 시점에 과한 설계
- `boolean isPaid`: 플랜 종류 늘어나면 컬럼 자체를 바꿔야 함

### 3. Anthropic API 호출 방식

**RestClient로 직접 호출** (공식 Anthropic Java SDK 미사용).

**선정 근거**
- 기존 `GeminiService`, `GrokService`가 모두 `RestClient` + `Map<String, Object>` 패턴
- ClaudeService만 SDK를 쓰면 코드베이스가 두 갈래로 나뉘어 유지보수 부담 증가
- Messages API 호출 자체는 단순해서 SDK의 타입 안전성 이득이 크지 않음

**대안과 거절 사유**
- 공식 SDK (`com.anthropic:anthropic-java`): 빌더 패턴이 깔끔하지만 의존성 추가 + 코드 톤 분기 비용이 더 큼

### 4. Prompt Caching 적용

Claude 호출 시 system 프롬프트(페르소나)에 `cache_control: ephemeral` 적용.

```java
body.put("system", List.of(Map.of(
    "type", "text",
    "text", systemPrompt,
    "cache_control", Map.of("type", "ephemeral")
)));
```

**적용 근거**
- 페르소나(`PersonaRegistry`)는 모든 호출에서 동일하게 들어가는 고정 텍스트
- 5분 TTL의 ephemeral 캐시로도 활성 세션의 연속 호출은 거의 다 히트 → 입력 토큰 비용 최대 90% 절감
- Sonnet 4.6 캐싱 최소 요건(1024 tokens)을 페르소나가 충족하는지 확인 필요 — 미달 시 캐시 미발동, 다만 호출 자체는 정상 동작

**캐시 미적용 영역**
- `messages` 배열(히스토리 + 새 입력): 매 호출마다 길이가 변하고, 이미지가 매번 달라서 캐시 효율이 낮음
- 향후 히스토리가 길어지면 history 끝에도 cache_control breakpoint 추가 검토

**관측**
- `ClaudeService.logCacheUsage()`에서 응답의 `usage.cache_creation_input_tokens` / `cache_read_input_tokens` / `input_tokens`를 DEBUG 레벨로 로깅
- 캐시 히트율이 기대치에 못 미치면 페르소나 길이 또는 breakpoint 위치를 재조정

### 5. Provider 라우팅 로직

`ChatLlmService.resolveProvider(User user)`에서 `user.getPlan()` 기반으로 분기.

```java
private LlmProvider resolveProvider(User user) {
  return user.getPlan() == UserPlan.PAID ? LlmProvider.CLAUDE : LlmProvider.GROK;
}
```

**선정 근거**
- 기존엔 `llm.default-provider` 한 값으로 전역 분기 → 사용자별 플랜 라우팅 불가
- Gemini는 폴백/실험용으로 properties에는 남기되 라우팅에선 제외 (필요 시 재도입)

## 변경 파일 요약

| 파일 | 변경 내용 |
|------|-----------|
| `domain/enums/UserPlan.java` | 신규: FREE/PAID enum |
| `domain/User.java` | `plan` 필드 추가 (default FREE) |
| `domain/enums/LlmProvider.java` | `CLAUDE` 항목 추가 |
| `global/config/LlmProperties.java` | `claude` Provider 바인딩 추가 |
| `domain/llm/service/ClaudeService.java` | 신규: Anthropic Messages API + ephemeral 캐싱 |
| `domain/llm/service/ChatLlmService.java` | `resolveProvider`를 user.plan 기반으로 변경 |
| `application-llm.properties.example` | claude 섹션 템플릿 추가 |

## 후속 과제

- 결제·구독 시스템 도입 시 `User.plan` → `Subscription` 엔티티로 마이그레이션
- 기존 유저 plan 컬럼 백필 마이그레이션 (모두 FREE로 채움)
- Claude 캐시 히트율 모니터링 후 breakpoint 위치 튜닝
- Gemini 라우팅 재도입 여부 결정 (현재는 properties만 남김)
