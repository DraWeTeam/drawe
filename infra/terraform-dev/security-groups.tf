# ALB
resource "aws_security_group" "alb" {
  name   = "${local.name_prefix}-alb-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Grafana UI (:3000) — 팀/사무실 IP 화이트리스트만 허용.
  # var.grafana_allowed_cidrs 가 비어있으면 이 인그레스 자체가 생성되지 않아
  # 외부에서 Grafana 에 접근할 수 없음(가장 안전한 기본값).
  # 평문 HTTP 대시보드이므로 절대 0.0.0.0/0 으로 열지 말 것.
  dynamic "ingress" {
    for_each = length(var.grafana_allowed_cidrs) > 0 ? [1] : []
    content {
      description = "Grafana UI (dev) - team IP allowlist only"
      from_port   = 3000
      to_port     = 3000
      protocol    = "tcp"
      cidr_blocks = var.grafana_allowed_cidrs
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-alb-sg" }
}

# ECS EC2 Instance
resource "aws_security_group" "ecs_instance" {
  name   = "${local.name_prefix}-ecs-instance-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    description = "All from VPC (task ENI, ECS agent)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-ecs-instance-sg" }
}

# ECS Backend (Spring Boot)
resource "aws_security_group" "ecs_backend" {
  name   = "${local.name_prefix}-ecs-backend-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    description     = "From ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-ecs-backend-sg" }
}

# ECS FastAPI (CLIP embedding)
resource "aws_security_group" "ecs_fastapi" {
  name   = "${local.name_prefix}-ecs-fastapi-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    description     = "From Backend"
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_backend.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-ecs-fastapi-sg" }
}

# RDS MySQL
resource "aws_security_group" "rds" {
  name   = "${local.name_prefix}-rds-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    description     = "From Backend"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [
      aws_security_group.ecs_backend.id,    # 기존 (backend task)
      aws_security_group.ecs_instance.id,   # ← 추가 (SSM 터널용)
      aws_security_group.ecs_fastapi.id,    # fastapi-guide (MySQL access)
    ]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-rds-sg" }

  # EKS(3-platform)가 별도 aws_security_group_rule 로 추가하는 pods-db 3306 ingress 보존.
  # (인라인 ingress 와 외부 rule 혼용 시 terraform-dev apply 가 외부 rule 을 지우는 것 방지)
  lifecycle {
    ignore_changes = [ingress]
  }
}

# Valkey EC2
resource "aws_security_group" "valkey" {
  name   = "${local.name_prefix}-valkey-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    description     = "Valkey from Backend"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_backend.id]
  }

  # SSH 인바운드 없음.
  # 운영/디버깅 접속은 SSM Session Manager 로만 수행한다.
  #   - 인스턴스에 AmazonSSMManagedInstanceCore 정책 부착 (valkey.tf)
  #   - SSM 은 아웃바운드 443 만 사용하므로 22번 인바운드가 전혀 필요 없음
  # 긴급 SSH fallback 이 꼭 필요하면 0.0.0.0/0 대신 VPC CIDR 또는
  # 특정 관리자 IP 로만 제한할 것 (var.vpc_cidr / var.admin_cidrs).

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-valkey-sg" }

  # 외부(3-platform)의 aws_security_group_rule 과 공존: ingress 드리프트 무시.
  # 인라인 ingress 와 별도 rule 을 섞으면 apply 마다 서로 지우므로 필수.
  lifecycle {
    ignore_changes = [ingress]
  }
}
