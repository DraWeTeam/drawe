############################################################
# AMP Alertmanager → 기존 SNS(alerts) → Discord
#
#  목적: amp-rules.tf 가 적재한 룰이 "발화"하면, 그 알림을 기존
#        aws_sns_topic.alerts (이미 Discord Lambda 가 구독 중)로 라우팅한다.
#        → 새 통지 경로를 만들지 않고 기존 SNS→Lambda→Discord 를 재사용.
#
#  구성 (둘 다 필요):
#   1) aws_prometheus_alert_manager_definition : 발화 알림을 SNS 로 보내는 라우팅/리시버
#   2) aws_sns_topic_policy                    : AMP 서비스 주체(aps)에 sns:Publish 허용
#
#  흐름:
#   룰 평가(amp-rules.tf) → 발화 → Alertmanager(이 파일) → sns_configs 로 alerts 토픽
#   → (기존) Lambda 구독 → Discord 웹훅
#
#  참고: Discord Lambda(discord_notify.py)는 메시지가 CloudWatch 알람 JSON 이면 리치
#        임베드로, 아니면 raw 텍스트로 폴백한다. AMP 알림은 폴백 경로(회색 임베드)로
#        뜨며 subject=제목, message=본문이 된다. 색상까지 구분하고 싶으면 Lambda 에
#        AMP 알림 파서를 추가하면 된다(선택).
############################################################

variable "enable_amp_alertmanager" {
  description = "AMP Alertmanager → 기존 SNS(alerts) → Discord 라우팅 on/off. off 면 룰은 평가되나 통지는 안 감."
  type        = bool
  default     = true
}

# ── 1) Alertmanager 정의: 발화 알림을 alerts 토픽으로 ──
# definition 은 'alertmanager_config:' 래퍼로 감싼 표준 Alertmanager YAML 이다.
# sigv4.region 은 필수(없으면 AMP 가 SNS 호출 권한 서명을 못 만든다).
resource "aws_prometheus_alert_manager_definition" "main" {
  count        = var.enable_amp_alertmanager ? 1 : 0
  workspace_id = aws_prometheus_workspace.main.id

  definition = <<-EOT
    alertmanager_config: |
      route:
        receiver: 'discord-sns'
        group_by: ['alertname', 'severity']
        group_wait: 30s
        group_interval: 5m
        repeat_interval: 4h
      receivers:
        - name: 'discord-sns'
          sns_configs:
            - topic_arn: '${aws_sns_topic.alerts.arn}'
              sigv4:
                region: '${var.aws_region}'
              send_resolved: true
              subject: '[${var.env}] {{ .CommonLabels.alertname }} ({{ .Status }})'
              # ⚠ 계약: 아래 message 형식(STATUS=/SEVERITY=/ALERTNAME=/SERVICE= 4줄 헤더 + '---' 구분자 + 본문)은
              #   lambda/discord_notify.py 의 _parse_amp 와 짝이다. 헤더 키·순서·'---' 를 바꾸면 Lambda 도 함께 바꿔야 하며,
              #   안 그러면 에러 없이 회색 폴백으로 조용히 열화한다. 색은 .CommonLabels.severity(critical/warning/info),
              #   서비스 필드는 .CommonLabels.service(없는 룰은 Lambda가 '-' 처리)에 의존한다.
              message: |
                STATUS={{ .Status }}
                SEVERITY={{ .CommonLabels.severity }}
                ALERTNAME={{ .CommonLabels.alertname }}
                SERVICE={{ .CommonLabels.service }}
                ---
                {{ range .Alerts -}}
                {{ .Annotations.summary }}
                {{ with .Annotations.description }}{{ . }}
                {{ end }}{{ end }}
  EOT
}

# ── 2) SNS 토픽 리소스 정책: AMP(aps) 에 publish 허용 ──
# aws_sns_topic_policy 는 토픽의 access policy 를 "교체"하므로, 기존 동작
# (계정 소유자 → CloudWatch 알람들의 publish)을 유지하기 위해 owner 문장도 함께 둔다.
data "aws_iam_policy_document" "alerts_topic" {
  # (a) 기존 기본 정책 상당의 owner 문장 — CloudWatch 알람 등 기존 publisher 보존
  statement {
    sid    = "DefaultOwnerAccess"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    actions = [
      "SNS:Publish", "SNS:GetTopicAttributes", "SNS:SetTopicAttributes",
      "SNS:AddPermission", "SNS:RemovePermission", "SNS:DeleteTopic",
      "SNS:Subscribe", "SNS:ListSubscriptionsByTopic",
    ]
    resources = [aws_sns_topic.alerts.arn]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  # (b) AMP 서비스 주체에 publish 허용 + confused-deputy 방지(workspace ARN/계정 조건)
  statement {
    sid    = "AllowAMPPublish"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["aps.amazonaws.com"]
    }
    actions   = ["sns:Publish", "sns:GetTopicAttributes"]
    resources = [aws_sns_topic.alerts.arn]
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_prometheus_workspace.main.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  count  = var.enable_amp_alertmanager ? 1 : 0
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts_topic.json
}
