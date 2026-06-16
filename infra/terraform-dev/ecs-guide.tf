############################################################
# fastapi-guide — 이미지 가이딩 전용 ECS 서비스 (P5)
#
# embed(fastapi) 와 *별도 서비스*. 같은 클러스터/ASG(스팟) 위에서 돌지만
#   - 별도 ECR 리포(Dockerfile.guide, ARM64, torch+open_clip+mediapipe)
#   - 별도 Service Connect 이름: fastapi-guide.<prefix>.local:8000
#   - 태스크 사이징 UP(모델 메모리) / stopTimeout 120(spot in-flight 보장)
# 스토어/시크릿(S3 artref·Qdrant·DB_DSN·Gemini·Grok)은 이미 머지된
#   s3-artref.tf / ssm-qdrant.tf / ssm-artref-fastapi.tf / ssm.tf 의 리소스를 재사용한다.
# IAM 은 공용 task role(aws_iam_role.ecs_task: artref S3 RW) + exec role(SSM read)을 그대로 쓴다.
# SG 는 ecs_fastapi(백엔드→8000 ingress) 재사용.
############################################################

variable "fastapi_guide_cpu" {
  description = "guide 태스크 CPU 단위(torch+open_clip+mediapipe 로 embed 보다 크게)."
  type        = number
  default     = 1536
}

variable "fastapi_guide_memory" {
  description = "guide 태스크 메모리(MiB). 모델 상주 메모리 헤드룸 확보."
  type        = number
  default     = 5120
}

variable "fastapi_guide_desired_count" {
  description = "guide 서비스 desired count."
  type        = number
  default     = 1
}

variable "guide_hand_vlm" {
  description = "손 VLM 게이트. dev 는 0(다크)로 시작, P9 에서 1 로 해제."
  type        = string
  default     = "0"
}

# ── ECR ──────────────────────────────────────────────
resource "aws_ecr_repository" "fastapi_guide" {
  name                 = "${local.name_prefix}-fastapi-guide"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = "${local.name_prefix}-fastapi-guide" }
}

