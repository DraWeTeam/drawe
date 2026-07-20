# 알림 룰 (backend / fastapi / infra)

Prometheus/Mimir rule-group 포맷. 이 디렉터리가 **룰의 단일 소스**이며, dev·prod 가
각자의 저장소(Grafana Cloud / AMP)로 이 파일들을 적재한다.

| 파일 | 대상 | groups | alerts |
| --- | --- | --- | --- |
| `backend.rules.yaml` | Spring Boot (Micrometer) | `drawe-backend-red`, `-runtime`, `-ai` | 13 |
| `fastapi.rules.yaml` | fastapi-embed / -guide (Alloy spanmetrics) | `drawe-fastapi-red`, `-availability` | 4 |
| `infra.rules.yaml` | 노드·K8s 오브젝트 (node-exporter + kube-state-metrics) | `drawe-infra-node`, `-kubernetes` | 13 |
| | | **합계** | **30** |

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

## 검증 현황

- **infra 룰(13개)**: PromQL 13식 + 노드 대시보드 13쿼리 = **26/26 을 AMP 실제 파서로 질의해
  문법 통과** 확인. 룰이 참조하는 `kube_*` / `node_*` 시계열이 AMP 에 실재함도 함께 확인했다.
- **backend / fastapi 룰**: 도입 시점에 PromQL 파싱 및 참조 메트릭 인벤토리 확인 완료.

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
