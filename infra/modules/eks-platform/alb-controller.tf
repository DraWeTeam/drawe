############################################################
# AWS Load Balancer Controller (helm)
#
# Ingress(class=alb) 를 보고 ALB/TargetGroup 을 자동 생성·관리한다.
# ECS 의 aws_lb + aws_lb_target_group(TF 관리)을 대체한다.
# 서브넷 자동탐색을 위해 caller 가 subnet 에 ELB role 태그를 단다(subnet-tags.tf).
############################################################
resource "helm_release" "alb_controller" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = var.alb_controller_chart_version
  namespace  = "kube-system"

  set {
    name  = "clusterName"
    value = var.cluster_name
  }
  set {
    name  = "region"
    value = var.aws_region
  }
  set {
    name  = "vpcId"
    value = var.vpc_id
  }
  # SA 를 차트가 만들고 IRSA role 을 어노테이션으로 연결
  set {
    name  = "serviceAccount.create"
    value = "true"
  }
  set {
    name  = "serviceAccount.name"
    value = "aws-load-balancer-controller"
  }
  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = aws_iam_role.alb_controller.arn
  }
  # arm64 노드에서 구동
  set {
    name  = "nodeSelector.kubernetes\\.io/arch"
    value = "arm64"
  }

  depends_on = [aws_iam_role_policy_attachment.alb_controller]
}
