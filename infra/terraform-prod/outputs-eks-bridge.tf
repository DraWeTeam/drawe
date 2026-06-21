############################################################
# EKS 전환용 브리지 outputs — Phase 0 (prod)
#
# 목적:
#   기존 ECS 스택(terraform-prod)이 소유한 공유 인프라(VPC/subnet/RDS·Valkey SG/
#   S3 정책)를 EKS 계층(eks/prod/2-cluster·3-platform)이 remote_state 로 읽어
#   재사용한다. 리소스 복제 없음.
#
# 안전성:
#   - 리소스 정의를 추가/변경하지 않는다. output 만 노출한다.
#   - 따라서 `terraform plan` 은 자원 변경 0 + "Changes to Outputs" 만 표시되고,
#     운영 중인 ECS(prod)에는 영향이 없다.
#   - 별도 파일이라 기존 outputs.tf 와 충돌 없이 추가/제거 가능.
#
# 생성: patch-0-prod-eks-bridge.sh
############################################################

output "vpc_id" {
  description = "EKS 가 클러스터/노드를 배치할 VPC ID"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "VPC CIDR (pod SG egress·참고용)"
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

output "valkey_sg_id" {
  description = "ElastiCache(Valkey) SG ID. 3-platform 이 'pod SG → 6379' 인그레스 규칙을 추가할 때 참조."
  value       = aws_security_group.valkey.id
}

output "artref_s3_policy_arn" {
  description = "artref S3 RW 정책 ARN. 3-platform 이 fastapi-guide SA용 IRSA 롤에 attach."
  value       = aws_iam_policy.artref_s3_access.arn
}

output "bria_s3_policy_arn" {
  description = "bria-ai S3 RW 정책 ARN. 3-platform 이 backend SA용 IRSA 롤에 attach."
  value       = aws_iam_policy.bria_s3_access.arn
}
