############################################################
# AMP Ruler — alert rule group 적재 (prod)
#
#  목적: infra/observability/rules/*.yaml 를 AMP ruler 에 실제로 로드한다.
#        (이전엔 파일만 있고 어디에도 wired 되지 않아 로드되지 않던 것을 연결)
#
#  - 룰은 플랫폼 중립: ECS·EKS 가 같은 메트릭명을 AMP 로 push 하므로 한 벌로 양쪽 커버.
#  - AMP workspace 는 amp.tf 의 aws_prometheus_workspace.main (ECS·EKS 공유).
#  - data 는 표준 Prometheus rule-groups YAML (최상위 key = groups). 파일을 그대로 읽어
#    단일 소스로 유지 → YAML 수정 시 terraform plan 에 diff 가 떠 재적용된다.
#  - namespace 단위로 분리(backend / fastapi)해 갱신·삭제 영향 범위를 좁힌다.
#
#  적재 확인:
#    aws amp list-rule-groups-namespaces --workspace-id <id>
#    aws amp describe-rule-groups-namespace --workspace-id <id> --name drawe-backend
############################################################

resource "aws_prometheus_rule_group_namespace" "backend" {
  name         = "drawe-backend"
  workspace_id = aws_prometheus_workspace.main.id
  data         = file("${path.module}/../observability/rules/backend.rules.yaml")
}

resource "aws_prometheus_rule_group_namespace" "fastapi" {
  name         = "drawe-fastapi"
  workspace_id = aws_prometheus_workspace.main.id
  data         = file("${path.module}/../observability/rules/fastapi.rules.yaml")
}

# 참고: 알림을 실제 통지로 보내려면 AMP alertmanager 정의가 별도로 필요하다.
#   - 이미 Discord 등으로 통지 중이면(discord-alerts.tf) 그 경로를 재사용하거나,
#   - aws_prometheus_alert_manager_definition 으로 AMP 자체 라우팅을 구성한다.
#   본 파일은 "rule 평가"까지 담당하고, 통지 라우팅은 기존 알림 스택에 맞춰 연결하면 된다.
