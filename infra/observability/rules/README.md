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

## 적용 전 검증 (이 저장소에서 수행됨)
- 30/30 PromQL 식이 정상 파싱(promql_parser, README 가 명시한 동일 파서).
- 룰이 참조하는 17개 메트릭 전부 코드/라이브러리 인벤토리에 존재.

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
