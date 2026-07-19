############################################################
# metrics-server (helm)
#
# HPA(kubectl get hpa)의 cpu/memory 타깃 계산에 필요한 Resource Metrics API
# (metrics.k8s.io)를 제공한다. 이게 없으면 HPA 는 TARGETS 를 <unknown> 으로
# 두고 스케일링을 하지 못한다(k8s/base 의 HPA manifest 는 있으나 구동 컴포넌트 부재).
# alb-controller·external-secrets 와 동일하게 이 모듈이 helm_release 로 관리한다.
############################################################
resource "helm_release" "metrics_server" {
  depends_on = [helm_release.alb_controller]

  name       = "metrics-server"
  repository = "https://kubernetes-sigs.github.io/metrics-server/"
  chart      = "metrics-server"
  version    = var.metrics_server_chart_version
  namespace  = "kube-system"

  # arm64 노드에서 구동 (alb-controller·external-secrets 와 동일)
  set {
    name  = "nodeSelector.kubernetes\\.io/arch"
    value = "arm64"
  }

  # 시스템 NG 의 CriticalAddonsOnly:NoSchedule taint 허용
  # (modules/eks-cluster/system-nodegroup.tf 의 SGP 보호 taint)
  set {
    name  = "tolerations[0].key"
    value = "CriticalAddonsOnly"
  }
  set {
    name  = "tolerations[0].operator"
    value = "Exists"
  }
  set {
    name  = "tolerations[0].effect"
    value = "NoSchedule"
  }

  # --kubelet-insecure-tls: metrics-server 는 각 kubelet 의 /metrics/resource 를
  # HTTPS 로 스크레이프하며 kubelet serving cert 를 검증한다. EKS + Karpenter 로
  # 프로비저닝되는 워커 노드는 kubelet serving cert 가 클러스터 CA 로 서명·로테이트
  # 되지 않아(SAN 에 노드 IP 부재) 검증이 실패하고 metrics 수집이 막히는 사례가 흔하다
  # ("x509: cannot validate certificate ... no IP SANs"). 이 플래그로 kubelet cert
  # 검증을 생략한다. control-plane<->kubelet 은 VPC private 서브넷 내부 트래픽이며
  # 프록시 대상이 노드 자신이므로 위험은 제한적이다. 근본 해결(kubelet serving cert
  # 로테이션 + CSR 승인)로 대체하려면 이 args 를 제거하면 된다.
  set {
    name  = "args[0]"
    value = "--kubelet-insecure-tls"
  }
}
