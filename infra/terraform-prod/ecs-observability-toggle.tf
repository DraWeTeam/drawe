############################################################
# ECS 관측 스택(Loki/Tempo/Grafana) on/off 토글
#
# 배경: ECS Loki/Tempo 는 EKS 와 동일한 S3 버킷(drawe-prod-loki-chunks /
#   tempo-blocks)을, ECS Grafana 는 동일한 RDS 'grafana' 스키마를 쓴다.
#   EKS 관측을 올린 뒤에도 ECS 관측이 desired_count=1 로 돌면 같은
#   상태 저장소에 writer 가 둘 → S3 compaction/락·스키마 동시쓰기 충돌.
#
# 설계: ECS 정의는 보존(롤백 가능)하되 실행만 끈다.
#   - 기본 true  → 현재 동작 그대로(이 패치 적용만으론 변화 없음, no-op).
#   - 관측을 EKS 로 컷오버할 때 false 로 내려 apply → ECS Loki/Tempo/Grafana 정지.
#   - 롤백 시 다시 true.
#
# observability.tf 의 loki/tempo/grafana 서비스 desired_count 가
#   (var.prod_enabled && var.ecs_observability_enabled) ? 1 : 0 로 게이트됨.
############################################################
variable "ecs_observability_enabled" {
  description = "ECS self-host 관측(Loki/Tempo/Grafana) 실행 여부. EKS 관측 컷오버 시 false. 정의는 항상 보존."
  type        = bool
  default     = true
}
