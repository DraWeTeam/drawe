############################################################
# NAT Instance × 2 (AZ별 1개) + ASG
#
# fck-nat AMI 사용 (https://github.com/AndrewGuenther/fck-nat).
# Marketplace 가입 필요 없음 - 공개 AMI 로 배포됨.
# AMI 가 부팅 시 user_data 의 /etc/fck-nat.conf 를 읽어:
#   1) 지정된 EIP 를 자기 instance 에 attach
#   2) 지정된 route table 의 0.0.0.0/0 을 자기 ENI 로 갱신
#   3) iptables MASQUERADE + ip_forward 설정
#
# ⚠️ 두 가지 belt & suspenders fix (2026.06.01 prod 검증 중 발견):
#    [Fix 1] source_dest_check 끄기 — fck-nat 가 처리하기로 되어 있지만
#            부팅 타이밍 이슈로 가끔 누락 → 명시적으로 한 번 더 보장.
#            없으면 NAT 가 forwarded 패킷을 ENI 단계에서 drop → 인터넷 차단.
#    [Fix 2] route table 의 0.0.0.0/0 을 새 NAT 의 ENI 로 갱신 — fck-nat 가
#            처리하기로 되어 있지만, 옛 NAT destroy 후 새 NAT launch 될 때
#            blackhole 라우트가 남는 케이스 관찰됨 → 명시적으로 한 번 더 보장.
#            없으면 private subnet 의 모든 트래픽이 죽은 ENI 로 → 인터넷 차단.
#
# ASG (desired=1) 가 instance 헬스 모니터링.
# 인스턴스가 죽으면 같은 AZ 에 새로 띄우고, 부팅 user_data 가 EIP/route 재셋업.
# Terraform 의 route table 은 0.0.0.0/0 route 를 inline 으로 안 가짐 -
# fck-nat 가 동적으로 관리 (lifecycle ignore_changes).
############################################################

# ── fck-nat AMI (ARM64) ─────────────────────────────────
data "aws_ami" "fck_nat" {
  most_recent = true
  owners      = ["568608671756"] # fck-nat publisher account

  filter {
    name   = "name"
    values = ["fck-nat-al2023-*-arm64-ebs"]
  }
}

# ── EIP × 2 ─────────────────────────────────────────────
resource "aws_eip" "nat_a" {
  domain = "vpc"
  tags   = { Name = "${local.name_prefix}-nat-eip-a" }
}

resource "aws_eip" "nat_c" {
  domain = "vpc"
  tags   = { Name = "${local.name_prefix}-nat-eip-c" }
}

# ── Security Group (NAT instance) ───────────────────────
# private subnet 의 모든 트래픽을 받아서 인터넷으로 보냄
resource "aws_security_group" "nat_instance" {
  name        = "${local.name_prefix}-nat-instance-sg"
  description = "fck-nat instances - accept egress from private subnets"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "From private subnets - any protocol"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [
      aws_subnet.private_a.cidr_block,
      aws_subnet.private_c.cidr_block,
    ]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-nat-instance-sg" }
}

