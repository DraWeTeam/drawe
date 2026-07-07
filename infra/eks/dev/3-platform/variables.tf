variable "project" {
  type    = string
  default = "drawe"
}
variable "env" {
  type    = string
  default = "dev"
}
variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}

variable "gitops_repo_url" {
  description = "k8s/ 매니페스트 레포 URL. 5-apps 단계(root app on)부터 필요."
  type        = string
  default     = ""
}
variable "gitops_repo_path" {
  type    = string
  default = "k8s/overlays/dev"
}
variable "gitops_target_revision" {
  type    = string
  default = "main"
}

# 이번 3-platform 단계: false. 앱 매니페스트 올린 뒤 true 로.
variable "enable_argocd_root_app" {
  type    = bool
  default = false
}
