# 도메인 커스텀 계측 목록 (custom metrics catalog)

자동 계측(HTTP·DB·JVM/런타임) 위에 **비즈니스·AI 파이프라인 상태**를 보기 위해 심은 커스텀 지표 목록.
모두 `drawe.*`(Micrometer) / `drawe_*`(OTel) 네임스페이스로 export 되며, prod=**AMP**, dev=Grafana Cloud 로
흘러가 Grafana 에서 쿼리한다.

- **FastAPI(guide)** — OpenTelemetry. 지연이 중요한 축은 **전용 MeterProvider + 명시 버킷 히스토그램**.
- **Spring Boot(backend)** — Micrometer `Counter`/`Timer`(latency 축은 히스토그램 → `histogram_quantile`).

> 네이밍: 코드 상수는 `.`(`drawe.reference.search`), Prometheus/AMP export 시 `_`+단위 접미(`drawe_reference_search_seconds_*`).

> **현재 서비스 방향** — 제품이 ①**레퍼런스 무드보드**(저장분 검색 + AI 생성)와 ②**한 끗 가이드**(이미지 기반
> 가이딩)로 분리됨. 채팅은 "생성 결과(가이드·레퍼런스)를 담는 뷰"로 축소. 아래 지표를 **현재(Primary)** 와
> **레거시(대화형 채팅, 폐기 방향)** 로 구분한다.

---

## A. 현재 방향 (Primary)

### ① 한 끗 가이드 — FastAPI (OTel, `fastapi/guide`)

| instrument (export) | 라벨 | 버킷(초) | 의미 |
|---|---|---|---|
| `drawe_vlm_latency_seconds` | `model`, `outcome` | 0.5,1,2,3,5,8,13,21,34,60 | VLM(손·주제·스타일 관찰) 호출 지연. Gemini→Bedrock Claude 전환 효과 측정 근거 |
| `drawe_llm_latency_seconds` | `step`(plan/select/coach), `outcome`(success/error/fallback) | 0.5,1,2,3,5,8,13,21,34,55,90 | Grok 호출을 단계별로 계측 → 가이드 지연 지배 구간 규명 |

### ② 레퍼런스 무드보드 — 검색 + 생성

| instrument (export) | 위치 | 라벨 | 의미 |
|---|---|---|---|
| `drawe.reference.search` | Spring `SearchService` | `outcome`(success/error), `result`(hit/empty) | **무드보드 검색**(저장분, CLIP+Pinecone). `result=empty`=원하는 이미지 못 찾음 → 생성 트리거 지점 |
| `drawe_image_gen_latency_seconds` | FastAPI `guide/ml/generate`(`measure_image_gen`) | `provider`(bedrock 등), `outcome` | **레퍼런스 생성**(Bedrock Stability) 지연·성패. 가이드 ai_fallback 생성과 공유 |

> **핵심 퍼널**: `drawe_reference_search_seconds_count{result="empty"}` → `drawe_image_gen_latency_seconds_count`
> = "검색으로 못 찾아 생성으로 넘어간 비율". 현재 서비스 흐름(왼쪽 검색 실패 → 오른쪽 레퍼런스 생성)과 정합.

### FastAPI 구조화 trace 이벤트 (`trace(stage, **fields)`)

지연 히스토그램 외 파이프라인 분기점(샘플·튜닝 근거, 동작 불변):
`hand.detect` · `hand.vlm.gate/enter` · `face.vlm.gate` · `pose.vlm.gate` · `style` · `sketch` ·
`vlm.cache` · `mood.profile` · `growth.gate`(활동 주 수 분포) · `llm.in`/`llm.out`.

---

## B. 레거시 — 대화형 채팅 compose (폐기 방향, ⚠️ 코드상 아직 live)

> 예전 채팅은 "사용자 발화 → 의도분기 → 레퍼런스 추천 / 미술용어 설명"을 대화로 했다. **현재 제품 방향은
> 채팅에 생성 결과만 담는 것**이라 이 계측군은 **레거시(폐기 예정)**. 다만 prod overlay 가 아직
> `WORKFLOW_COMPOSE_LIVE_INTENTS`로 COMPOSE 를 켜둔 상태라 **코드상으론 여전히 값이 찍힌다** — 채팅 대화가
> 실제로 폐기될 때 이 지표와 `WORKFLOW_COMPOSE_LIVE_INTENTS`/compose 경로를 함께 정리한다.

| metric (code) | 타입 | 라벨 | 의미 |
|---|---|---|---|
| `drawe.chat_llm.latency` | Timer(hist) | `provider`, `outcome=success` | 채팅 LLM 응답 지연(P95/P99). export `drawe_chat_llm_latency_seconds_*` |
| `drawe.llm.call` | Timer | `provider`, `outcome` | LLM 호출 지연·성패 |
| `drawe.workflow.step` | Timer | `step`, `code`, `tier`, `outcome` | 워크플로 단계별(NEW_SEARCH/COMPOSE/…) |
| `drawe.workflow.shadow` | Counter | `outcome` | 워크플로 shadow(비교 측정) |
| `drawe.intent.route` | Counter | `outcome`(rule_hit/miss) | 규칙 라우팅 적중/미스 |
| `drawe.intent.rule` | Counter | `rule_id`, `action` | 어떤 규칙이 어떤 액션을 냈는지 |
| `drawe.intent.classify` | Timer | `outcome` | 의도 분류 지연·성패 |
| `drawe.output.structure_violation` | Counter | `provider`, `reason` | COMPOSE 응답 구조 위반(DoD ≤1%). 분모=`drawe.workflow.step{step=COMPOSE}` |
| `drawe.output.hallucinated_citation` | Counter | `source` | 환각 인용(없는 참조) 탐지 |
| `drawe.output.citation_removed` | Counter | — | 가드레일이 제거한 인용 수 |

---

## C. 지원 계측 (채팅 파이프라인 부속 — 채팅 폐기 시 동반 정리 대상)

| metric (code) | 타입 | 라벨 | 의미 |
|---|---|---|---|
| `drawe.dict.lookup` | Counter | `result`(hit/miss) | 키워드 사전 캐시 적중률(Komoran) |
| `drawe.komoran.fallback` | Counter | — | Komoran 미가용 폴백 |
| `drawe.komoran.extract` | Timer | — | 한국어 키워드 추출 지연 |
| `drawe.session.cache.hit`/`.miss`/`.restored`/`.save` | Counter | — | Redis 채팅 세션 캐시 |
| `drawe.tokens.input` | Counter | — | 입력 토큰 수(비용·트림 근거) |
| `drawe.history.trimmed` | Counter | — | 토큰 예산 초과 트림된 이력 수 |

---

## 활용

- **무드보드 검색 실패율** = `drawe_reference_search_seconds_count{result="empty"} / drawe_reference_search_seconds_count`
- **검색→생성 퍼널** = 위 empty count 대비 `drawe_image_gen_latency_seconds_count`
- **단계별 P95** = `histogram_quantile(0.95, sum(rate(drawe_llm_latency_seconds_bucket[5m])) by (le, step))`
- **비용 신호** = `drawe.tokens.input`·`drawe_llm_latency`·NAT NetworkOut 알람 조합

> 관련: 발표 인용 가능 수치 [`final-metrics-ledger.md`](final-metrics-ledger.md), 성장 지표 설계 [`growth-metric-design.md`](growth-metric-design.md).
