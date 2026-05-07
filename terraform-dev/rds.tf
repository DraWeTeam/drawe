# DB Subnet Group
resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_c.id]
  tags       = { Name = "${local.name_prefix}-db-subnet" }
}

############################################################
# DB Password (Terraform 이 생성·관리)
#
# 이전 버전 버그: SSM SecureString 에 placeholder 가 남아있고
# RDS 가 그 placeholder 로 만들어지는 문제 → 사용자가 SSM 만 update 하면
# RDS 비밀번호와 영원히 mismatch.
#
# 비밀번호 처리:
# - var.db_password 비어있으면 → random_password 가 32자 자동 생성
# - var.db_password 채워져 있으면 → 그 값 사용 (환경변수 TF_VAR_db_password 권장)
# locals.db_password 가 최종 값. RDS, SSM, Backend env 모두 이 local 참조.
############################################################
resource "random_password" "db" {
  count   = var.db_password == "" ? 1 : 0
  length  = 32
  special = true
  # MySQL/Spring 경로에서 escape 이슈 일으키는 문자 제외
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

locals {
  db_password = var.db_password != "" ? var.db_password : random_password.db[0].result
}

# RDS MySQL — db.t4g.micro
resource "aws_db_instance" "main" {
  identifier     = "${local.name_prefix}-mysql"
  engine         = "mysql"
  engine_version = "8.4.8"
  instance_class = var.db_instance_class

  allocated_storage     = 20
  max_allocated_storage = 40
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = local.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  multi_az            = false
  publicly_accessible = false

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "04:30-05:30"   # UTC = KST 13:30~14:30, RDS start 직후 30분 — stop/start 스케줄과 정합
  maintenance_window      = "sun:19:00-sun:20:00"

  skip_final_snapshot       = true
  final_snapshot_identifier = "${local.name_prefix}-mysql-final"
  deletion_protection       = false

  parameter_group_name = aws_db_parameter_group.main.name

  enabled_cloudwatch_logs_exports = ["error", "slowquery"]

  tags = { Name = "${local.name_prefix}-mysql" }
}

# Parameter Group (utf8mb4)
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
    value = "2"
  }

  parameter {
    name  = "log_output"
    value = "FILE"
  }

  tags = { Name = "${local.name_prefix}-mysql-params" }
}
