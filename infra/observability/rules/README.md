# 알림 룰 (backend / fastapi / infra)

Prometheus/Mimir rule-group 포맷. 이 디렉터리가 **룰의 단일 소스**이며, dev·prod 가
각자의 저장소(Grafana Cloud / AMP)로 이 파일들을 적재한다.

| 파일 | 대상 | groups | alerts |
| --- | --- | --- | --- |
| `backend.rules.yaml` | Spring Boot (Micrometer) | `drawe-backend-red`, `-runtime`, `-reference` | 10 |
| `fastapi.rules.yaml` | fastapi-embed / -guide (spanmetrics + guide 커스텀 OTel) | `drawe-fastapi-red`, `-availability`, `drawe-guide-pipeline` | 10 |
| `infra.rules.yaml` | 노드·K8s 오브젝트 (node-exporter + kube-state-metrics) | `drawe-infra-node`, `-kubernetes` | 13 |
| | | **합계** | **33** |

## 왜 플랫폼별로 분리하지 않았나 (app 룰)

`backend` / `fastapi` 룰은 **메트릭 이름 기반**이다. 두 서비스가 내보내는 시계열 이름은
ECS 든 EKS 든 동일하므로(`http_server_requests_seconds_*`, `traces_spanmetrics_calls_total` 등)
같은 룰 한 벌이 양쪽에 그대로 적용된다. 집계도 `sum by (service_name)` 형태라
`platform` 라벨을 무시하고 합산한다.

## ⚠ infra 룰은 EKS 전제다

`infra.rules.yaml` 은 위와 달리 **EKS 클러스터가 있다는 전제**에 의존한다.
`kube_*` 는 EKS 에 배포된 kube-state-metrics 가, `node_*` 는 EKS Alloy DaemonSet 의
node-exporter 가 만든다. ECS 에는 해당 시계열이 없다.

> **EKS 를 내리면 `InfraKubeStateMetricsDown`(`absent(kube_node_info)`)이 발화한다.**
> 클러스터를 teardown 할 때는 `drawe-infra` 네임스페이스도 함께 제거하거나
> 해당 룰을 비활성화할 것.

## 적재 방법

룰 내용은 dev·prod 동일하고, **적재 경로만 다르다.**

### dev — Grafana Cloud (Mimir), CI 자동

`.github/workflows/dev-alert-rules.yml` 이 처리한다. **수동 실행 불필요.**

- 트리거: `develop` 브랜치 push 중 `infra/observability/rules/**` 변경
- 동작: `mimirtool rules load` 로 Grafana Cloud 에 적재 (실행 전 `rules diff` 를 로그로 출력)
- 수동 실행이 필요하면 Actions 탭에서 `workflow_dispatch`

### prod — AMP ruler, **terraform 관리**

**`terraform-prod/amp-rules.tf` 가 관리한다. mimirtool 이나 AWS CLI 로 직접 올리지 않는다.**
각 YAML 이 `aws_prometheus_rule_group_namespace` 리소스에 1:1로 매핑된다.

| 리소스 | AMP 네임스페이스 | 소스 파일 |
| --- | --- | --- |
| `aws_prometheus_rule_group_namespace.backend` | `drawe-backend` | `backend.rules.yaml` |
| `aws_prometheus_rule_group_namespace.fastapi` | `drawe-fastapi` | `fastapi.rules.yaml` |
| `aws_prometheus_rule_group_namespace.infra` | `drawe-infra` | `infra.rules.yaml` |

`data = file(...)` 로 파일을 그대로 읽으므로 **YAML 을 수정하면 `terraform plan` 에 diff 가
뜨고, apply 로 반영된다.** 룰 변경 시 별도 적재 절차가 없다.

```bash
# terraform-prod 는 수동 apply 스택이다. 반드시 .env 를 source 한 뒤 실행한다.
cd infra/terraform-prod
set -a; . ./.env; set +a          # TF_VAR_db_password / TF_VAR_valkey_auth_token 등
AWS_PROFILE=drawe-prod terraform plan -target=aws_prometheus_rule_group_namespace.infra
```

