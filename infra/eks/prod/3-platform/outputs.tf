output "pods_db_security_group_id" { value = module.platform.pods_db_security_group_id }
output "cluster_secret_store_name" { value = module.platform.cluster_secret_store_name }
output "argocd_namespace"          { value = module.platform.argocd_namespace }
output "karpenter_node_role_name"  { value = module.platform.karpenter_node_role_name }
