# 관측 대시보드 — 실사용 경로 정합

> 자동 계측 대시보드가 계속 `No data` 였던 원인을 추적해, 대시보드를 **실제 살아있는 계측 경로** 기준으로 재정비하고, `/guide` 파이프라인에 단계별 span 을 붙여 지금까지 관측 불가였던 로컬 추론 구간을 분해한 작업 기록.

## 배경 — 왜 No data 였나

자동 계측 대시보드가 계속 `No data` 라 원인을 조사한 결과, 측정 대상인 채팅 경로
(`POST /projects/{projectId}/chat`)가 제품 피벗으로 **미사용** 상태였다.

Micrometer 는 **lazy 등록**이라 해당 경로 호출이 0 이면 시계열 자체가 생기지 않는다.
그래서 대시보드만 봐서는 **"계측 고장"과 "트래픽 0"이 구분되지 않았다.** 빈 패널이
장애로 오인되던 게 이 작업의 출발점이다.

## 현재 대시보드 구조

| 그룹 | uid | 내용 |
| --- | --- | --- |
| **Service Runtime** | `drawe-backend` | Spring HTTP · JVM · Hikari (자동) + 레퍼런스보드/검색 수동계측 |
| | `drawe-fastapi` | spanmetrics RED (자동) |
| **AI Pipeline** | `drawe-guide-pipeline` | `drawe_llm_latency_seconds` (Grok step 별) |
| | `drawe-vlm-latency` | `drawe_vlm_latency_seconds` |
| | `drawe-image-gen-latency` | `drawe_image_gen_latency_seconds` |
| **Deprecated** | `drawe-chat-llm-latency` | uid 유지 + 배너 (제거 아님 — `disableDeletion: true`) |

## 완료

- `drawe-guide-pipeline` 대시보드 추가.
- `drawe-chat-llm-latency` 대시보드 Deprecated 처리 (uid 유지 + 배너).
- `drawe-backend` 대시보드 정리.
- `/guide` 파이프라인에 단계별 span 추가 (`normalize` / `scene` / `pose` / `growth` / `agent` / `coach`).
- `/guide` 요청으로 Tempo 워터폴 및 spanmetrics 6 개 span 확인.

## 실측 결과 (span 추가로 처음 관측된 것)

`/guide` P95 병목은 로컬 모델 추론이 아니라 **LLM 호출**이었다:

```
guide.coach ≈10s(상한 클램프) > guide.growth ≈9.5s > guide.scene ≈4.8s > guide.pose ≈0.95s
```

기존 계측(`drawe_llm_latency` 등)은 외부 AI 호출만 감쌌기 때문에 `scene`(CLIP)·`pose`(ViTPose)
같은 로컬 추론 구간은 관측이 불가능했다. span 추가로 단계별 분해가 가능해졌고, 그 결과
가장 무거울 거라 의심하던 로컬 추론(`pose ≈0.95s`)이 아니라 순차 LLM 호출(`coach`)이
지배적이라는 게 처음으로 드러났다.

## 발견 스토리 ③ — backend 로그↔트레이스 상관 (해결 완료, 2026-07-19)

Tempo trace ID 로 Loki 를 검색하면 0건이던 문제. **원인 확정 → 수정 → prod 실측 검증까지 종결.**

- **증상:** Tempo 의 trace ID 로 Loki 검색 시 0건. Loki 로그에 `trace_id`/`span_id` 필드 부재.
- **원인(확정):** **로그 패턴에 `%X{trace_id}` 누락.** OTel Java Agent(2.29)는 MDC 에
  `trace_id`(snake_case)를 정상 주입하고 있었으나, Spring 기본 콘솔 로그 패턴이 `%X`(MDC)를
  찍지 않아 stdout·Loki 어디에도 trace context 가 출력되지 않았다. (수집·export 자체는 정상 —
  **패턴만의 문제**였다.)
