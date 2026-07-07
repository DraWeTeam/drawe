############################################################
# Security Groups for Pods
#
# RDS·캐시 접근이 필요한 pod(backend·fastapi-embed·fastapi-guide)에만 붙일 전용 SG.
# 이 SG 의 id 를 output → caller 가 RDS SG ingress 규칙(rds-access.tf)에 사용,
# k8s 매니페스트의 SecurityGroupPolicy(podSelector)가 이 SG 를 pod 에 연결.
#
# 전제: vpc-cni ENABLE_POD_ENI=true (2-cluster 의 prefix delegation 설정에 포함).
# 주의: 이 SG 를 받은 pod 는 브랜치 ENI 를 사용 → prefix delegation 밀도 혜택을
#       받지 않으므로 "DB 접근이 필요한 pod 에만" 적용한다.
############################################################
resource "aws_security_group" "pods_db" {
  name        = "${local.name_prefix}-pods-db"
  description = "Pods that need RDS/cache access (security groups for pods)"
  vpc_id      = var.vpc_id

  # kubelet probe / CoreDNS 등 클러스터 내부 통신 허용 (브랜치 ENI pod 필수)
  ingress {
    description     = "From cluster/node SG (probes, dns, intra-cluster)"
    from_port       = 0
    to_port         = 0
    protocol        = "-1"
    security_groups = [var.node_security_group_id]
  }

  egress {
    description = "All egress (RDS 3306, cache 6379, external APIs, dns)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-pods-db" })
}
