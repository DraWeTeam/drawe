############################################################
# 공유 인프라(network=ECS) output 읽기 — 0단계 브리지가 노출한 값
############################################################
data "terraform_remote_state" "ecs_dev" {
  backend = "s3"
  config = {
    bucket = "drawe-terraform-state-570515227314"
    key    = "dev/terraform.tfstate"
    region = "ap-northeast-2"
  }
}
