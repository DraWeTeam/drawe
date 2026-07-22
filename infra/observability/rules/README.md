# 알림 룰 (backend / fastapi) — 플랫폼 중립

## 왜 EKS 전용으로 분리하지 않았나
알림 룰은 **메트릭 이름 기반**이다. backend(Micrometer)와 fastapi(Alloy spanmetrics)가
내보내는 시계열 이름은 ECS 든 EKS 든 **동일**하다(`http_server_requests_seconds_*`,
`drawe_llm_call_seconds_*`, `traces_spanmetrics_calls_total` 등). 룰은 `cluster` 나
`platform` 라벨로 group/filter 하지 않으므로, 같은 룰 한 벌이 ECS·EKS 양쪽 시계열에
그대로 적용된다.

게다가 룰은 Alloy/k8s 매니페스트가 아니라 **저장소(Mimir/AMP)의 ruler 에 별도로 적재**
된다. 즉 ECS 설정 파일(`configs/*.alloy`)이나 EKS overlay 와 물리적으로 겹치지 않아,
**롤백 위험이 없다.** 그래서 split 대상이 아니며, 플랫폼 중립 위치
(`infra/observability/rules/`)에 둔다.

> 단, blue/green 공존 구간에서 `platform="eks"` 라벨이 붙은 EKS series 와 라벨 없는
> ECS series 가 같은 저장소에 함께 들어온다. 룰의 집계는 모두 `sum by (service_name)`
> / `sum by (provider)` 형태라 `platform` 을 무시하고 합산하므로 결과는 정상이다.

## 적재 방법
저장소가 dev/prod 에서 다르므로 적재 경로도 다르다(룰 내용은 동일).

**dev — Grafana Cloud (Mimir):**
```bash
mimirtool rules load backend.rules.yaml fastapi.rules.yaml \
  --address "$GRAFANA_CLOUD_PROM_URL" \
  --id      "$GRAFANA_CLOUD_TENANT_ID" \
  --key     "$GRAFANA_CLOUD_API_KEY"
# 확인: mimirtool rules print --address ... --id ... --key ...
```

**prod — Amazon Managed Prometheus (AMP) ruler:**
AMP 는 rule group 을 워크스페이스의 rule namespace 로 올린다. `awscli` +
`aws-sigv4` 프록시(예: aws-sigv4-proxy)를 띄운 뒤 동일하게 `mimirtool rules load
--address http://localhost:8080/workspaces/<ws-id>` 로 적재하거나, AMP 의
`CreateRuleGroupsNamespace` API 에 이 YAML 을 그대로 본문으로 전달한다.
워크스페이스 ID 는 prod kustomization 의 `AMP_REMOTE_WRITE_URL` 의 `ws-...` 와 동일.

## 룰 그룹 구성

| 그룹 | 대상 | 비고 |
| --- | --- | --- |
| `drawe-backend-red` · `-runtime` | HTTP RED · JVM/Hikari/CB | |
| `drawe-backend-reference` | 무드보드 검색(`drawe_reference_search_*`) | **현재 제품 방향** |
| `drawe-backend-ai` | 대화형 채팅 intent·COMPOSE | ⚠ **DEPRECATED** — 아래 참조 |
| `drawe-fastapi-red` · `-availability` | spanmetrics RED | |
| `drawe-guide-pipeline` | 한 끗 가이드 VLM·LLM·이미지생성 | **현재 제품 방향** |

### ⚠ 저볼륨 환경의 임계·창 설계 (2026-07-22)

현재 방향 지표의 실측 볼륨은 **시간당 1회 미만**이다(30일 기준 guide coach 125 ·
plan 43 · VLM 32 · image_gen 6 · 무드보드 검색 33회). 이 볼륨에서는 기존 RED 룰처럼
`rate(...[5m])` 비율식을 쓰면 **표본이 0이라 `histogram_quantile` 이 NaN 이 되고,
에러 1건이 곧 100% 로 튄다.** 그래서 새 두 그룹은:

- 창을 **6h / 24h / 7d** 로 넓히고,
- 비율 대신 **절대건수**를 기본으로 쓰고,
- 비율이 꼭 필요한 곳(`ReferenceSearchEmptyRateHigh`)엔 **최소볼륨 가드**(`and ... >= 10`)를 붙인다.

