# Grok 프롬프트 캐시 & history trim 최적화 (전/후 기록)

> 상태: Done(1차) · 작성일 2026-06-29 · 트랙: 토큰 비용 최적화
> 한 줄: **멀티턴 챗봇의 입력 토큰 비용을, Grok prefix 캐시 적중률을 끌어올려 절감**한다. ① `x-grok-conv-id` 라우팅 배선 ② history trim 을 SLIDING→CHUNK 으로 바꿔 캐시가 깨지지 않게 + 계측(통제된 재현 벤치마크).

---

## 1. 배경 (피드백 → 문제 정의)

- 심사/팀 피드백: **토큰 비용을 직접 설계·계측**해 보라. 멀티턴이 길어질수록 비용이 커진다.
- 구조 확인 결과 비용 폭탄(무제한 history 재전송, O(n²))은 **이미 `TokenAwareHistoryTrimmer` 의 토큰예산 trim 으로 막혀 있었다**(턴당 입력 상한 고정 = O(n)).
- 남은 레버는 **prompt 캐싱**. 그런데 두 가지 문제 발견:
  1. **기본 경로가 Grok**(FREE = Grok, PAID = Claude). Claude 만 `cache_control` 이 있었고, Grok 캐싱은 라우팅 힌트(`x-grok-conv-id`)가 없어 멀티턴에서 캐시 미스.
  2. **현재 trim 방식(SLIDING)이 매 턴 prefix 를 흔들어 캐시를 깬다** — trim 과 캐싱이 상충.

---

## 2. 한 일 (코드 변경)

| 파일 | 변경 |
|---|---|
| `LlmCallContext` | `conversationId` 필드 추가(기존 4·5-arg 생성자 호환 유지) |
| `ComposeExecutor` | COMPOSE 호출에 `ctx.sessionId()` 를 conversationId 로 전달 |
| `GrokService` | conversationId 있으면 `x-grok-conv-id` 헤더 부착 + `TOKENCOST` usage 로그(cached_tokens 포함) |
| `ClaudeService` | 동일 `TOKENCOST` 포맷 로그(cache_read/creation) |
| `TokenAwareHistoryTrimmer` | history trim 을 **SLIDING(매 턴 tail-trim) → CHUNK(ceil 격자 스냅)** 으로 교체 |
| `application.properties` | (로컬 전용, 커밋 금지) `ClaudeService=DEBUG` 로깅 1줄 — 계측용 |

> 분류·번역 같은 짧은 콜(KeywordExtractor/PromptTranslator)은 conv-id 의도적으로 제외 — 세션 무관 공통 프롬프트라 세션별 conv-id 가 오히려 공용 캐시를 쪼갬.

---

## 3. 계측 방법

- 대시보드(타 담당)는 건드리지 않고 **로그 기반**으로 본인 선에서 측정.
- 격리 벤치마크 `GrokCacheBenchmarkTest`: MySQL·Redis·fastapi·로그인 없이 `GrokService.generate` 만 직접 호출. 키는 `application-llm.properties` 에서 자동 로드(없으면 skip → CI 안전).
- 지표: `usage.prompt_tokens_details.cached_tokens`(캐시 적중) + **`cost_in_usd_ticks`(xAI 가 캐시 할인까지 반영한 실청구액)**.

---

## 4. 결과

### 4.1 conv-id 도입 후 turn별 (append-only 누적)

| turn | prompt | cached | 적중률 | completion | xAI 실비용(ticks) |
|---|---|---|---|---|---|
| 1 (cold) | 362 | 64 | 17.7% | 148 | 7,553,000 |
| 2 (warm) | 541 | 320 | 59.1% | 147 | 7,077,500 |
| 3 (warm) | 714 | 512 | 71.7% | 134 | 6,899,000 |

- **캐싱 작동(적중률 상승)**: cached 64→320→512, 적중률 18%→59%→72%.
- **입력이 362→714로 ~2배 늘어도 턴당 실비용은 7.55M→6.90M 로 감소** — 늘어난 입력을 캐시가 흡수.
- ⚠️ **단, 이 표로 "conv-id 덕분"이라 단정 금지** — 후속 OFF 베이스라인(§4.3)에서 conv-id OFF 도 비슷한 적중률이 나왔다. "캐싱이 작동한다"는 보이지만 **그 기여가 conv-id 인지**는 이 마이크로벤치로 분리 못 한다.

### 4.2 trim 전략 비교 — cached 토큰 추이

| turn | APPEND(앞고정) | SLIDING(기존) | CHUNK(제안) |
|---|---|---|---|
| 1 (cold) | 64 | 64 | 64 |
| 2 | 320 | 320 | 320 |
| 3 | 448 | **320** | 448 |
| 4 | 640 | **320** | 320 |
| 5 | 704 | **320** | 448 |
| 6 | 832 | **320** | 320 |

