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

variable "k8s_version" {
  type    = string
  default = "1.35"
}

# 추가 cluster-admin (팀원/CI IAM role ARN). 비워두면 생성자만 admin.
variable "cluster_admin_principal_arns" {
  type    = list(string)
  default = []
}
