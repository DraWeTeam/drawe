############################################################
# eks/prod/2-cluster — 독립 state
# ECS(prod) state 와 다른 key. 서로의 apply 가 안 건드림.
############################################################
terraform {
  required_version = ">= 1.11"

  backend "s3" {
    bucket       = "drawe-tfstate-933832340498" # prod 계정 state 버킷(ECS 와 동일 버킷, key 만 분리)
    key          = "eks/prod/cluster/terraform.tfstate"
    region       = "ap-northeast-2"
    use_lockfile = true
    encrypt      = true
  }
}
