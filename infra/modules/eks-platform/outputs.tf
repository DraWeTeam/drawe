############################################################
# modules/eks-platform — outputs
############################################################
output "pods_db_security_group_id" {
  description = "RDS/캐시 접근 pod 전용 SG. caller 가 RDS SG ingress 에 사용, k8s SecurityGroupPolicy 가 참조."
  value       = aws_security_group.pods_db.id
}

output "alb_controller_role_arn"  { value = aws_iam_role.alb_controller.arn }
output "external_secrets_role_arn" { value = aws_iam_role.external_secrets.arn }
output "karpenter_controller_role_arn" { value = aws_iam_role.karpenter_controller.arn }
output "karpenter_node_role_arn"  { value = aws_iam_role.karpenter_node.arn }
output "karpenter_node_role_name" { value = aws_iam_role.karpenter_node.name }
output "interruption_queue_name"  { value = aws_sqs_queue.karpenter_interruption.name }
output "argocd_namespace"         { value = var.argocd_namespace }

output "cluster_secret_store_name" {
  description = "앱 ExternalSecret 이 참조할 ClusterSecretStore 이름"
  value       = "aws-ssm"
}
