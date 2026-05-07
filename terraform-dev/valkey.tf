############################################################
# Valkey EC2 (dev — 직접 설치)
#
# prod 에선 이 파일 사용하지 않음. terraform-prod/elasticache.tf 사용.
############################################################
resource "random_password" "valkey" {
  count   = var.valkey_password == "" ? 1 : 0
  length  = 32
  special = false   # AUTH 토큰에 특수문자 escape 이슈 회피
}

locals {
  valkey_password = var.valkey_password != "" ? var.valkey_password : random_password.valkey[0].result
}

resource "aws_instance" "valkey" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.valkey_instance_type
  key_name               = var.key_pair_name
  subnet_id              = aws_subnet.private_a.id
  vpc_security_group_ids = [aws_security_group.valkey.id]

  user_data = templatefile("${path.module}/../scripts/setup-valkey.sh", {
    valkey_password = local.valkey_password
  })

  root_block_device {
    volume_size = 10
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name        = "${local.name_prefix}-valkey"
    AutoStop    = "true"
    Environment = var.env
  }

  lifecycle {
    # user_data 변경 시에도 인스턴스 재생성 안 하도록
    # (비밀번호 회전이 필요하면 instance 수동 replace)
    ignore_changes = [ami, user_data]
  }
}