> **전체 apply 주의.** 이 스택에는 ECS(레거시) 리소스가 함께 있어 AMI/task-definition
> 드리프트가 상시 존재한다. 룰만 바꿀 때는 `-target` 으로 범위를 좁히는 편이 안전하다.
> (암호 로테이션 지뢰는 `rds.tf` / `ssm.tf` 의 `lifecycle { ignore_changes }` 로 차단해 두었다.)

### 적재 확인

```bash
WS=$(cd infra/terraform-prod && terraform output -raw amp_workspace_id)
aws amp list-rule-groups-namespaces --workspace-id "$WS"
aws amp describe-rule-groups-namespace --workspace-id "$WS" --name drawe-infra
```

## 룰 그룹 구성

| 그룹 | 대상 | 비고 |
| --- | --- | --- |
| `drawe-backend-red` · `-runtime` | HTTP RED · JVM/Hikari/CB | |
| `drawe-backend-reference` | 무드보드 검색(`drawe_reference_search_*`) | **현재 제품 방향** |
| `drawe-fastapi-red` · `-availability` | spanmetrics RED | |
| `drawe-guide-pipeline` | 한 끗 가이드 VLM·LLM·이미지생성 | **현재 제품 방향** |
| `drawe-infra-node` · `-kubernetes` | 노드·K8s 오브젝트 | EKS 전제(위 참조) |

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

### 채팅/COMPOSE 알림 그룹 폐지 (2026-07)

COMPOSE 워크플로 미채택으로 대화형 채팅(intent 분기 → COMPOSE) 경로가 폐기되어,
그 경로만 감시하던 `drawe-backend-ai` 그룹(채팅/COMPOSE 알림 6종)을 제거했다.
prod overlay 의 `WORKFLOW_COMPOSE_LIVE_INTENTS` 도 함께 내려 코드 기본값(빈 집합)으로
dormant 화했다(애플리케이션 코드는 불변). 감시 대상 경로가 없으므로 알림도 존치하지 않는다.

## 검증 현황

- **infra 룰(13개)**: PromQL 13식 + 노드 대시보드 13쿼리 = **26/26 을 AMP 실제 파서로 질의해
  문법 통과** 확인. 룰이 참조하는 `kube_*` / `node_*` 시계열이 AMP 에 실재함도 함께 확인했다.
- **backend / fastapi 룰**: **prod AMP 실제 파서로 질의해 문법 통과** 확인(2026-07-22).
  파싱만이 아니라 **임계값을 뺀 내부식이 실값을 반환하는지**까지 확인했다 — 라벨 오타로
  룰이 조용히 무력화되는 것(아래 semconv 항목과 같은 사고)을 막기 위함. 확인된 헤드룸:
  VLM p95 4.1s/임계 **21** · guide coach p95 31.7s/임계 55 · 무드보드 검색 p95 1.0s/임계 5.
  (image_gen 은 표본 부재로 P95 룰 제거 — 에러 룰만 유지.)
- **임계는 실제 버킷 경계(`le`)에 정렬**했다 — AMP 에 실재하는 경계를 열거해 대조:
  `drawe_llm_latency`=(…,34,**55**,90), `drawe_vlm_latency`=(…,13,**21**,34,60).

### fastapi 룰의 semconv 가정 (미검증 1건)

`fastapi.rules.yaml` 의 `http_status_code=~"5.."` 필터는 spanmetrics 디멘션이 **구 semconv
(`http_status_code`)** 라고 가정한다. Python OTel instrumentation 이 신 semconv
(`http_response_status_code`)를 emit 하면 필터가 비어 룰이 조용히 무력화된다.

```promql
count by (__name__)({__name__=~"traces_spanmetrics_duration.*"})   # _milliseconds vs _seconds
count by (http_status_code)(traces_spanmetrics_calls_total)         # 디멘션 존재 여부
```

다르면 라벨 이름만 치환하면 된다(로직 변경 불필요).

## 통지(알림 라우팅)

이 디렉터리는 **룰 평가**까지만 담당한다. 실제 통지는 별도다 —
`terraform-prod/amp-rules.tf` 하단 주석 참고(`aws_prometheus_alert_manager_definition`
또는 기존 `discord-alerts.tf` 경로 재사용).
