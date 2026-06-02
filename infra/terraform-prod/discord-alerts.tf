############################################################
# SNS → Lambda → Discord 알림
#
# AWS Chatbot 은 Discord 미지원 → Lambda 가 SNS 를 받아 Discord 웹훅으로 POST.
# 이 파일을 terraform-dev / terraform-prod 양쪽에 그대로 두면 됩니다
# (둘 다 aws_sns_topic.alerts · var.env · local.name_prefix 가 이미 존재).
#
# 사전: 같은 dir 에 lambda/discord_notify.py 를 두고,
#       apply 후 SSM 의 discord-webhook-url 에 실제 웹훅을 수동 주입.
############################################################

variable "enable_discord_alerts" {
  description = "Discord 알림 on/off. off 면 관련 리소스 미생성."
  type        = bool
  default     = true
}

# Discord 웹훅 URL — SecureString placeholder (apply 후 수동 주입, state 노출 방지)
resource "aws_ssm_parameter" "discord_webhook" {
  count = var.enable_discord_alerts ? 1 : 0
  name  = "/${var.project}/${var.env}/discord-webhook-url"
  type  = "SecureString"
  value = "CHANGE_ME" # 채널 설정 → 연동 → 웹훅 → 새 웹훅 의 URL
  tags  = { Name = "${local.name_prefix}-discord-webhook" }
  lifecycle { ignore_changes = [value] }
}

data "archive_file" "discord_lambda" {
  count       = var.enable_discord_alerts ? 1 : 0
  type        = "zip"
  source_file = "${path.module}/lambda/discord_notify.py"
  output_path = "${path.module}/.build/discord_notify.zip"
}

resource "aws_iam_role" "discord_lambda" {
  count = var.enable_discord_alerts ? 1 : 0
  name  = "${local.name_prefix}-discord-notify"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = { Name = "${local.name_prefix}-discord-notify" }
}

resource "aws_iam_role_policy" "discord_lambda" {
  count = var.enable_discord_alerts ? 1 : 0
  name  = "discord-notify"
  role  = aws_iam_role.discord_lambda[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = aws_ssm_parameter.discord_webhook[0].arn
      },
      {
        # SecureString(기본 aws/ssm 키) 복호화. CMK 쓰면 그 키 ARN 으로 좁힐 것.
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_lambda_function" "discord_notify" {
  count            = var.enable_discord_alerts ? 1 : 0
  function_name    = "${local.name_prefix}-discord-notify"
  role             = aws_iam_role.discord_lambda[0].arn
  runtime          = "python3.12"
  handler          = "discord_notify.handler"
  filename         = data.archive_file.discord_lambda[0].output_path
  source_code_hash = data.archive_file.discord_lambda[0].output_base64sha256
  timeout          = 10
  environment {
    variables = {
      WEBHOOK_PARAM = aws_ssm_parameter.discord_webhook[0].name
      ENVIRONMENT   = var.env
    }
  }
  tags = { Name = "${local.name_prefix}-discord-notify" }
}

resource "aws_lambda_permission" "sns_invoke_discord" {
  count         = var.enable_discord_alerts ? 1 : 0
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.discord_notify[0].function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.alerts.arn
}

resource "aws_sns_topic_subscription" "discord" {
  count     = var.enable_discord_alerts ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.discord_notify[0].arn
}
