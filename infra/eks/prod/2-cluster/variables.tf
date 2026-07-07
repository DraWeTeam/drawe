variable "project" {
  type    = string
  default = "drawe"
}
variable "env" {
  type    = string
  default = "prod"
}
variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}

variable "k8s_version" {
  type    = string
  default = "1.35"
}

# 추가 cluster-admin (팀원/CI IAM role ARN). 비워두면 클러스터 생성자만 admin.
variable "cluster_admin_principal_arns" {
  type    = list(string)
  default = []
}

# API 서버 퍼블릭 엔드포인트 (kubectl 을 노트북에서 쓰려면 true).
variable "endpoint_public_access" {
  type    = bool
  default = true
}

# 퍼블릭 엔드포인트 허용 CIDR.
# ★prod 권장: 팀 공인 IP 로 좁히기. 기본값 0.0.0.0/0 은 dev 와 동일 동작(편의).
#   본인 공인 IP:  curl -s https://checkip.amazonaws.com
variable "public_access_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}
