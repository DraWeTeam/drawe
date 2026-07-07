############################################################
# 공유 인프라(network=ECS prod) output 읽기 — Phase 0 브리지가 노출한 값
############################################################
data "terraform_remote_state" "ecs_prod" {
  backend = "s3"
  config = {
    bucket = "drawe-tfstate-933832340498"
    key    = "drawe/prod/terraform.tfstate"
    region = "ap-northeast-2"
  }
}
