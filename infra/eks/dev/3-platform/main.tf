############################################################
# 3-platform 모듈 호출 — network·cluster output 을 주입
############################################################
module "platform" {
  source = "../../../modules/eks-platform"

  project         = var.project
  env             = var.env
  aws_region      = var.aws_region
  name_prefix     = "${var.project}-${var.env}"
  ssm_path_prefix = "/${var.project}/${var.env}" # ESO 가 읽을 SSM 경로 (/drawe/dev)

  # 2-cluster output
  cluster_name              = data.terraform_remote_state.eks_cluster_dev.outputs.cluster_name
  cluster_oidc_provider_arn = data.terraform_remote_state.eks_cluster_dev.outputs.oidc_provider_arn
  cluster_oidc_provider_url = data.terraform_remote_state.eks_cluster_dev.outputs.oidc_provider_url
  node_security_group_id    = data.terraform_remote_state.eks_cluster_dev.outputs.node_security_group_id

  # network(ECS) output
  vpc_id             = data.terraform_remote_state.ecs_dev.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.ecs_dev.outputs.private_subnet_ids

  # Karpenter (dev: spot 위주 허용)
  karpenter_capacity_types = ["spot", "on-demand"]
  karpenter_cpu_limit      = "200" # dev 는 작게

  # GitOps
  gitops_repo_url        = var.gitops_repo_url
  gitops_repo_path       = var.gitops_repo_path
  gitops_target_revision = var.gitops_target_revision
  enable_argocd_root_app = var.enable_argocd_root_app # 이번 단계 false
}