- 입력 토큰: APPEND 362→956(무한 증가), SLIDING ~470(고정), CHUNK 478~580(상한 고정).
- **SLIDING 은 cached 가 SYSTEM floor(320)에 정체** — 매 턴 윈도우가 밀려 대화 prefix 가 깨지니 대화 부분은 한 토큰도 재사용 못 함. **trim 이 캐시를 깬다는 직접 증거.**
- **APPEND** 는 cached 64→832 누적이지만 입력 무한증가(O(n²) 폭탄) → 실전 불가.
- **CHUNK** 는 입력은 상한으로 묶으면서 cached 가 floor(320)를 넘어 448로 회복 — SLIDING 이 버린 캐시를 되찾음. (벤치의 high=4/low=2 가 공격적이라 448↔320 진동. 토큰예산 기반 실구현은 상한이 커서 더 오래 유지.)
- ⚠️ **단일 run 노이즈 주의**: 위 표는 한 run 값. 재실행하면 절대 수치와 SLIDING↔CHUNK 순위는 흔들린다(다른 run 에선 CHUNK turn6 cached=64 콜드 미스로 평균이 SLIDING 보다 낮게 나오기도 함). **재현되는 robust 신호는 "SLIDING=floor(320) 고착 / APPEND·CHUNK=floor 초과 가능"이라는 구조적 차이뿐.** 절대 적중률을 "X%→Y%"로 박지 말 것.

> ⚠️ **비용 해석 주의**: `cost_in_usd_ticks` 총비용은 completion 토큰이 매 호출 랜덤(LLM 비결정성)이라 노이즈가 큼(출력 단가가 입력의 2.5배). **깨끗한 지표는 cached_tokens**. 비용 정밀 비교는 다회 평균/​completion 고정 필요. 면접·보고엔 cached/적중률을 메인, cost 는 보조로.

### 4.3 ⚠️ 벤치 한계 — conv-id OFF vs ON 은 이 벤치로 입증 불가

"OFF→ON" 을 명시하려 conv-id OFF(헤더 없음) 베이스라인을 같은 시나리오로 측정했더니, **OFF 가 ON 보다 오히려 약간 높게** 나왔다:

| 시나리오 | 적중률(cached/prompt 합) |
|---|---|
| NO_CONVID(append) = **OFF** | **75.0%** (3136/4182) |
| APPEND(conv-id ON) | **71.8%** (2880/4009) |

**원인(벤치 confound)**:
- 모든 시나리오가 **바이트 동일한 콘텐츠**(같은 SYSTEM + 같은 USER_TURNS)를 보냄 → xAI 가 conv-id 무관하게 그 공통 prefix 를 **전역 캐시**. 게다가 OFF 가 먼저 실행되며 캐시를 **데워** 뒤 시나리오들이 그 온기를 받음(SLIDING turn1 이 이미 cached=320).
- conv-id 의 실제 가치는 **멀티테넌트 fleet 에서 세션 고유 prefix 를 같은 서버로 보내는 라우팅 신뢰성** — 단일 콘텐츠 로컬 테스트로는 fleet 라우팅을 재현 못 함.

**결론**: conv-id 델타는 이 마이크로벤치로 증명 불가. 정당성은 ① xAI 공식 문서("헤더 없으면 다른 서버로 라우팅돼 캐시 미스") ② 프로덕션 `TOKENCOST` 세션별 로그로 확인한다. conv-id 추가 자체는 무해·저비용이라 유지가 맞음.

**깨끗한 재측정 조건**: 시나리오별 고유 콘텐츠(워밍 오염 제거) + 다회 평균. conv-id 는 본질상 멀티세션/멀티서버라야 차이가 나므로 결국 프로덕션 로그가 정답.

---

## 5. 전략 비교 & 결정

| 방식 | 입력 bound | 캐시 | 장기맥락 | 추가비용 | 적합도(우리) |
|---|---|---|---|---|---|
| APPEND | ❌ 무한 | ✅ 최고 | ✅ | 0 | ❌ 비용폭탄 |
| SLIDING(기존) | ✅ | ❌ floor 정체 | ❌ | 0 | △ 캐시 버림 |
| **CHUNK** | ✅ | △ 회복 | ❌ | **0** | ✅ **1순위(채택)** |
| 요약 메모리 | ✅ | △(동결 시) | ✅ | LLM콜 | △ 과함 |
| 하이브리드 | ✅ | ✅(동결 시) | ✅ | LLM콜+복잡도 | ◎ 나중에 필요 시 |

**핵심 직관**: 캐시는 "앞(prefix)이 안 바뀌어야" 적중. SLIDING 은 매 턴 시작점을 1칸씩 밀어 계속 깸. CHUNK 은 가끔 한 번 크게 자르고 한동안 안 건드려 그 구간 내내 캐시를 살림.

