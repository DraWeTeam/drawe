############################################################
# EKS 컷오버 — api.drawe.xyz / grafana.drawe.xyz DNS 대상 ALB 자동탐색 (재현성)
#
# 우선순위(local.api_target_alb_dns):
#   1) api_alb_dns_override (수동/긴급)
#   2) eks_cutover=true → EKS Ingress ALB (태그 자동탐색)
#   3) ECS ALB (aws_lb.main)
# 롤백: terraform apply -var='eks_cutover=false'  → ECS ALB. (data 도 count=0 스킵)
#
# grafana.drawe.xyz(local.grafana_target_alb_dns):
#   eks_cutover=true 이고 override 가 비었을 때만 EKS ALB(grafana Ingress 가
#   group.name=drawe-prod 로 같은 ALB 에 합류) → 그 외엔 ECS ALB(aws_lb.main).
#   api 와 같은 ALB 를 공유하므로 별도 ALB/탐색 불필요.
############################################################

variable "eks_cutover" {
  description = "true 면 api 를 EKS Ingress ALB(태그 탐색)로. false 면 ECS ALB. override 가 비었을 때만 적용."
  type        = bool
  default     = true
}

variable "api_alb_dns_override" {
  description = "수동/긴급 ALB DNS 강제 지정. 비우면(\"\") eks_cutover 규칙 적용."
  type        = string
  default     = ""
}

# AWS Load Balancer Controller 가 group ingress(group.name=drawe-prod)로 만든 ALB 를 태그로 탐색.
data "aws_lb" "eks_ingress" {
  count = (var.eks_cutover && var.api_alb_dns_override == "") ? 1 : 0

  tags = {
    "elbv2.k8s.aws/cluster"    = "drawe-prod"
    "ingress.k8s.aws/stack"    = "drawe-prod" # = group.name
    "ingress.k8s.aws/resource" = "LoadBalancer"
  }
}

locals {
  api_target_alb_dns = (
    var.api_alb_dns_override != "" ? var.api_alb_dns_override :
    var.eks_cutover ? data.aws_lb.eks_ingress[0].dns_name :
    aws_lb.main.dns_name
  )

  # grafana 는 api 와 같은 EKS ALB(group.name=drawe-prod) 공유.
  # data.aws_lb.eks_ingress 는 (eks_cutover && override=="") 일 때만 존재(count=1)하므로
  # 동일 조건에서만 [0] 참조 → index 안전. 그 외엔 ECS ALB 유지(롤백/부분적용 안전).
  grafana_target_alb_dns = (
    var.eks_cutover && var.api_alb_dns_override == "" ?
    data.aws_lb.eks_ingress[0].dns_name :
    aws_lb.main.dns_name
  )
}