임계는 감이 아니라 **AMP 실측 분위수 + 버킷 경계 기준**이다. `histogram_quantile` 은 버킷
경계 사이를 선형 보간하므로, 임계는 **실제 `le` 경계값**에 맞춰야 보간 오차가 없다.

- `GuideLlmSlowP95`(coach) = **55s** — `drawe_llm_latency` 경계(…,34,55,90). 이건 "SLO 만족"이
  아니라 **SLO 미달을 인지한 회귀 가드**다: coach 는 실측 p95 21s / p99 31s 로 이미 느리고
  (원인=Grok 순차 3회 호출), SLO 기준(체감 ~15-20s)으로 잡으면 상시 발화한다. 레이턴시 개선
  후 SLO 기준으로 재조정할 것. (annotation 에도 이 취지를 명시.)
- `GuideVlmSlowP95` = **21s** — `drawe_vlm_latency` 경계(…,13,21,34,60). 15 는 보간값이라 21 로
  정렬했다(관측 p95 4.1s). 더 민감하게는 13.
- `ImageGenSlowP95` 는 **제거**했다 — 표본 희소(생성 0.2회/일)로 상시 NaN, 임계도 버킷 사이
  보간값이라 방어선 미성립. `ImageGenErrors`(절대건수)만 실효 방어선으로 남긴다. 데이터가
  쌓이면 경계값으로 재도입 가능.

트래픽이 붙으면 창을 좁히고 임계를 비율식/SLO 기준으로 되돌릴 것.

### `drawe-backend-ai` 가 DEPRECATED 인 이유

이 그룹은 대화형 채팅(intent 분기 → COMPOSE) 경로만 감시하는데, 제품 방향이 무드보드
검색 + 한 끗 가이드로 바뀌어 그 경로가 사실상 쓰이지 않는다. prod 실측(30일):
`POST /projects/{id}/chat` **1건**(최근 14일 0건), `intent_route`·`intent_classify`·
`llm_call`·`workflow_step` **전부 0**, `drawe_chat_llm_latency` 와 `drawe_output_*` 은
**시리즈조차 없음**.

그래도 지금 지우지 않는다 — 코드와 prod 설정(`WORKFLOW_COMPOSE_LIVE_INTENTS`)이 아직
살아 있어 트래픽이 돌아올 수 있고, 0 트래픽에선 비율식이 `0/0=NaN` 이라 발화하지 않아
소음이 없다. **채팅 경로를 실제로 철거할 때 이 그룹도 함께 삭제할 것.**

## 적용 전 검증 (이 저장소에서 수행됨)
- **PromQL 식을 prod AMP 실제 파서로 질의해 문법 통과** 확인(2026-07-22).
- 파싱만이 아니라 **임계값을 뺀 내부식이 실값을 반환하는지**까지 확인했다 — 라벨 오타로
  룰이 조용히 무력화되는 것(아래 semconv 항목과 같은 사고)을 막기 위함. 확인된 헤드룸:
  VLM p95 4.1s/임계 **21** · guide coach p95 31.7s/임계 55 · 무드보드 검색 p95 1.0s/임계 5.
  (image_gen 은 표본 부재로 P95 룰 제거 — 에러 룰만 유지.)
- **임계는 실제 버킷 경계(`le`)에 정렬**했다 — AMP 에 실재하는 경계를 열거해 대조:
  `drawe_llm_latency`=(…,34,**55**,90), `drawe_vlm_latency`=(…,13,**21**,34,60).
- 룰이 참조하는 메트릭 전부 코드/라이브러리 인벤토리에 존재.

## 검증이 필요한 한 가지 (semconv)
fastapi 룰의 `http_status_code=~"5.."` 필터는 spanmetrics 디멘션 이름이 **구
semconv `http_status_code`** 라고 가정한다. Python OTel instrumentation 버전이
신 semconv(`http_response_status_code`)를 emit 하면 필터가 비게 된다. 적재 전 저장소에서
한 번 확인:
```promql
count by (__name__)({__name__=~"traces_spanmetrics_duration.*"})   # _milliseconds vs _seconds
count by (http_status_code)(traces_spanmetrics_calls_total)         # 디멘션 존재 여부
```
다르면 룰의 라벨 이름만 치환하면 된다(로직 변경 불필요).
