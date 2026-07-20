############################################################
# DB Subnet Group
############################################################
resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_c.id]
  tags       = { Name = "${local.name_prefix}-db-subnet" }
}

############################################################
# DB Password
#
# var.db_password 비어있으면 random_password 자동 생성, 아니면 그 값 사용.
# locals.db_password 가 최종 값 - RDS, SSM 모두 이 local 참조.
############################################################
resource "random_password" "db" {
  count            = var.db_password == "" ? 1 : 0
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

locals {
  db_password = var.db_password != "" ? var.db_password : random_password.db[0].result
}

############################################################
# RDS MySQL - Multi-AZ
############################################################
resource "aws_db_instance" "main" {
  identifier     = "${local.name_prefix}-mysql"
  engine         = "mysql"
  engine_version = "8.4.8"
  instance_class = var.db_instance_class

  allocated_storage     = 50
  max_allocated_storage = 200
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = local.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  multi_az            = var.rds_multi_az # ⌁ default false (비용 절감), 나중에 in-place 로 toggle 가능
  publicly_accessible = false

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "18:00-19:00"
  maintenance_window      = "sun:19:00-sun:20:00"

  # ⌁ prod: final snapshot 필수, deletion protection ON
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name_prefix}-mysql-final-${formatdate("YYYYMMDD-hhmm", timestamp())}"
  deletion_protection       = true

  performance_insights_enabled = false # db.t4g.small 클래스에서는 PI 미지원
  # performance_insights_retention_period = 7

  parameter_group_name = aws_db_parameter_group.main.name

  enabled_cloudwatch_logs_exports = ["error", "slowquery"]

  tags = { Name = "${local.name_prefix}-mysql" }

  lifecycle {
    # ★ password 를 무시한다 — TF_VAR_db_password 없이 plan 하면 random_password.db[0] 이
    #   새로 생성되어 "암호를 바꾸겠다"는 diff 가 뜬다. 그대로 apply 하면 RDS 암호가
    #   로테이션되고 앱은 SSM 의 옛 값을 들고 있어 즉시 접속 불가가 된다.
    #   암호는 SSM 이 사실상의 소스이며, 회전은 별도 절차로 수행한다.
    #   (elasticache 의 ignore_changes=[auth_token] 과 동일한 의도)
    ignore_changes = [final_snapshot_identifier, password]
  }
}

resource "aws_db_parameter_group" "main" {
  name   = "${local.name_prefix}-mysql-params"
  family = "mysql8.4"

  parameter {
    name  = "character_set_server"
    value = "utf8mb4"
  }
  parameter {
    name  = "collation_server"
    value = "utf8mb4_unicode_ci"
  }
  parameter {
    name  = "time_zone"
    value = "Asia/Seoul"
  }

  parameter {
    name  = "slow_query_log"
    value = "1"
  }

  parameter {
    name  = "long_query_time"
    value = "1" # prod 는 1초 이상 모두 slow 로 기록
  }

  parameter {
    name  = "log_output"
    value = "FILE"
  }

  tags = { Name = "${local.name_prefix}-mysql-params" }
}
