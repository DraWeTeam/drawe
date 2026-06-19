############################################################
# External Secrets Operator (helm) + ClusterSecretStore(SSM)
#
# SSM /<project>/<env>/* 를 K8s Secret 으로 동기화한다(SSM 이 원본).
# 앱 매니페스트(k8s/base/*)의 ExternalSecret 이 이 store 를 참조한다.
############################################################
resource "helm_release" "external_secrets" {
  name             = "external-secrets"
  repository       = "https://charts.external-secrets.io"
  chart            = "external-secrets"
  version          = var.external_secrets_chart_version
  namespace        = "external-secrets"
  create_namespace = true

  set {
    name  = "installCRDs"
    value = "true"
  }
  set {
    name  = "serviceAccount.create"
    value = "true"
  }
  set {
    name  = "serviceAccount.name"
    value = "external-secrets"
  }
  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = aws_iam_role.external_secrets.arn
  }
  set {
    name  = "nodeSelector.kubernetes\\.io/arch"
    value = "arm64"
  }
}

# ClusterSecretStore — SSM Parameter Store(AWS provider, IRSA SA 인증)
# CRD 는 위 helm 이 설치 → kubectl_manifest 로 적용(plan 검증 회피).
resource "kubectl_manifest" "cluster_secret_store" {
  yaml_body = <<-YAML
    apiVersion: external-secrets.io/v1beta1
    kind: ClusterSecretStore
    metadata:
      name: aws-ssm
    spec:
      provider:
        aws:
          service: ParameterStore
          region: ${var.aws_region}
          auth:
            jwt:
              serviceAccountRef:
                name: external-secrets
                namespace: external-secrets
  YAML

  depends_on = [helm_release.external_secrets]
}
