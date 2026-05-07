############################################################
# EventBridge Scheduler — dev 비용 절감 (prod 에선 disable)
#
# 운영 시간: 평일 13:00~18:00 KST (실 운영 ~25hr/주)
#
# 시작 시퀀스 (race 방지 — RDS start 가 5~10분 걸림을 고려):
#   12:45  NAT Instance start          (외부 통신 준비)
#   12:50  RDS start, Valkey start     (DB/Cache 준비)
#   13:05  ECS ASG desired=1           (RDS 가동 후 충분히 대기)
#
# 종료 시퀀스:
#   18:10  ECS ASG desired=0, Valkey stop, RDS stop
#   18:15  NAT Instance stop           (가장 마지막)
#
# var.enable_cost_schedule=false 면 모든 schedule 미생성 (count=0)
############################################################

locals {
  schedule_count = var.enable_cost_schedule ? 1 : 0
}

# ── RDS START (평일 12:50 KST) ───────────────────────────
resource "aws_scheduler_schedule" "rds_start" {
  count      = local.schedule_count
  name       = "${local.name_prefix}-rds-start"
  group_name = "default"

  schedule_expression          = "cron(50 12 ? * MON-FRI *)"
  schedule_expression_timezone = "Asia/Seoul"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:rds:startDBInstance"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ DbInstanceIdentifier = aws_db_instance.main.identifier })
  }
}

# ── RDS STOP (평일 18:10 KST) ────────────────────────────
resource "aws_scheduler_schedule" "rds_stop" {
  count      = local.schedule_count
  name       = "${local.name_prefix}-rds-stop"
  group_name = "default"

  schedule_expression          = "cron(10 18 ? * MON-FRI *)"
  schedule_expression_timezone = "Asia/Seoul"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:rds:stopDBInstance"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ DbInstanceIdentifier = aws_db_instance.main.identifier })
  }
}

# ── NAT Instance START (평일 12:45 KST — 가장 먼저) ─────
resource "aws_scheduler_schedule" "nat_start" {
  count      = local.schedule_count
  name       = "${local.name_prefix}-nat-start"
  group_name = "default"

  schedule_expression          = "cron(45 12 ? * MON-FRI *)"
  schedule_expression_timezone = "Asia/Seoul"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:startInstances"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ InstanceIds = [aws_instance.nat.id] })
  }
}

# ── NAT Instance STOP (평일 18:15 KST — 가장 마지막) ─────
resource "aws_scheduler_schedule" "nat_stop" {
  count      = local.schedule_count
  name       = "${local.name_prefix}-nat-stop"
  group_name = "default"

  schedule_expression          = "cron(15 18 ? * MON-FRI *)"
  schedule_expression_timezone = "Asia/Seoul"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ InstanceIds = [aws_instance.nat.id] })
  }
}

# ── Valkey EC2 START (평일 12:50 KST) ────────────────────
resource "aws_scheduler_schedule" "valkey_start" {
  count      = local.schedule_count
  name       = "${local.name_prefix}-valkey-start"
  group_name = "default"

  schedule_expression          = "cron(50 12 ? * MON-FRI *)"
  schedule_expression_timezone = "Asia/Seoul"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:startInstances"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ InstanceIds = [aws_instance.valkey.id] })
  }
}

# ── Valkey EC2 STOP (평일 18:10 KST) ─────────────────────
resource "aws_scheduler_schedule" "valkey_stop" {
  count      = local.schedule_count
  name       = "${local.name_prefix}-valkey-stop"
  group_name = "default"

  schedule_expression          = "cron(10 18 ? * MON-FRI *)"
  schedule_expression_timezone = "Asia/Seoul"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ InstanceIds = [aws_instance.valkey.id] })
  }
}

# ── ECS ASG Scale-to-Zero (평일 18:10 KST) ────────────────
resource "aws_scheduler_schedule" "ecs_asg_stop" {
  count      = local.schedule_count
  name       = "${local.name_prefix}-ecs-asg-stop"
  group_name = "default"

  schedule_expression          = "cron(10 18 ? * MON-FRI *)"
  schedule_expression_timezone = "Asia/Seoul"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:autoscaling:updateAutoScalingGroup"
    role_arn = aws_iam_role.scheduler.arn
    input = jsonencode({
      AutoScalingGroupName = aws_autoscaling_group.ecs.name
      DesiredCapacity      = 0
      MinSize              = 0
    })
  }
}

# ── ECS ASG Scale-Up (평일 13:05 KST) ─────────────────────
# 이전: 12:55 → 새로: 13:05
# 이유: RDS start 가 5~10분 걸려서 12:55 에 backend 가 뜨면 DB connect fail
# → circuit breaker rollback 발동. 13:05 면 RDS 가 거의 ready 상태.
resource "aws_scheduler_schedule" "ecs_asg_start" {
  count      = local.schedule_count
  name       = "${local.name_prefix}-ecs-asg-start"
  group_name = "default"

  schedule_expression          = "cron(05 13 ? * MON-FRI *)"
  schedule_expression_timezone = "Asia/Seoul"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:autoscaling:updateAutoScalingGroup"
    role_arn = aws_iam_role.scheduler.arn
    input = jsonencode({
      AutoScalingGroupName = aws_autoscaling_group.ecs.name
      DesiredCapacity      = var.ecs_desired_instances
      MinSize              = 0
    })
  }
}
