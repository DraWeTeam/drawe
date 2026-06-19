############################################################
# 3-platform / 4-observability 가 remote_state 로 읽는 값
############################################################
output "cluster_name"             { value = module.cluster.cluster_name }
output "cluster_endpoint"         { value = module.cluster.cluster_endpoint }
output "cluster_ca" {
  value     = module.cluster.cluster_ca
  sensitive = true
}
output "oidc_provider_arn"        { value = module.cluster.oidc_provider_arn }
output "oidc_provider_url"        { value = module.cluster.oidc_provider_url }
output "cluster_security_group_id" { value = module.cluster.cluster_security_group_id }
output "node_security_group_id"   { value = module.cluster.node_security_group_id }
output "node_group_role_arn"      { value = module.cluster.node_group_role_arn }
