############################################################
# modules/eks-platform — locals
############################################################
locals {
  name_prefix = var.name_prefix != "" ? var.name_prefix : "${var.project}-${var.env}"

  # OIDC issuer 의 host/path (IRSA trust 조건의 sub/aud 키 생성용)
  oidc_url = replace(var.cluster_oidc_provider_url, "https://", "")

  common_tags = merge({
    Project     = var.project
    Environment = var.env
    ManagedBy   = "terraform"
    Layer       = "3-platform"
  }, var.tags)

  # Karpenter 디스커버리 태그 값(= cluster 이름). caller 가 subnet/SG 에 이 태그를 붙인다.
  discovery_tag = var.cluster_name
}
