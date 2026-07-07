############################################################
# EKS observability 브리지 outputs — (prod)
#
# 목적:
#   ECS prod 스택이 이미 소유한 self-host observability 공유 자원
#   (Loki/Tempo S3 버킷, AMP workspace)을 EKS 계층
#   (eks/prod/3-platform/observability-irsa.tf)이 remote_state 로
#   읽어 IRSA 롤에 연결한다. 자원 복제 없음 — 재사용.
#
# 안전성:
#   - 리소스 정의를 추가/변경하지 않는다. output 만 노출.
#   - 따라서 `terraform plan` 은 자원 변경 0 + "Changes to Outputs" 만 표시되고,
#     운영 중인 ECS(prod)에는 영향이 없다.
#   - 기존 outputs.tf / outputs-eks-bridge.tf 와 이름 충돌 없음
#     (amp_query_url, loki_internal_url 등은 outputs.tf 가 이미 보유 → 재사용).
############################################################

output "loki_bucket_arn" {
  description = "Loki chunk S3 버킷 ARN. 3-platform 이 loki SA용 IRSA 롤 S3 정책에 사용."
  value       = aws_s3_bucket.loki.arn
}

output "tempo_bucket_arn" {
  description = "Tempo block S3 버킷 ARN. 3-platform 이 tempo SA용 IRSA 롤 S3 정책에 사용."
  value       = aws_s3_bucket.tempo.arn
}

output "amp_workspace_arn" {
  description = "AMP workspace ARN. alloy(RemoteWrite)/grafana(Query) IRSA 정책 Resource."
  value       = aws_prometheus_workspace.main.arn
}

output "amp_remote_write_url" {
  description = "AMP RemoteWrite endpoint. prod Alloy 의 AMP_REMOTE_WRITE_URL env 에 사용."
  value       = "${aws_prometheus_workspace.main.prometheus_endpoint}api/v1/remote_write"
}
