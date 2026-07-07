############################################################
# ArgoCD (helm) + app-of-apps (GitOps 확정)
#
# 이 레이어는 ArgoCD "설치(부트스트랩)"까지만 담당한다.
# 이후 앱 배포는 root Application 이 watch 하는 k8s/overlays/<env> 를 통해
# ArgoCD 가 선언적으로 동기화한다(Terraform 은 앱을 관리하지 않음).
############################################################
resource "helm_release" "argocd" {
  depends_on = [helm_release.alb_controller]
  name             = "argocd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = var.argocd_chart_version
  namespace        = var.argocd_namespace
  create_namespace = true

  # arm64 노드 + 비-HA(dev). prod 는 redis-ha 등 별도 values 권장.
  set {
    name  = "global.nodeSelector.kubernetes\\.io/arch"
    value = "arm64"
  }
  set {
    name  = "configs.params.server\\.insecure"
    value = "true" # ALB 가 TLS 종단 → argocd-server 는 평문(내부). Ingress 는 k8s 매니페스트에서.
  }
  # 모든 sub-chart (controller / server / repoServer / applicationSet / dex / redis) 에 전파
  set {
    name  = "global.tolerations[0].key"
    value = "CriticalAddonsOnly"
  }
  set {
    name  = "global.tolerations[0].operator"
    value = "Exists"
  }
  set {
    name  = "global.tolerations[0].effect"
    value = "NoSchedule"
  }

}

# Root Application — app-of-apps. overlays/<env> 디렉터리(여러 앱 Application 포함)를 동기화.
#
# ★ enable_argocd_root_app 플래그로 게이트(기본 false).
#   이번 3-platform 단계에선 k8s/overlays/<env> 매니페스트가 아직 없으므로 끈다.
#   나중 앱(5-apps) 단계에서 매니페스트를 올린 뒤 true 로 켜면 ArgoCD 가 동기화 시작.
resource "kubectl_manifest" "root_app" {
  count     = var.enable_argocd_root_app ? 1 : 0
  yaml_body = <<-YAML
    apiVersion: argoproj.io/v1alpha1
    kind: Application
    metadata:
      name: drawe-${var.env}-root
      namespace: ${var.argocd_namespace}
    spec:
      project: default
      source:
        repoURL: ${var.gitops_repo_url}
        targetRevision: ${var.gitops_target_revision}
        path: ${var.gitops_repo_path}
      destination:
        server: https://kubernetes.default.svc
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
  YAML

  depends_on = [helm_release.argocd]
}
