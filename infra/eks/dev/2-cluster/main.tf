############################################################
# 2-cluster 모듈 호출 — network output 주입
############################################################
module "cluster" {
  source = "../../../modules/eks-cluster"

  project      = var.project
  env          = var.env
  aws_region   = var.aws_region
  name_prefix  = "${var.project}-${var.env}"
  cluster_name = "${var.project}-${var.env}" # drawe-dev
  k8s_version  = var.k8s_version

  # 0단계 브리지 output (ECS state)
  vpc_id             = data.terraform_remote_state.ecs_dev.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.ecs_dev.outputs.private_subnet_ids
  public_subnet_ids  = data.terraform_remote_state.ecs_dev.outputs.public_subnet_ids

  # system NG (dev: 작게)
  system_instance_types = ["t4g.large"]
  system_desired_size   = 2
  system_min_size        = 2
  system_max_size        = 3

  # Prefix Delegation + WARM (dev 값)
  enable_prefix_delegation = true
  warm_prefix_target       = "1"
  warm_ip_target           = "5"
  enable_pod_eni           = true # 3-platform Security Groups for Pods 전제

  cluster_admin_principal_arns = var.cluster_admin_principal_arns
}
