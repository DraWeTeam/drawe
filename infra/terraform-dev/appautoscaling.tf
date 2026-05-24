############################################################
# Application Auto Scaling — ECS 서비스 desired count 조정
#
# Layer 분리:
#   ASG (autoscaling group)        → EC2 인스턴스 수 조정
#   App Auto Scaling (이 파일)      → ECS task 수 조정
#
# 둘은 협력 관계:
#   App Auto Scaling 이 task 늘림 → Capacity Provider 가
#   부족한 EC2 를 자동 추가 (managed scaling: target=100)
############################################################

# ── Backend Service ─────────────────────────────────────
resource "aws_appautoscaling_target" "backend" {
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"

  min_capacity = var.backend_min_capacity
  max_capacity = var.backend_max_capacity
}

# CPU 기반 target tracking
resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "${local.name_prefix}-backend-cpu-tt"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.backend.service_namespace
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  resource_id        = aws_appautoscaling_target.backend.resource_id

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 120  # task 줄일 때 신중하게
    scale_out_cooldown = 60   # task 늘릴 때 빠르게
  }
}

# Memory 기반 target tracking (보조)
resource "aws_appautoscaling_policy" "backend_memory" {
  name               = "${local.name_prefix}-backend-memory-tt"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.backend.service_namespace
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  resource_id        = aws_appautoscaling_target.backend.resource_id

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 75
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
  }
}

# ALB 요청 수 기반 (선택) — 트래픽 spike 대응
resource "aws_appautoscaling_policy" "backend_alb_requests" {
  name               = "${local.name_prefix}-backend-alb-tt"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.backend.service_namespace
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  resource_id        = aws_appautoscaling_target.backend.resource_id

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.backend.arn_suffix}"
    }
    target_value       = 500   # task 당 분당 요청 수
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
  }
}

# ── FastAPI Service (CLIP) ──────────────────────────────
resource "aws_appautoscaling_target" "fastapi" {
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.fastapi.name}"

  min_capacity = var.fastapi_min_capacity
  max_capacity = var.fastapi_max_capacity
}

# CPU 기반 — CLIP 추론은 CPU bound
resource "aws_appautoscaling_policy" "fastapi_cpu" {
  name               = "${local.name_prefix}-fastapi-cpu-tt"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.fastapi.service_namespace
  scalable_dimension = aws_appautoscaling_target.fastapi.scalable_dimension
  resource_id        = aws_appautoscaling_target.fastapi.resource_id

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300  # CLIP 콜드 스타트 — 줄일 때 신중
    scale_out_cooldown = 60
  }
}

# Memory 기반 — CLIP 모델이 메모리에 상주
resource "aws_appautoscaling_policy" "fastapi_memory" {
  name               = "${local.name_prefix}-fastapi-memory-tt"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.fastapi.service_namespace
  scalable_dimension = aws_appautoscaling_target.fastapi.scalable_dimension
  resource_id        = aws_appautoscaling_target.fastapi.resource_id

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 75
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
