############################################################
# modules/eks-cluster — outputs
# (3-platform 이 remote_state 로 cluster_name/oidc/node_sg 를 읽는다)
############################################################
output "cluster_name" {
  value = aws_eks_cluster.this.name
}
output "cluster_endpoint" {
  value = aws_eks_cluster.this.endpoint
}
output "cluster_ca" {
  description = "base64 CA. provider 인증용."
  value       = aws_eks_cluster.this.certificate_authority[0].data
}
output "cluster_version" {
  value = aws_eks_cluster.this.version
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.this.arn
}
output "oidc_provider_url" {
  description = "issuer URL(https:// 포함). 3-platform 이 받아 https:// 제거 후 사용."
  value       = aws_iam_openid_connect_provider.this.url
}

output "cluster_security_group_id" {
  description = "EKS 가 자동 생성한 cluster SG. 노드/컨트롤플레인 통신용."
  value       = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
}
output "node_security_group_id" {
  description = "Karpenter SG 디스커버리·pod SG ingress 기준. = cluster SG."
  value       = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
}

output "node_group_role_arn" {
  value = aws_iam_role.node.arn
}