- **해결:** `base/backend/configmap.yaml` 의 `LOGGING_PATTERN_CONSOLE` 에
  `trace_id:%X{trace_id} span_id:%X{span_id}` 추가. 기존 로그 필드(`[%thread]`·logger·level·ts)는
  유지하고 trace context 만 덧붙였다. **구분자는 `:`** — `grafana-datasources.yaml` 의
  `derivedFields` matcherRegex `trace_id["\s:]+([a-f0-9]+)` 와 일치시키기 위함(`=` 는 그 regex 에
  매칭 안 됨. 이 방식은 datasources 를 안 건드린다). PR #106(`fb0767e`).
- **검증(prod 실측):** span 안 로그 40요청 → 고유 `trace_id` **48개 stdout 출력** →
  **Loki 100% 도달**(`service_name=backend`, 로그는 샘플링 없음) → **Tempo 교집합 3개**
  (트레이스 샘플링 ~10% 에 부합). 3개 모두 동일 `trace_id` 로 로그·트레이스 양쪽 존재 =
  **상관 성립.**
- **부수 발견 — ConfigMap 은 파드 자동 rollout 을 안 시킨다:** `backend-config` 는 고정 이름
  ConfigMap 이라 값이 바뀌어도 Deployment 의 pod template 은 불변 → ArgoCD 가 `Synced` 여도
  파드는 옛 env 를 그대로 물고 있다. **`kubectl rollout restart deploy/backend` 수동 재기동**으로
  새 env 를 로드해야 반영된다. (자동화하려면 Reloader 어노테이션 또는 kustomize
  `configMapGenerator`(해시 이름) — 남은 트랙.)
- **검증 함정 — 같은 요청이 로그+트레이스를 동시 생성해야 한다:** ground-truth 배치에서
  `/auth/refresh`(span 만 생성, ERROR 로그 없음)와 `/auth/login` 비-JSON(로그+span 동시)을
  섞으면, Loki set(login 로그)과 Tempo set(refresh 트레이스)이 서로 다른 요청이라 disjoint →
  교집합 0 **오탐**이 난다. 상관 검증은 **동일 요청이 로그와 트레이스를 함께 만들도록** 해야 정확.
- **남은 트랙:** fastapi(Python) 서비스의 로그↔트레이스 상관(MDC 개념 없어 별도 조사),
  ConfigMap 자동 롤아웃(Reloader/configMapGenerator).

> 교훈: **"수집됨 ≠ 상관됨".** 세 기둥(로그·트레이스·메트릭)이 각각 수집돼도, **로그에 trace_id 가
> 실려야** 비로소 상관(자동 점프)이 성립한다. 그리고 그 trace_id 는 **로그 패턴이 `%X{}` 로 찍어줘야**
> 나온다 — agent 가 MDC 에 넣는 것과 로그가 출력하는 것은 별개다.

## 운영 주의

- **대시보드 uid 는 변경하지 않는다.** EKS/ECS Grafana 가 같은 RDS `grafana` 스키마를 공유한다.
  uid 가 바뀌면 기존 대시보드가 고아로 남고 새 게 따로 생긴다.
- **`kustomization` 의 dashboards 목록에서 파일을 제거하지 않는다.** provider 가
  `disableDeletion: true` 라 DB 에서 삭제되지 않고 고아로 남는다. Deprecation 은
  "제거"가 아니라 **uid 유지 + 내용 갱신**이다.
- 상세: [`dashboards/ROLLBACK.md`](../k8s/overlays/prod/observability/dashboards/ROLLBACK.md)

## 향후 개선

- spanmetrics 버킷 상한 상향 (현재 10s — `guide.coach` P95 가 클램프되어 실제 값 관측 불가).
- Backend LLM latency/token 계측.
- `analytics_events` 연동.
- Cost Dashboard 개선.
- `GuideResponse` usage 전달.

## 관련 문서

- [`../README.md`](../README.md) — infra 전체 그림(관측성 파이프라인 포함)
- [`rules/README.md`](rules/README.md) — 알림 룰 (플랫폼 중립)
- [`../k8s/overlays/prod/observability/dashboards/ROLLBACK.md`](../k8s/overlays/prod/observability/dashboards/ROLLBACK.md) — 공유 RDS `grafana` 스키마 롤백 가이드
- [`../../docs/observability-custom-metrics.md`](../../docs/observability-custom-metrics.md) — 도메인 커스텀 계측 전체 목록
