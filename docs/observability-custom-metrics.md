# 도메인 커스텀 계측 목록 (custom metrics catalog)

자동 계측(HTTP·DB·JVM/런타임)만으로는 **비즈니스·AI 파이프라인의 상태**가 안 보인다. 그래서 자동 계측 위에
아래 커스텀 지표를 직접 심었다. 모두 `drawe.*`(Micrometer) / `drawe_*`(OTel) 네임스페이스로 export 되며,
prod 는 **AMP(Amazon Managed Prometheus)**, dev 는 Grafana Cloud 로 흘러가 Grafana 에서 쿼리한다.

- **FastAPI(guide)** — OpenTelemetry. 지연 분포가 중요한 축은 **전용 MeterProvider + 명시 버킷 히스토그램**으로
  심어 P50/P95/P99 를 의미있게 뽑는다(auto-instrumentation 의 기본 버킷은 LLM/VLM 지연대에 안 맞음).
- **Spring Boot(backend)** — Micrometer `Counter`/`Timer`. Timer 중 latency 축은 히스토그램으로 등록해
  `histogram_quantile` 로 P95/P99 산출.

> 네이밍: 코드 상수는 `.`(`drawe.llm.call`), Prometheus/AMP export 시 `_`+단위 접미(`drawe_llm_call_seconds_*`)로 변환된다.

---

## FastAPI 가이드 서비스 (OTel · `fastapi/guide/_metrics.py`, `_trace.py`)

### 지연 히스토그램 (전용 MeterProvider · 명시 버킷)

| instrument (export) | 라벨 | 버킷(초) | 의미 |
|---|---|---|---|
| `drawe_vlm_latency_seconds` | `model`, `outcome` | 0.5,1,2,3,5,8,13,21,34,60 | VLM(손·주제·스타일 관찰) 호출당 지연. Gemini→Bedrock Claude 전환 효과 측정의 근거 |
| `drawe_image_gen_latency_seconds` | `provider`, `outcome` | 1,2,3,5,8,13,21,34,55,90,120 | 이미지 생성(Bria/Gemini/Bedrock Stability) 호출당 지연 |
| `drawe_llm_latency_seconds` | `step`(plan/select/coach), `outcome`(success/error/fallback) | 0.5,1,2,3,5,8,13,21,34,55,90 | Grok 호출을 **단계별로** 계측 → "어느 호출이 가이드 지연을 지배하는가"를 데이터로 규명 |

- 관측 API: `observe_vlm(sec, model, outcome)` · `observe_image_gen(sec, provider, outcome)` · `observe_llm(sec, step, outcome)`.
- 계측 실패가 앱을 막지 않도록 fail-safe(예외 삼킴). 테스트는 `InMemoryMetricReader` 로 버킷·라벨 검증.

### 구조화 trace/log 이벤트 (`trace(stage, **fields)`)

지연 히스토그램 외에, 파이프라인 분기점을 구조화 이벤트로 남긴다(샘플·튜닝 근거, 동작 불변):
`hand.detect` · `hand.vlm.gate` · `hand.vlm.enter` · `face.vlm.gate` · `pose.vlm.gate` · `style` · `sketch` ·
`vlm.cache` · `mood.profile` · `growth.gate`(활동 주 수 분포) · `llm.in` / `llm.out`.

---

## Spring Boot 백엔드 (Micrometer · `domain/llm/**`)

### 지연 · LLM 호출

| metric (code) | 타입 | 라벨 | 의미 |
|---|---|---|---|
| `drawe.chat_llm.latency` | Timer(histogram) | `provider`, `outcome=success` | 채팅 LLM(Grok/Claude) 응답 지연. export `drawe_chat_llm_latency_seconds_*` → Grafana P95/P99. 성공만 기록(실패 payload 엔 latency 없음, 카디널리티 절약) |
| `drawe.llm.call` | Timer | `provider`, `outcome` | LLM 호출 지연·성패 |
| `drawe.workflow.step` | Timer | `step`, `code`(intent), `tier`, `outcome` | 워크플로 단계별 지연·성패(NEW_SEARCH/COMPOSE/…) |
| `drawe.intent.classify` | Timer | `outcome` | 의도 분류 지연·성패 |
| `drawe.komoran.extract` | Timer | — | 한국어 키워드 추출(Komoran) 지연 |

### 라우팅 · 의도 분기

| metric (code) | 타입 | 라벨 | 의미 |
|---|---|---|---|
| `drawe.intent.route` | Counter | `outcome`(rule_hit/rule_miss) | 규칙 기반 라우팅 적중/미스 |
| `drawe.intent.rule` | Counter | `rule_id`, `action` | 어떤 규칙이 어떤 액션을 냈는지 |
| `drawe.workflow.shadow` | Counter | `outcome` | 워크플로 shadow(비교 측정) 결과 |

### 출력 안전 (환각·구조 위반)

| metric (code) | 타입 | 라벨 | 의미 |
|---|---|---|---|
| `drawe.output.structure_violation` | Counter | `provider`, `reason` | COMPOSE 응답 구조 위반(DoD ≤1%). 분모=`drawe.workflow.step{step=COMPOSE}` |
| `drawe.output.hallucinated_citation` | Counter | `source` | 환각 인용(존재하지 않는 참조) 탐지 수 |
| `drawe.output.citation_removed` | Counter | — | 가드레일이 제거한 인용 수 |

### 캐시 · 토큰 · 세션

| metric (code) | 타입 | 라벨 | 의미 |
|---|---|---|---|
| `drawe.dict.lookup` | Counter | `result`(hit/miss) | 키워드 사전 캐시 적중률 |
| `drawe.komoran.fallback` | Counter | — | Komoran 미가용 시 폴백 발생 |
| `drawe.session.cache.hit` / `.miss` / `.restored` / `.save` | Counter | — | Redis 세션 캐시 적중/복원/저장 |
| `drawe.tokens.input` | Counter | — | 입력 토큰 수(비용·트림 근거) |
| `drawe.history.trimmed` | Counter | — | 토큰 예산 초과로 트림된 이력 수 |

---

## 활용

- **P95/P99 latency** — `histogram_quantile(0.95, sum(rate(drawe_llm_latency_seconds_bucket[5m])) by (le, step))` 식으로 단계별 병목 관찰.
- **품질·안전 지표** — 구조 위반율 = `drawe_output_structure_violation_total / drawe_workflow_step_total{step="COMPOSE"}`, 환각 인용 추세 등을 릴리스 게이트/대시보드에 사용.
- **비용 신호** — `drawe.tokens.input`·`drawe_llm_latency`·NAT NetworkOut 알람을 조합해 LLM 비용 폭주를 조기 감지.

> 관련: 발표 인용 가능 수치는 [`final-metrics-ledger.md`](final-metrics-ledger.md), 성장 지표 설계는 [`growth-metric-design.md`](growth-metric-design.md).
