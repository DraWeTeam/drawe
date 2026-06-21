# VPC
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.name_prefix}-vpc" }
}

# Subnets
resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = var.az_a
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name_prefix}-pub-a" }

  # EKS(3-platform)가 추가하는 디스커버리 태그(kubernetes.io/role/elb 등) 보존
  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

resource "aws_subnet" "public_c" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = var.az_c
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name_prefix}-pub-c" }

  # EKS(3-platform)가 추가하는 디스커버리 태그 보존
  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.10.0/24"
  availability_zone = var.az_a
  tags              = { Name = "${local.name_prefix}-priv-a" }

  # EKS(3-platform)가 추가하는 디스커버리 태그(karpenter.sh/discovery 등) 보존
  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

resource "aws_subnet" "private_c" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = var.az_c
  tags              = { Name = "${local.name_prefix}-priv-c" }

  # EKS(3-platform)가 추가하는 디스커버리 태그 보존
  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

# Internet Gateway
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name_prefix}-igw" }
}

############################################################
# NAT Instance
#
# 비용 비교:
#   NAT Gateway  ≈ $32/mo 고정 + $0.045/GB
#   NAT Instance ≈ $6/mo (t4g.micro, stop 시 $0)  ← 더 저렴!
############################################################
resource "aws_security_group" "nat" {
  name   = "${local.name_prefix}-nat-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    description = "All from private subnets"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.10.0/24", "10.0.11.0/24"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-nat-sg" }
}

resource "aws_instance" "nat" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.nat_instance_type
  subnet_id                   = aws_subnet.public_a.id
  vpc_security_group_ids      = [aws_security_group.nat.id]
  source_dest_check           = false
  associate_public_ip_address = true
  key_name                    = var.key_pair_name

  user_data = <<-USERDATA
    #!/bin/bash
    set -euo pipefail
    echo "net.ipv4.ip_forward = 1" >> /etc/sysctl.conf
    sysctl -p
    dnf install -y iptables-services
    iptables -t nat -A POSTROUTING -o ens5 -s 10.0.0.0/16 -j MASQUERADE
    iptables -A FORWARD -i ens5 -o ens5 -m state --state RELATED,ESTABLISHED -j ACCEPT
    iptables -A FORWARD -i ens5 -o ens5 -j ACCEPT
    service iptables save
    systemctl enable iptables
  USERDATA

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name     = "${local.name_prefix}-nat"
    AutoStop = "true"
  }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

# Route Tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name_prefix}-rt-pub" }

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}

resource "aws_route_table_association" "pub_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "pub_c" {
  subnet_id      = aws_subnet.public_c.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name_prefix}-rt-priv" }

  route {
    cidr_block           = "0.0.0.0/0"
    network_interface_id = aws_instance.nat.primary_network_interface_id
  }
}

resource "aws_route_table_association" "priv_a" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "priv_c" {
  subnet_id      = aws_subnet.private_c.id
  route_table_id = aws_route_table.private.id
}
