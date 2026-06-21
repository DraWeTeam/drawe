############################################################
# RDS / 캐시 ← pod SG 접근 허용 (계획서 §5-C, A안)
#   ECS 소유 SG 에 "pod SG 의 3306/6379" ingress 를 별도 리소스로 추가.
#   (ECS state 의 SG 리소스 자체는 안 건드림 → 공존 안전)
############################################################
resource "aws_security_group_rule" "rds_from_pods" {
  type                     = "ingress"
  description              = "MySQL from EKS pods (security groups for pods)"
  from_port                = 3306
  to_port                  = 3306
  protocol                 = "tcp"
  security_group_id        = data.terraform_remote_state.ecs_prod.outputs.rds_sg_id
  source_security_group_id = module.platform.pods_db_security_group_id
}

resource "aws_security_group_rule" "cache_from_pods" {
  type                     = "ingress"
  description              = "Valkey/Redis from EKS pods"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = data.terraform_remote_state.ecs_prod.outputs.valkey_sg_id
  source_security_group_id = module.platform.pods_db_security_group_id
}
