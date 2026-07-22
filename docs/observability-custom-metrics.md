# 도메인 커스텀 계측 목록 (custom metrics catalog)

자동 계측(HTTP·DB·JVM/런타임) 위에 **비즈니스·AI 파이프라인 상태**를 보기 위해 심은 커스텀 지표 목록.

- **FastAPI(guide)** — OpenTelemetry. instrument 이름이 곧 export 이름(`drawe_*`), 단위 `s`.
  지연 축은 **히스토그램마다 전용 `MeterProvider` + View 로 명시 버킷**을 준다
  (배포된 OTel(api 1.27/1.29)의 `create_histogram` 에 `explicit_bucket_boundaries_advisory`
  인자가 없어 View 가 필요한데, 전역 provider 는 생성 후 View 주입이 안 되기 때문 — `guide/_metrics.py:10-16`).
- **Spring Boot(backend)** — Micrometer. 코드 상수는 `.`(`drawe.reference.search`),
  Prometheus export 시 `_`+단위 접미(`drawe_reference_search_seconds_*`).
  `micrometer-registry-prometheus` → `/actuator/prometheus` 로 노출.
- **공통 태그** — Spring 메트릭 전부에 `application=drawe-backend`,
  `environment=${SPRING_PROFILES_ACTIVE}` 가 붙는다(`application.properties:136-137`).
  대시보드 쿼리가 실제로 `application="drawe-backend"` 로 필터하므로 쿼리 작성 시 필요하다.
- **fastapi-embed 에는 커스텀 계측이 없다** — OTel 관련 코드는 로그에 trace context 를
  싣는 `LoggingInstrumentor` 뿐이다(`fastapi/main.py:5,11,12`).

저장은 prod=**AMP**, dev=Grafana Cloud. 단 **대시보드는 prod 오버레이 전용**이고
dev 에 코드로 배포되는 경로는 저장소에 없다(`overlays/dev/observability/` 에 대시보드 없음).

> ### ⚠️ 히스토그램은 Spring 20개 중 2개뿐
>
> `publishPercentileHistogram()` 을 붙인 건 **`drawe.chat_llm.latency` 와
> `drawe.reference.search` 둘뿐**이고, `management.metrics.distribution.*` 설정도 없다.
> 즉 **나머지 Timer 전부(`llm.call`·`workflow.step`·`intent.classify`·`komoran.extract`)는
> `_bucket` 시리즈가 없어 `histogram_quantile` 을 쓸 수 없다** — `_sum/_count` 평균만 가능하다.
> 기존 알림 룰이 평균식을 쓰는 이유가 이것이다. FastAPI 쪽 3종은 반대로 전부 명시 버킷이 있다.

> **현재 서비스 방향** — 제품이 ①**레퍼런스 무드보드**(저장분 검색 + AI 생성)와 ②**한 끗 가이드**(이미지 기반
> 가이딩)로 분리됨. 채팅은 "생성 결과(가이드·레퍼런스)를 담는 뷰"로 축소. 아래 지표를 **현재(Primary)** 와
> **레거시(대화형 채팅)** 로 구분한다.

---

## A. 현재 방향 (Primary)

### ① 한 끗 가이드 — FastAPI (OTel, `fastapi/guide/_metrics.py`)