resource "aws_ecr_lifecycle_policy" "fastapi_guide" {
  repository = aws_ecr_repository.fastapi_guide.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# ── CloudWatch 로그 그룹 ──────────────────────────────
resource "aws_cloudwatch_log_group" "fastapi_guide" {
  name              = "/ecs/${local.name_prefix}-fastapi-guide"
  retention_in_days = 14
  tags              = { Name = "${local.name_prefix}-fastapi-guide-logs" }
}

# ── Service Connect(Cloud Map) — fastapi-guide.<prefix>.local ──
resource "aws_service_discovery_service" "fastapi_guide" {
  name = "fastapi-guide"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.internal.id
    dns_records {
      type = "A"
      ttl  = 10
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# ── Task Definition — guide(OpenCLIP+mediapipe+Gemini+Grok) + Alloy sidecar ──
resource "aws_ecs_task_definition" "fastapi_guide" {
  family                   = "${local.name_prefix}-fastapi-guide"
  requires_compatibilities = ["EC2"]
  network_mode             = "awsvpc"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn # artref S3 RW 공용 정책 attach 됨

  container_definitions = jsonencode([
    {
      name      = "fastapi-guide"
      image     = "${aws_ecr_repository.fastapi_guide.repository_url}:latest"
      essential = true
      cpu       = var.fastapi_guide_cpu
      memory    = var.fastapi_guide_memory

      portMappings = [{ containerPort = 8000, protocol = "tcp" }]

      dependsOn = [{ containerName = "alloy", condition = "START" }]

      # 워밍업(OpenCLIP 로드)은 백그라운드 → /health 가 loading(503)→ok(200) 전이.
      # startPeriod 동안 healthCheck 실패를 카운트하지 않음.
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 120
      }

      # graceful-shutdown(110s, Dockerfile.guide) < stopTimeout(120s) → spot 2분 통지 시 in-flight 마무리.
      stopTimeout = 120

      environment = concat([
        { name = "PORT", value = "8000" },
        { name = "WORKERS", value = "1" },
        { name = "SERVICE_ROLE", value = "guide" },

        # ── 벡터 백엔드 / 가이딩 코퍼스(Qdrant Cloud, env 별 컬렉션) ──
        { name = "VECTOR_BACKEND", value = "qdrant" },
        { name = "QDRANT_COLLECTION", value = "reference_images_${var.env}" },

        # ── 임베더(OpenCLIP ViT-L/14, embed.py 파서 형식) ──
        { name = "EMBEDDING_MODEL", value = "open_clip:ViT-L-14:openai" },

        # ── S3(artref) — 키 미주입 → ECS task role 폴백(stores/s3.py) ──
        { name = "S3_BUCKET", value = aws_s3_bucket.artref.bucket },
        { name = "S3_ENDPOINT", value = "https://s3.${var.aws_region}.amazonaws.com" },
        { name = "S3_PUBLIC_ENDPOINT", value = "https://s3.${var.aws_region}.amazonaws.com" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "REFERENCE_DIR", value = "/app/assets/reference" },

        # ── 모델 게이트 ──
        { name = "VLM_BACKEND", value = "aistudio" }, # Gemini(aistudio)
        { name = "HAND_VLM", value = var.guide_hand_vlm }, # dev 0(다크) → P9 1
        { name = "LLM_PROVIDER", value = "grok" },
        { name = "LLM_MODEL", value = "grok-4.3" },

        # ── 브라우저 출처(CORS) ──
        { name = "CORS_ORIGINS", value = var.frontend_url },

        { name = "OTEL_SERVICE_NAME", value = "guide" },
      ], local.otel_env)

      secrets = [
        { name = "DB_DSN", valueFrom = aws_ssm_parameter.artref_db_dsn.arn }, # drawe_guide DSN
        { name = "QDRANT_URL", valueFrom = aws_ssm_parameter.qdrant_url.arn },
        { name = "QDRANT_API_KEY", valueFrom = aws_ssm_parameter.qdrant_api_key.arn },
        { name = "XAI_API_KEY", valueFrom = aws_ssm_parameter.grok_api_key.arn },     # 코칭 LLM(xAI/Grok)
        { name = "GEMINI_API_KEY", valueFrom = aws_ssm_parameter.gemini_api_key.arn }, # 손 VLM(aistudio)
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.fastapi_guide.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    },

    merge(local.alloy_sidecar, {
      cpu    = var.alloy_sidecar_cpu
      memory = var.alloy_sidecar_memory
      environment = concat(local.alloy_env, [
        { name = "ALLOY_SERVICE_NAME", value = "guide" },
      ])
      secrets = local.alloy_secrets
    })
  ])

  tags = { Name = "${local.name_prefix}-fastapi-guide-td" }
}

# ── ECS Service — fastapi-guide (내부 전용, spot-heavy) ──
resource "aws_ecs_service" "fastapi_guide" {
  name            = "${local.name_prefix}-fastapi-guide"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.fastapi_guide.arn
  desired_count   = var.fastapi_guide_desired_count
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  enable_execute_command = true

  # dev: 단일 ec2 capacity provider(ASG mixed-instances 가 스팟-헤비). prod 도 동일 CP(ASG 가 on-demand base).
  capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.ec2.name
    weight            = 1
  }

  network_configuration {
    subnets          = [aws_subnet.private_a.id, aws_subnet.private_c.id]
    security_groups  = [aws_security_group.ecs_fastapi.id] # 백엔드→8000 ingress 재사용
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.fastapi_guide.arn
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_ecs_cluster_capacity_providers.main]

  tags = { Name = "${local.name_prefix}-fastapi-guide-svc" }

  lifecycle {
    ignore_changes = [desired_count, task_definition]
  }
}

output "fastapi_guide_ecr_url" {
  description = "guide 서비스 ECR 리포 URL (CD push 대상)."
  value       = aws_ecr_repository.fastapi_guide.repository_url
}
