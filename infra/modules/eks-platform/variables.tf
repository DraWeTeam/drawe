############################################################
# modules/eks-platform — inputs
#
# 이 모듈은 "2-cluster 가 이미 apply 되어 있다"고 가정하고, cluster 정보를
# 변수로 받는다(자기완결). caller(eks/dev/3-platform)가 remote_state 로
# 2-cluster·ECS(network) output 을 읽어 아래 값을 채운다.
############################################################

# ── 일반 ──────────────────────────────────────────────
variable "project" {
  type = string # 예: drawe
}
variable "env" {
  type = string # dev | prod
}
variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}

variable "name_prefix" {
  description = "리소스 이름 접두사 (예: drawe-dev). 미지정 시 project-env."
  type        = string
  default     = ""
}

variable "ssm_path_prefix" {
  description = "ESO 가 읽을 SSM 경로 접두사. 예: /drawe/dev"
  type        = string
}

# ── 2-cluster 에서 주입되는 값 ─────────────────────────
variable "cluster_name"              { type = string }
variable "cluster_oidc_provider_arn" { type = string }   # aws_iam_openid_connect_provider.this.arn
variable "cluster_oidc_provider_url" { type = string }   # issuer (https:// 제거된 형태: oidc.eks.<region>.amazonaws.com/id/XXXX)
variable "node_security_group_id"    { type = string }   # 2-cluster system NG / cluster SG (pod SG ingress·Karpenter 디스커버리)

# ── 네트워크(ECS stack 에서 주입) ──────────────────────
variable "vpc_id"             { type = string }
variable "private_subnet_ids" { type = list(string) }

# ── Karpenter NodePool 정책 ────────────────────────────
variable "karpenter_capacity_types" {
  description = "Karpenter 가 띄울 capacity type"
  type        = list(string)
  default     = ["spot", "on-demand"]
}

variable "karpenter_arch" {
  description = "노드 아키텍처. DraWe 이미지가 전부 arm64 → arm64 고정."
  type        = list(string)
  default     = ["arm64"]
}

variable "karpenter_instance_families" {
  description = "허용 인스턴스 패밀리(Graviton). guide(5GB) 헤드룸 위해 m/c/r 6g 이상."
  type        = list(string)
  default     = ["m6g", "m7g", "c6g", "c7g", "r6g"]
}

variable "karpenter_cpu_limit" {
  description = "NodePool 총 vCPU 상한(폭주 방지). prefix delegation 있어도 무한 scale 금지."
  type        = string
  default     = "1000"
}

variable "node_volume_size_gib" {
  description = "워커 노드 EBS gp3 크기. guide 이미지(torch+open_clip) 가 크므로 여유."
  type        = number
  default     = 60
}

# ── GitOps(ArgoCD) ────────────────────────────────────
variable "gitops_repo_url" {
  description = "k8s/ 매니페스트 Git 레포 URL. enable_argocd_root_app=true 일 때만 필요."
  type        = string
  default     = ""
}

variable "gitops_repo_path" {
  description = "레포 내 overlay 경로. 예: k8s/overlays/dev"
  type        = string
}

variable "gitops_target_revision" {
  description = "추적할 브랜치/태그"
  type        = string
  default     = "main"
}

variable "argocd_namespace" {
  type    = string
  default = "argocd"
}

# ── Helm 차트 버전 (apply 전 최신 호환 버전 확인 권장) ──
# ALB Controller: v3.0.0 부터 chart 버전이 LBC 버전과 일치(LBC2.17=chart1.17).
#   artifacthub.io/packages/helm/aws/aws-load-balancer-controller 에서 최신 확인.
variable "alb_controller_chart_version" {
  type    = string
  default = "1.17.1"
}
variable "external_secrets_chart_version" {
  type    = string
  default = "0.14.3"
}
variable "karpenter_chart_version" {
  type    = string
  default = "1.6.3" # karpenter.sh/docs/upgrading 에서 최신 v1.x 확인
}
variable "argocd_chart_version" {
  type    = string
  default = "8.1.3"
}

variable "tags" {
  type    = map(string)
  default = {}
}

# ── ArgoCD root app 게이트 ───────────────────────────────
# 3-platform 단계에선 false (k8s/overlays 아직 없음). 5-apps 단계에서 true 로.
variable "enable_argocd_root_app" {
  type    = bool
  default = false
}
