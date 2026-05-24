############################################################
# ElastiCache for Valkey (Multi-AZ)
#
# dev 와 차이: EC2 단일 Valkey → Replication Group (primary + replica)
# 자동 failover, 자동 백업, AWS 가 patch 관리
############################################################

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name_prefix}-cache-subnet"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_c.id]

  tags = { Name = "${local.name_prefix}-cache-subnet" }
}

resource "random_password" "valkey_auth" {
  count   = var.valkey_auth_token == "" ? 1 : 0
  length  = 32
  special = false
}

locals {
  valkey_auth_token = var.valkey_auth_token != "" ? var.valkey_auth_token : random_password.valkey_auth[0].result
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${local.name_prefix}-valkey"
  description          = "Valkey for ${local.name_prefix}"

  engine          = "valkey"
  engine_version  = "8.0"
  node_type       = var.elasticache_node_type
  port            = 6379
  parameter_group_name = "default.valkey8"

  num_cache_clusters         = 1 + var.elasticache_replicas   # primary + replicas
  automatic_failover_enabled = var.elasticache_replicas > 0
  multi_az_enabled           = var.elasticache_replicas > 0

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.valkey.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = local.valkey_auth_token

  snapshot_retention_limit = 7
  snapshot_window          = "18:00-19:00"   # KST 03:00~04:00
  maintenance_window       = "sun:19:00-sun:20:00"

  apply_immediately = false

  tags = { Name = "${local.name_prefix}-valkey" }

  lifecycle {
    ignore_changes = [auth_token]   # 회전은 별도 절차로
  }
}
