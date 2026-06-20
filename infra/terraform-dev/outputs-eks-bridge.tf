############################################################
# EKS 전환용 브리지 outputs — Phase 0
#
# 목적:
#   기존 ECS 스택(terraform-dev)이 소유한 공유 인프라(VPC/subnet/RDS SG)를
#   EKS 계층(eks/dev/2-cluster·3-platform)이 remote_state 로 읽어 재사용한다.
#
# 안전성:
#   - 리소스 정의를 추가/변경하지 않는다. output 만 노출한다.
#   - 따라서 `terraform plan` 은 자원 변경 0 + "Changes to Outputs" 만 표시되고,
#     운영 중인 ECS 에는 영향이 없다.
#   - 별도 파일로 둬서 기존 outputs.tf 와 충돌 없이 추가/제거할 수 있다.
#
# prod 에도 동일 파일을 terraform-prod/ 에 두면 된다(리소스 이름 동일).
############################################################

output "vpc_id" {
  description = "EKS 가 클러스터/노드를 배치할 VPC ID"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "VPC CIDR (pod SG egress·참고용). 실제 VPC 값 사용."
  value       = aws_vpc.main.cidr_block
}

output "private_subnet_ids" {
  description = "EKS 노드/ENI 배치용 private 서브넷"
  value       = [aws_subnet.private_a.id, aws_subnet.private_c.id]
}

output "public_subnet_ids" {
  description = "외부 ALB(인터넷페이싱) 자동탐색용 public 서브넷"
  value       = [aws_subnet.public_a.id, aws_subnet.public_c.id]
}

output "rds_sg_id" {
  description = "RDS SG ID. 3-platform 이 'pod SG → RDS 3306' 인그레스 규칙을 추가할 때 참조."
  value       = aws_security_group.rds.id
}

# EKS pod(pods-db SG) 가 Valkey 6379 에 접근하도록 SG id 노출 (3-platform 의 cache_from_pods 가 참조)
output "valkey_sg_id" {
  description = "Valkey EC2 SG — EKS pods 6379 접근 허용용"
  value       = aws_security_group.valkey.id
}