# ── IAM role: associate EIP, replace route, modify attribute ──
resource "aws_iam_role" "nat_instance" {
  name = "${local.name_prefix}-nat-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "nat_instance" {
  name = "${local.name_prefix}-nat-instance-policy"
  role = aws_iam_role.nat_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ec2:AssociateAddress",
        "ec2:DisassociateAddress",
        "ec2:ReplaceRoute",
        "ec2:CreateRoute",
        "ec2:ModifyInstanceAttribute",
        "ec2:DescribeAddresses",
        "ec2:DescribeRouteTables",
        "ec2:DescribeNetworkInterfaces",
      ]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "nat_instance_ssm" {
  role       = aws_iam_role.nat_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "nat_instance" {
  name = "${local.name_prefix}-nat-instance-profile"
  role = aws_iam_role.nat_instance.name
}

############################################################
# Launch Template - AZ-a
############################################################
resource "aws_launch_template" "nat_a" {
  name_prefix   = "${local.name_prefix}-nat-a-"
  image_id      = data.aws_ami.fck_nat.id
  instance_type = "t4g.nano"
  key_name      = var.key_pair_name

  iam_instance_profile {
    arn = aws_iam_instance_profile.nat_instance.arn
  }

  network_interfaces {
    associate_public_ip_address = true
    security_groups             = [aws_security_group.nat_instance.id]
    delete_on_termination       = true
  }

  user_data = base64encode(replace(<<-USERDATA
    #!/bin/bash
    set -x

    # ── 1. fck-nat config 작성 + 서비스 재시작 ──────────────
    cat > /etc/fck-nat.conf <<EOF
    eip_id=${aws_eip.nat_a.id}
    route_tables_ids=${aws_route_table.private_a.id}
    EOF

    systemctl restart fck-nat.service

    # ── 공통: IMDSv2 토큰 + 인스턴스 메타데이터 가져오기 ────
    TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" \
      -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
    INSTANCE_ID=$(curl -sH "X-aws-ec2-metadata-token: $TOKEN" \
      http://169.254.169.254/latest/meta-data/instance-id)
    REGION=$(curl -sH "X-aws-ec2-metadata-token: $TOKEN" \
      http://169.254.169.254/latest/meta-data/placement/region)
    PRIMARY_MAC=$(curl -sH "X-aws-ec2-metadata-token: $TOKEN" \
      http://169.254.169.254/latest/meta-data/mac)
    ENI_ID=$(curl -sH "X-aws-ec2-metadata-token: $TOKEN" \
      http://169.254.169.254/latest/meta-data/network/interfaces/macs/$PRIMARY_MAC/interface-id)

    # ── [Fix 1] source_dest_check 명시적으로 끄기 ─────────
    #    fck-nat 가 부팅 타이밍 이슈로 가끔 놓침 → 직접 확실하게 끔.
    #    이 한 줄이 빠지면 NAT 가 forwarded 패킷을 통과시키지 않아
    #    private subnet 의 모든 인스턴스가 인터넷 접속 불가가 됨.
    aws ec2 modify-instance-attribute \
      --instance-id "$INSTANCE_ID" \
      --source-dest-check "{\"Value\": false}" \
      --region "$REGION"

    # ── [Fix 2] route table 의 0.0.0.0/0 을 이 NAT 의 ENI 로 ──
    #    fck-nat 가 시도하기는 하지만, 옛 NAT destroy 후 새로 launch 될 때
    #    blackhole 라우트가 남아있는 케이스 관찰됨 → 명시적으로 한 번 더 보장.
    #    replace-route 가 실패하면 (= route 가 아예 없으면) create-route 로 fallback.
    ROUTE_TABLE_ID="${aws_route_table.private_a.id}"
    aws ec2 replace-route \
      --route-table-id "$ROUTE_TABLE_ID" \
      --destination-cidr-block 0.0.0.0/0 \
      --network-interface-id "$ENI_ID" \
      --region "$REGION" || \
    aws ec2 create-route \
      --route-table-id "$ROUTE_TABLE_ID" \
      --destination-cidr-block 0.0.0.0/0 \
      --network-interface-id "$ENI_ID" \
      --region "$REGION"
  USERDATA
  , "\r\n", "\n"))

  monitoring { enabled = true }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${local.name_prefix}-nat-a"
      Role = "nat-instance"
    }
  }

  lifecycle { create_before_destroy = true }
}

############################################################
# Launch Template - AZ-c
############################################################
resource "aws_launch_template" "nat_c" {
  name_prefix   = "${local.name_prefix}-nat-c-"
  image_id      = data.aws_ami.fck_nat.id
  instance_type = "t4g.nano"
  key_name      = var.key_pair_name

  iam_instance_profile {
    arn = aws_iam_instance_profile.nat_instance.arn
  }

  network_interfaces {
    associate_public_ip_address = true
    security_groups             = [aws_security_group.nat_instance.id]
    delete_on_termination       = true
  }

  user_data = base64encode(replace(<<-USERDATA
    #!/bin/bash
    set -x

    # ── 1. fck-nat config 작성 + 서비스 재시작 ──────────────
    cat > /etc/fck-nat.conf <<EOF
    eip_id=${aws_eip.nat_c.id}
    route_tables_ids=${aws_route_table.private_c.id}
    EOF

    systemctl restart fck-nat.service

    # ── 공통: IMDSv2 토큰 + 인스턴스 메타데이터 가져오기 ────
    TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" \
      -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
    INSTANCE_ID=$(curl -sH "X-aws-ec2-metadata-token: $TOKEN" \
      http://169.254.169.254/latest/meta-data/instance-id)
    REGION=$(curl -sH "X-aws-ec2-metadata-token: $TOKEN" \
      http://169.254.169.254/latest/meta-data/placement/region)
    PRIMARY_MAC=$(curl -sH "X-aws-ec2-metadata-token: $TOKEN" \
      http://169.254.169.254/latest/meta-data/mac)
    ENI_ID=$(curl -sH "X-aws-ec2-metadata-token: $TOKEN" \
      http://169.254.169.254/latest/meta-data/network/interfaces/macs/$PRIMARY_MAC/interface-id)

    # ── [Fix 1] source_dest_check 명시적으로 끄기 ─────────
    aws ec2 modify-instance-attribute \
      --instance-id "$INSTANCE_ID" \
      --source-dest-check "{\"Value\": false}" \
      --region "$REGION"

    # ── [Fix 2] route table 의 0.0.0.0/0 을 이 NAT 의 ENI 로 ──
    ROUTE_TABLE_ID="${aws_route_table.private_c.id}"
    aws ec2 replace-route \
      --route-table-id "$ROUTE_TABLE_ID" \
      --destination-cidr-block 0.0.0.0/0 \
      --network-interface-id "$ENI_ID" \
      --region "$REGION" || \
    aws ec2 create-route \
      --route-table-id "$ROUTE_TABLE_ID" \
      --destination-cidr-block 0.0.0.0/0 \
      --network-interface-id "$ENI_ID" \
      --region "$REGION"
  USERDATA
  , "\r\n", "\n"))

  monitoring { enabled = true }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${local.name_prefix}-nat-c"
      Role = "nat-instance"
    }
  }

  lifecycle { create_before_destroy = true }
}

############################################################
# ASG × 2 - desired=1 each, EC2 health check
############################################################
resource "aws_autoscaling_group" "nat_a" {
  name_prefix         = "${local.name_prefix}-nat-a-"
  vpc_zone_identifier = [aws_subnet.public_a.id]
  min_size            = (var.prod_enabled || var.nat_enabled) ? 1 : 0
  max_size            = (var.prod_enabled || var.nat_enabled) ? 1 : 0
  desired_capacity    = (var.prod_enabled || var.nat_enabled) ? 1 : 0

  health_check_type         = "EC2"
  health_check_grace_period = 60

  launch_template {
    id      = aws_launch_template.nat_a.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "${local.name_prefix}-nat-a"
    propagate_at_launch = true
  }

  lifecycle { create_before_destroy = true }
}

resource "aws_autoscaling_group" "nat_c" {
  name_prefix         = "${local.name_prefix}-nat-c-"
  vpc_zone_identifier = [aws_subnet.public_c.id]
  min_size            = (var.prod_enabled || var.nat_enabled) ? 1 : 0
  max_size            = (var.prod_enabled || var.nat_enabled) ? 1 : 0
  desired_capacity    = (var.prod_enabled || var.nat_enabled) ? 1 : 0

  health_check_type         = "EC2"
  health_check_grace_period = 60

  launch_template {
    id      = aws_launch_template.nat_c.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "${local.name_prefix}-nat-c"
    propagate_at_launch = true
  }

  lifecycle { create_before_destroy = true }
}
