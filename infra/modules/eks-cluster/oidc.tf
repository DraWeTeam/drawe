############################################################
# IRSA용 OIDC provider
#
# 3-platform 이 이 provider 를 federated principal 로 써서 컨트롤러 SA 별
# IAM role 을 assume 한다(ALB controller / ESO / Karpenter).
############################################################
data "tls_certificate" "oidc" {
  url = aws_eks_cluster.this.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "this" {
  url             = aws_eks_cluster.this.identity[0].oidc[0].issuer
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.oidc.certificates[0].sha1_fingerprint]
  tags            = local.common_tags
}
