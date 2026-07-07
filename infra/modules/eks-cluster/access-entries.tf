############################################################
# (선택) 추가 cluster-admin 매핑 — Access Entry(API 모드)
#
# 클러스터 생성자는 bootstrap 으로 자동 admin 이다(cluster.tf).
# 팀원·CI(GitHub deploy role) 등을 추가로 admin 으로 주려면
# var.cluster_admin_principal_arns 에 ARN 을 넣는다.
############################################################
resource "aws_eks_access_entry" "admin" {
  for_each      = toset(var.cluster_admin_principal_arns)
  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "admin" {
  for_each      = toset(var.cluster_admin_principal_arns)
  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_access_entry.admin]
}
