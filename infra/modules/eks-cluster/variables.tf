############################################################
# modules/eks-cluster — inputs
############################################################
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
  type    = string
  default = ""
}

variable "cluster_name" {
  description = "EKS 클러스터 이름. 비우면 <project>-<env>."
  type        = string
  default     = ""
}
variable "k8s_version" {
  description = "EKS 쿠버네티스 버전. apply 전 콘솔/문서에서 지원 버전 확인 권장."
  type        = string
  default     = "1.33"
}

# ── 네트워크 (ECS stack remote_state 에서 주입) ──
variable "vpc_id" {
  type = string
}
variable "private_subnet_ids" {
  type = list(string)
}
variable "public_subnet_ids" {
  type = list(string)
}

# ── API 엔드포인트 노출 ──
variable "endpoint_public_access" {
  description = "API 서버 퍼블릭 엔드포인트 (kubectl 을 노트북에서 쓰려면 true)."
  type        = bool
  default     = true
}
variable "public_access_cidrs" {
  description = "퍼블릭 엔드포인트 허용 CIDR. 운영에선 팀 IP 로 좁히길 권장."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# ── system 노드그룹 (플랫폼 pod 상주용, arm64) ──
variable "system_instance_types" {
  description = "system NG 인스턴스 타입(Graviton arm64). ArgoCD·컨트롤러 헤드룸."
  type        = list(string)
  default     = ["t4g.large"]
}
variable "system_desired_size" {
  type    = number
  default = 2
}
variable "system_min_size" {
  type    = number
  default = 2
}
variable "system_max_size" {
  type    = number
  default = 3
}
variable "system_disk_size_gib" {
  type    = number
  default = 30
}

# ── VPC CNI: Prefix Delegation + WARM (계획서 §5-A) ──
variable "enable_prefix_delegation" {
  type    = bool
  default = true
}
variable "warm_prefix_target" {
  description = "미리 확보할 /28 prefix 개수. dev=1 / prod=2~3."
  type        = string
  default     = "1"
}
variable "warm_ip_target" {
  description = "보조 IP 타깃. dev=5 / prod=10."
  type        = string
  default     = "5"
}
variable "enable_pod_eni" {
  description = "Security Groups for Pods(3-platform §5-C A안) 사용을 위해 true."
  type        = bool
  default     = true
}

# ── 클러스터 관리자 (선택) ──
variable "cluster_admin_principal_arns" {
  description = "추가로 cluster-admin 을 줄 IAM principal ARN 목록(팀원/CI role 등)."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
