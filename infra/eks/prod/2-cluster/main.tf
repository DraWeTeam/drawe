############################################################
# 2-cluster 모듈 호출 — network output 주입 (prod)
############################################################
module "cluster" {
  source = "../../../modules/eks-cluster"

  project      = var.project
  env          = var.env
  aws_region   = var.aws_region
  name_prefix  = "${var.project}-${var.env}"
  cluster_name = "${var.project}-${var.env}" # drawe-prod
  k8s_version  = var.k8s_version

  # Phase 0 브리지 output (ECS prod state)
  vpc_id             = data.terraform_remote_state.ecs_prod.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.ecs_prod.outputs.private_subnet_ids
  public_subnet_ids  = data.terraform_remote_state.ecs_prod.outputs.public_subnet_ids

  # API 엔드포인트 (prod: 가능하면 CIDR 제한)
  endpoint_public_access = var.endpoint_public_access
  public_access_cidrs    = var.public_access_cidrs

  # system NG (플랫폼 plane 상주: ALB controller·ESO·Karpenter·ArgoCD).
  # 앱 노드는 Karpenter 가 담당하므로 system 은 작게 유지.
  system_instance_types = ["t4g.large"]
  system_desired_size   = 2
  system_min_size       = 2
  system_max_size       = 3

  # Prefix Delegation + WARM (prod 값 — dev보다 헤드룸 ↑)
  enable_prefix_delegation = true
  warm_prefix_target       = "2"
  warm_ip_target           = "10"
  enable_pod_eni           = true # 3-platform Security Groups for Pods 전제

  cluster_admin_principal_arns = var.cluster_admin_principal_arns
}