**CHUNK vs 하이브리드**: 둘 다 입력 bound + 캐시 친화지만 — CHUNK 은 오래된 턴을 *버리고*, 하이브리드는 *요약 보존*. 하이브리드도 요약을 매 턴 다시 만들면 prefix 가 또 깨지므로 **결국 "요약 동결 + 가끔 갱신"(=CHUNK 규율)** 이 필요 → CHUNK 은 하이브리드의 디딤돌.

**CHUNK 을 먼저 택한 근거(의사결정)**:
- 직전 레퍼런스는 Redis `previousReferences` 가 보존 → 멀티턴이 옛 chat 텍스트에 의존 안 함.
- persona·선호·프로젝트는 동결 SYSTEM 으로 항상 유지 → 맥락 핵심 불변.
- 미술 코칭 도메인상 아주 옛 턴 정밀 회상 필요 드묾.
- 추가 LLM 콜 0 + 기존 trimmer 소폭 수정 = ROI 최고.
- → 맥락 손실 신호가 실제로 보이면 하이브리드로 단계 승급.

---

## 6. 구현 — CHUNK (`TokenAwareHistoryTrimmer.trimHistoryChunked`)

이 빈은 **stateless**(매 턴 DB 전체를 새로 받음)라, 컷을 입력만으로 **결정적**으로 계산해야 연속 턴에서 같은 prefix 가 나온다.

1. **sliding 컷** `slidingFrom` = 최근부터 역순으로 예산(historyBudget)에 드는 가장 오래된 인덱스.
2. **격자 올림(ceil)**: `keepFrom = ceil(slidingFrom / HISTORY_CHUNK_TURNS) * HISTORY_CHUNK_TURNS`.
   - `keepFrom ≥ slidingFrom` → 유지 토큰 **항상 예산 이하**(하드 캡 준수).
   - 컷이 **격자(6턴) 단위로만 점프** → 청크 사이 여러 턴 동안 "유지 시작점(맨 앞 턴)" 고정 → prefix 안정 → 캐시 적중.
3. 엣지(최근 한 턴조차 예산 초과 / 올림이 최근 턴까지 버림)는 빈 리스트 또는 정확한 sliding 컷으로 폴백.

- `HISTORY_CHUNK_TURNS = 6` 은 **캐시안정 ↔ 맥락granularity 다이얼**: 작게=손실↓·캐시깨짐↑, 크게=캐시안정↑·점프당 손실↑.
- 짧은 대화(예산 미달)는 무영향 — slidingFrom=0 → keepFrom=0 → 전부 유지(APPEND 동일). 청크는 예산 초과 시에만 발동.
- 트레이드오프: SLIDING 대비 trim 경계에서 가장 오래된 턴 최대 ~6개 더 버림 + 점프 직후 recent window 일시 축소(톱니). 최근 1~2턴은 항상 유지.

---

## 7. 테스트

- `GrokCacheBenchmarkTest` — 실 API 격리 벤치(키 없으면 skip). 위 4.1/4.2 결과 산출.
- `TokenAwareHistoryTrimmerTest#chunkTrimKeepsPrefixStable` — 회귀 가드. 대화를 한 턴씩 늘리며:
  - **예산 준수**: 유지된 비-SYSTEM 토큰 ≤ historyBudget (매 스텝).
  - **캐시 안정 불변식**: 시작점이 고정된 스텝에선 직전 유지 리스트가 현재의 prefix(앞 고정 + 뒤에만 추가).
  - **청크 점프**: 트리밍이 충분히 일어나도 시작점은 매 스텝이 아니라 청크 단위로만 바뀜(`frontChanges ≤ activeSteps/3`) — 슬라이딩(거의 매 스텝 변경)과 구분.
- 기존 trimmer 테스트 전부 통과(초기 floor 버그 → ceil 로 수정).

---

## 8. 운영/커밋 메모

- 커밋 대상: `TokenAwareHistoryTrimmer`, `LlmCallContext`, `ComposeExecutor`, `GrokService`, `ClaudeService`, 두 테스트.
- **커밋 금지**: `application.properties` 의 DEBUG 로깅 줄(로컬 시크릿 파일).
- 커밋 전 `spotlessApply`.

## 9. 남은 일 / 다음 단계

- ~~conv-id OFF 베이스라인 측정~~ → 완료(§4.3). 결과: 마이크로벤치로는 OFF≈ON(증명 불가). conv-id 효과는 프로덕션 세션별 `TOKENCOST` 로그로 검증 필요.
- (선택) 벤치 개선 — 시나리오별 고유 콘텐츠 + 다회 평균으로 SLIDING↔CHUNK 를 노이즈 없이 재현.
- (선택) `HISTORY_CHUNK_TURNS` / historyBudget 튜닝 — 실제 적중률·맥락 만족도 보며.
- (선택) Claude(PAID) 경로: SYSTEM(≈1200) < 최소 캐시 prefix(Opus 4096) 라 캐시 no-op 가능성 — history breakpoint 또는 SYSTEM 예산 조정 필요(소수 PAID 경로라 후순위).
- (나중) 맥락 손실 신호 시 하이브리드(요약 동결) 승급.
