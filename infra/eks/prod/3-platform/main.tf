############################################################
# 3-platform 모듈 호출 — network·cluster output 주입 (prod)
############################################################
module "platform" {
  source = "../../../modules/eks-platform"

  project         = var.project
  env             = var.env
  aws_region      = var.aws_region
  name_prefix     = "${var.project}-${var.env}"
  ssm_path_prefix = "/${var.project}/${var.env}" # ESO 가 읽을 SSM 경로 (/drawe/prod)

  # 2-cluster output
  cluster_name              = data.terraform_remote_state.eks_cluster_prod.outputs.cluster_name
  cluster_oidc_provider_arn = data.terraform_remote_state.eks_cluster_prod.outputs.oidc_provider_arn
  cluster_oidc_provider_url = data.terraform_remote_state.eks_cluster_prod.outputs.oidc_provider_url
  node_security_group_id    = data.terraform_remote_state.eks_cluster_prod.outputs.node_security_group_id

  # network(ECS prod) output
  vpc_id             = data.terraform_remote_state.ecs_prod.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.ecs_prod.outputs.private_subnet_ids

  # Karpenter (prod: on-demand 우선 + spot 허용, dev 보다 넉넉한 상한)
  karpenter_capacity_types    = ["on-demand", "spot"]
  karpenter_cpu_limit         = "600"
  karpenter_instance_families = ["t4g", "m6g", "m7g", "c6g", "c7g", "r6g"]
  karpenter_instance_sizes    = ["small", "medium", "large", "xlarge", "2xlarge", "4xlarge"]

  # GitOps
  gitops_repo_url        = var.gitops_repo_url
  gitops_repo_path       = var.gitops_repo_path
  gitops_target_revision = var.gitops_target_revision
  enable_argocd_root_app = var.enable_argocd_root_app # 이번 단계 false
}
