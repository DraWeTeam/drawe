############################################################
# eks/dev/2-cluster — 독립 state (계획서 §4)
# ECS(dev) state 와 다른 key. 서로의 apply 가 안 건드림.
############################################################
terraform {
  required_version = ">= 1.5"

  backend "s3" {
    bucket       = "drawe-terraform-state-570515227314" # dev 계정 state 버킷 (ECS 와 동일 버킷, key 분리)
    key          = "eks/dev/cluster/terraform.tfstate"
    region       = "ap-northeast-2"
    use_lockfile = true
    encrypt      = true
  }
}
