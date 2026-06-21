############################################################
# EKS 컷오버 — api-dev DNS 대상 ALB 자동탐색 (재현성)
#
# 기존엔 api_alb_dns_override 를 terraform.tfvars(.gitignore)에 넣어 컷오버 →
# tfvars 없이 apply 하면 override="" → DNS 가 죽은 ECS ALB 로 원복.
# 여기선 EKS Ingress(group.name=drawe-dev) ALB 를 태그로 탐색해 하드코딩·tfvars
# 의존을 없애고, eks_cutover 기본값 true 를 코드에 고정한다.
#
# 우선순위(local.api_target_alb_dns):
#   1) api_alb_dns_override(수동, 긴급)  >  2) eks_cutover=true → EKS ALB(태그)  >  3) ECS ALB
# 롤백: -var='eks_cutover=false' (또는 default=false) → ECS ALB. data 도 count=0 스킵.
############################################################

variable "eks_cutover" {
  description = "true 면 api-dev 를 EKS Ingress ALB(태그 자동탐색)로. false 면 ECS ALB. override 가 비었을 때만 적용."
  type        = bool
  default     = true
}

# AWS Load Balancer Controller 가 group ingress(group.name=drawe-dev)로 만든 ALB 를 태그로 탐색.
data "aws_lb" "eks_ingress" {
  count = (var.eks_cutover && var.api_alb_dns_override == "") ? 1 : 0

  tags = {
    "elbv2.k8s.aws/cluster"    = "drawe-dev"
    "ingress.k8s.aws/stack"    = "drawe-dev" # = group.name
    "ingress.k8s.aws/resource" = "LoadBalancer"
  }
}

locals {
  api_target_alb_dns = (
    var.api_alb_dns_override != "" ? var.api_alb_dns_override :
    var.eks_cutover ? data.aws_lb.eks_ingress[0].dns_name :
    aws_lb.main.dns_name
  )
}