| instrument (export) | meter | 라벨 | 버킷(초) | 의미 |
|---|---|---|---|---|
| `drawe_vlm_latency_seconds` | `drawe.guide.vlm` | `model`, `outcome`(success/error) | 0.5,1,2,3,5,8,13,21,34,60 | VLM(손·얼굴·포즈·주제·스타일 관찰) 호출 지연. Gemini→Bedrock Claude 전환 효과 측정 근거 |
| `drawe_llm_latency_seconds` | `drawe.guide.llm` | `step`(plan/select/coach), `outcome`(success/error/**fallback**) | 0.5,1,2,3,5,8,13,21,34,55,90 | Grok 호출을 단계별로 계측 → 가이드 지연 지배 구간 규명 |
| `drawe_image_gen_latency_seconds` | `drawe.guide.imagegen` | `provider`, `outcome` | 1,2,3,5,8,13,21,34,55,90,120 | 레퍼런스 생성(Bedrock Stability 등) 지연·성패 |

기록 지점은 전부 초크포인트 하나씩이라 백엔드·관찰 종류가 바뀌어도 계측이 새지 않는다 —
`measure_vlm` ← `ml/vision.py:257-263`, `measure_image_gen` ← `ml/generate.py:200-201`,
`observe_llm` ← `ml/llm.py:102,138,147`.

> `outcome="fallback"` 은 **조용한 열화**다 — 키 부재/예외로 LLM 없이 코치문이 나가지만 HTTP 는 200이다.
> 지연·5xx 로는 안 잡히므로 별도 알림(`GuideLlmFallback`)으로 본다.

### 커스텀 span (`tracer = "guide.pipeline"`, `guide/routes.py`)

`guide.normalize`(81) · `guide.scene`(96) · `guide.pose`(106) · `guide.growth`(128) ·
`guide.agent`(429) · `guide.coach`(441).

속성은 붙이지 않는다. 이 span 들이 Alloy `spanmetrics` 커넥터를 거쳐
`traces_spanmetrics_*` 가 되고, `fastapi.json` 대시보드와 `drawe-fastapi-red` 알림의 원천이 된다.

### ② 레퍼런스 무드보드 — 검색 + 생성

| instrument (export) | 위치 | 라벨 | 의미 |
|---|---|---|---|
| `drawe.reference.search` | Spring `SearchService:85-89` | `outcome`(success/error), `result`(hit/empty) | **무드보드 검색**(저장분, CLIP+Pinecone). 히스토그램 있음. `result=empty`=원하는 이미지 못 찾음 → 생성 트리거 지점 |
| `drawe_image_gen_latency_seconds` | 위 ①과 동일 | | **레퍼런스 생성**. 가이드 ai_fallback 생성과 공유 |

> **핵심 퍼널**: `drawe_reference_search_seconds_count{result="empty"}` → `drawe_image_gen_latency_seconds_count`
> = "검색으로 못 찾아 생성으로 넘어간 비율".

### FastAPI `trace(stage, **fields)` — ⚠️ OTel 이 아니다

`guide/_trace.py:18`. **stdout `print` 한 줄**이며 `TRACE_CTX=1` 일 때만 출력되고 **기본 꺼져 있다**
(`_trace.py:15`). logging 경로가 아니라 print 라 **trace_id 가 붙지 않는다** — 로그↔트레이스
상관에는 쓸 수 없고, 파이프라인 분기점을 눈으로 따라가는 진단 도구다.

| 영역 | stage |
|---|---|
| 입력·주제 | `scene` · `sketch` · `subject` · `style` · `substrate` |
| 관찰(VLM) | `hand.detect` · `hand.vlm.gate` · `hand.vlm.enter` · `hand.vlm` · `face.vlm.gate` · `face.vlm` · `pose.vlm.gate` · `pose.vlm` · `vlm.cache` |
| 진단·스코어 | `sig` · `hand.route` · `hits` · `retain` |
| 프롬프트·생성 | `prompt.obs` · `llm.in` · `llm.out` |
| 성장·무드 | `growth.gate` · `growth` · `mood.profile` |

`hits`·`retain`·`sig` 는 스코어러 잔존율(상위 3개만 유지) 튜닝 근거라 특히 유용하다.
`stage` 가 positional-only(`/`)인 건 필드명 충돌로 `/guide` 가 500 나던 버그의 수정이다
(`_trace.py:20-24`) — **관측기가 동작을 깨면 안 된다**는 불변식.

---

## B. 레거시 — 대화형 채팅 (⚠️ 코드는 live, 트래픽은 0)

> 예전 채팅은 "사용자 발화 → 의도분기 → 레퍼런스 추천 / 미술용어 설명"을 대화로 했다.
> 현재 제품 방향은 채팅에 생성 결과만 담는 것이라 이 계측군은 **폐기 대상**이다.
>
> **prod 실측(2026-07-22, 30일)**: `POST /projects/{id}/chat` **1건**(최근 14일 0건),
> `intent_route`·`intent_classify`·`llm_call`·`workflow_step{COMPOSE,SEARCH,EXTRACT_KEYWORDS}`
> **전부 0**, `drawe_chat_llm_latency` 와 `drawe_output_*` 은 **시리즈조차 없음**.
>
> **2026-07-22 — COMPOSE 미채택 확정**: prod overlay 의 `WORKFLOW_COMPOSE_LIVE_INTENTS` 를
> 제거해(PR #117/#119) 워크플로를 코드 기본값(빈 집합=dormant)로 되돌렸고, 감시하던
> `drawe-backend-ai` 알림 그룹(6종)도 AMP 에서 폐지했다. 앱 코드는 미변경이라 이 계측군은
> 여전히 방출되나 소비처(알림)가 없어 고아 상태다 — 채팅 경로 코드 철거 시 함께 정리한다.

| metric (code) | 타입 | 라벨 | 의미 |
|---|---|---|---|
| `drawe.chat_llm.latency` | Timer(**hist**) | `provider`, `outcome=success`(고정) | 채팅 LLM 응답 지연(P95/P99) |
| `drawe.llm.call` | Timer | `provider`(GROK/GEMINI/CLAUDE), `outcome` | LLM 호출 지연·성패 |
| `drawe.workflow.step` | Timer | `step`(EXTRACT_KEYWORDS/SEARCH/TRANSLATE/GENERATE_IMAGE/CRITIQUE_UPLOAD/COMPOSE), `code`(IntentCode `000`~`013`), `tier`(RULE/LLM_LIGHT), `outcome` | 워크플로 단계별 |
| `drawe.workflow.shadow` | Counter | `outcome`(match/partial/miss/error) | 워크플로 shadow 비교. **COMPOSE 폐지 계측군**(prod live-intents 제거, 2026-07-22) — 채팅 트래픽 ~0 |
| `drawe.intent.route` | Counter | `outcome`(rule_hit/rule_miss) | 규칙 라우팅 적중/미스 |
| `drawe.intent.rule` | Counter | `rule_id`, `action` | 어떤 규칙이 어떤 액션을 냈는지 |
| `drawe.intent.classify` | Timer | `outcome` | 의도 분류 지연·성패 (DoD ≤300ms) |
| `drawe.output.structure_violation` | Counter | `provider`, `reason` | COMPOSE 응답 구조 위반(DoD ≤1%). **실제 발사되는 `reason` 은 `json_broke` 하나뿐** — `schema_reject` 는 Javadoc 에만 있고 호출부 없음 |
| `drawe.output.hallucinated_citation` | Counter | `source`(citations_field/body_scan/no_refs) | 환각 인용 탐지 |
| `drawe.output.citation_removed` | Counter | — | 가드레일이 제거한 인용 수 |

> **step ≠ action** — `NEW_SEARCH`·`KEEP`·`SKIP` 등은 `drawe.intent.rule` 의 **action** 값이지
> `drawe.workflow.step` 의 step 값이 아니다. 두 축을 섞어 쿼리하면 빈 결과가 나온다.

---

## C. 지원 계측 (채팅 파이프라인 부속 — 채팅 폐기 시 동반 정리 대상)

| metric (code) | 타입 | 라벨 | 의미 |
|---|---|---|---|
| `drawe.dict.lookup` | Counter | `result`(hit/miss) | 키워드 사전 캐시 적중률(Komoran) |
| `drawe.komoran.fallback` | Counter | — | 사전 미스율 초과로 LLM 추출 폴백 |
| `drawe.komoran.extract` | Timer | — | 한국어 키워드 추출 지연 |
| `drawe.session.cache.hit`/`.miss`/`.restored`/`.save` | Counter | — | Redis 채팅 세션 캐시 |
| `drawe.session.cleanup` | Counter | — | 정리된 비활성 세션 수 (`SessionCleanupScheduler:53`) |
| `drawe.tokens.input` | **DistributionSummary**(`baseUnit=tokens`) | — | 요청당 LLM 입력 토큰 **분포**(누적 카운터가 아니다) |
| `drawe.history.trimmed` | Counter | — | 토큰 예산 초과 트림된 이력 수 |

---

## D. 소비처 — 어디서 쓰이나

대시보드 7개는 `infra/k8s/overlays/prod/observability/dashboards/`(prod 전용),
알림 룰은 `infra/observability/rules/`(prod=terraform `amp-rules.tf`, dev=`dev-alert-rules.yml`).

| 메트릭 | 대시보드 | 알림 |
|---|---|---|
| `drawe_vlm_latency_seconds` | `vlm-latency`, `guide-pipeline` | `GuideVlmErrors`·`GuideVlmSlowP95` |
| `drawe_llm_latency_seconds` | `guide-pipeline` | `GuideLlmFallback`·`GuideLlmErrors`·`GuideLlmSlowP95` |
| `drawe_image_gen_latency_seconds` | `image-gen-latency`, `guide-pipeline` | `ImageGenErrors` (SlowP95는 표본 희소로 제거) |
| `drawe_reference_search_seconds` | `backend` | `ReferenceSearchErrors`·`EmptyRateHigh`·`SlowP95` |
| `drawe_dict_lookup`·`komoran_*`·`session_cache_hit/miss` | `backend` | — |
| `drawe_chat_llm_latency_seconds` | `llm-latency` **[DEPRECATED]** | — |
| `drawe_llm_call`·`intent_route`·`intent_classify`·`workflow_step`·`output_*` | — | `drawe-backend-ai` 제거됨(2026-07-22, COMPOSE 폐지) → 현재 고아 |

### 고아 메트릭 (대시보드·알림 어디에도 안 쓰임)

`drawe.intent.rule` · `drawe.output.citation_removed` · `drawe.workflow.shadow` ·
`drawe.tokens.input` · `drawe.history.trimmed` · `drawe.session.cleanup` ·
`drawe.session.cache.restored` · `drawe.session.cache.save` — 8개.

여기에 더해, **`drawe-backend-ai` 폐지(2026-07-22, COMPOSE 미채택)로 알림을 잃은**
`drawe.llm.call` · `drawe.intent.route` · `drawe.intent.classify` · `drawe.workflow.step` ·
`drawe.output.*`(structure_violation·hallucinated_citation·citation_removed) 도 이제 고아다.

전부 레거시 채팅/COMPOSE 계열이라 채팅 경로 코드 철거 시 함께 정리한다.

---

## E. 실측 볼륨 (prod AMP, 2026-07-22 기준 30일)

| 지표 | 호출 | p95 | 에러 |
|---|---|---|---|
| guide LLM `coach` | 125 | 21.0s (24h 창 31.7s) | 0 |
| guide LLM `plan` | 43 | 10.3s | 0 |
| VLM (Claude Haiku 4.5) | 32 | 4.5s | 0 |
| image_gen (bedrock) | 6 | 7.5s | 0 |
| `reference.search` | 33 | 1.9s | 0 (`result=empty` 시리즈 없음) |

**시간당 1회 미만**이라는 게 알림 설계를 지배한다 — `rate(...[5m])` 비율식은 표본이 0이라
`histogram_quantile` 이 NaN 이 되고 에러 1건이 100% 로 튄다. 그래서 현재 방향 알림은
창을 6h/24h/7d 로 넓히고 절대건수를 기본으로 쓴다. 자세한 근거는
[`infra/observability/rules/README.md`](../infra/observability/rules/README.md).

---

## 활용

- **무드보드 검색 실패율** = `drawe_reference_search_seconds_count{result="empty"} / drawe_reference_search_seconds_count`
- **검색→생성 퍼널** = 위 empty count 대비 `drawe_image_gen_latency_seconds_count`
- **단계별 P95** = `histogram_quantile(0.95, sum(rate(drawe_llm_latency_seconds_bucket[24h])) by (le, step))`
  (FastAPI 3종·`reference.search`·`chat_llm.latency` 만 가능 — 나머지는 `_bucket` 없음)
- **평균 지연(버킷 없는 Timer)** = `rate(..._seconds_sum[6h]) / rate(..._seconds_count[6h])`

> 관련: 발표 인용 가능 수치 [`final-metrics-ledger.md`](final-metrics-ledger.md), 성장 지표 설계 [`growth-metric-design.md`](growth-metric-design.md).
