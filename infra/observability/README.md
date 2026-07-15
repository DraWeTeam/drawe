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
