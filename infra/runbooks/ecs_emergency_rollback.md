# ECS 비상 롤백 절차 (DraWe prod)

> EKS 가 큰 장애에 빠진 상황에서 **ECS 로 트래픽을 되돌리는** 절차다.
> ECS 코드는 영구 dormant 상태로 유지되니까(`prod_eks_cutover.md` Phase D), 5~15 분 안에 부활 가능하다.

## 언제 이 절차를 쓰나

- EKS 컨트롤플레인 자체가 죽음 (`aws eks describe-cluster` 가 ACTIVE 아님)
- ALB Controller 가 동작 불능 + 새 ALB 갱신 안 됨
- Karpenter 가 노드 못 띄움 + 시스템 NG 도 망가짐
- 그 외 EKS 측 만으로 30 분 내 복구 불가능하다고 판단되는 상황

**쓰지 말아야 할 때**:
- 단순히 한 파드가 CrashLoopBackOff 인 경우 (`kubectl rollout undo` 가 답)
- ArgoCD sync 안 되는 경우 (강제 sync 절차 — `prod_eks_cutover.md` 함정 10)
- DB / Cache 문제 (롤백 해도 같은 백엔드 자원이라 의미 없음)

## 사전 정보 (현 상태)

| 자원 | 현재 상태 |
| --- | --- |
| ECS task definition (backend / fastapi / fastapi-guide) | 코드 그대로, 마지막 컷오버 직전 버전. 부활 시 새 ECR 이미지로 갱신해야 최신 코드 |
| ECS service desired_count | 0 (마지막 컷오버 때 manual 0 처리) |
| ECS cluster | 살아있음 (cluster 자원은 자원 0 이라 비용 0) |
| ASG capacity (`prod_enabled`) | terraform 변수가 `true` 면 ASG 가 capacity 가짐 (지금 true 인지 확인 필요) |
| RDS / ElastiCache / SSM / VPC / NAT / SG / S3 | 살아있음 — ECS·EKS 공유 |
| ECS ALB (`aws_lb.main`) | 살아있음 (target 없을 뿐) |
| EKS ALB | ALB Controller 가 만든 별도 ALB. EKS 죽으면 같이 영향 받음 |
| Cloudflare `api.drawe.xyz` | `cutover-eks.tf` 토글로 ECS↔EKS ALB DNS 전환 가능 |

## 롤백 순서

**원칙**: 안전한 단계부터, 검증 가능한 순서로. 한 단계마다 확인 후 다음.

### Step 1 — 결정 + 알림

비상 결정은 혼자 안 한다. 최소한 팀 채널 (Discord/Slack) 에 공지:

```
[ROLLBACK] prod 를 EKS → ECS 로 비상 롤백 시작.
이유: <한 줄>
영향: api.drawe.xyz 가 5~10 분 동안 502 가능 (DNS 전환 + ECS task 기동)
시작: HH:MM
```

### Step 2 — terraform-prod 상태 확인

```bash
cd infra/terraform-prod
AWS_PROFILE=drawe-prod terraform plan -refresh-only
# drift 가 있으면 (보통 desired_count) 그대로 두고 진행. lifecycle ignore_changes 로 보호됨.

# prod_enabled 가 true 인지 (ASG capacity 가져야 함)
grep "prod_enabled" terraform.tfvars 2>/dev/null
# 또는 default(true) 그대로면 OK
```

### Step 3 — ECS ALB target group 이 살아있나 확인

```bash
TGARN=$(AWS_PROFILE=drawe-prod aws elbv2 describe-target-groups \
  --names drawe-prod-backend \
  --region ap-northeast-2 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
echo "ECS backend TG: $TGARN"

# target 상태 (지금은 비어있어야 정상)
AWS_PROFILE=drawe-prod aws elbv2 describe-target-health \
  --target-group-arn $TGARN --region ap-northeast-2
# 비어있으면 ECS service 가 0 이라 정상
```

### Step 4 — ECR 이미지 확인 + ECS task def 갱신 (선택)

마지막 컷오버 때의 task def 는 그날 ECR 이미지 SHA 고정. **그 사이 main 머지로 새 이미지가 ECR 에 쌓였으면** 최신을 task def 에 박는 게 일반적.

```bash
# 최신 ECR 이미지 SHA
LATEST=$(AWS_PROFILE=drawe-prod aws ecr describe-images \
  --repository-name drawe-prod-backend \
  --region ap-northeast-2 \
  --query 'sort_by(imageDetails,& imagePushedAt)[-1].imageTags' --output json)
echo "Latest backend: $LATEST"

# 이 태그를 ECS task def 의 image= 에 어떻게 박나
#   옵션 A: terraform-prod/ecs.tf 의 var.backend_image_tag 같은 변수가 있으면 그걸로
#   옵션 B: 그냥 :latest 태그(있다면) 사용 — 옛 컷오버 직전 SHA 와 다를 수 있어 위험
#   옵션 C: 코드 변화 없이 컷오버 직전 SHA 그대로 — DB schema 가 그 후 V13 등 마이그됐으면 호환 안 됨
```

**가장 안전한 선택 — 컷오버 시점 task def 그대로 살리지 말고, 최신 EKS overlay 의 SHA 와 같은 ECR 이미지로 ECS task def 새로 만든다.** `infra/k8s/overlays/prod/backend/kustomization.yaml` 의 `newTag` 가 그 SHA.

```bash
EKS_SHA=$(grep "newTag:" infra/k8s/overlays/prod/backend/kustomization.yaml | awk '{print $2}')
echo "EKS 현재 SHA: $EKS_SHA"

# terraform-prod/ecs.tf 의 backend container image 가 var.backend_image_tag 또는
# 비슷한 변수면 -var 로 주입. 없으면 ecs.tf 의 image= 라인을 직접 편집해 commit.
# 변수 이름은 코드 확인 필요.
```

이 단계가 가장 시간 걸리고 정확성 필요. **지금 ecs.tf 의 image 변수 명을 확인**해두면 비상 시 빠르다. (TODO: 본 문서 작성 후 보강)

### Step 5 — ECS service desired_count 켜기

`lifecycle { ignore_changes = [desired_count] }` 라서 **terraform 으로는 못 켠다.** manual:

```bash
# backend
AWS_PROFILE=drawe-prod aws ecs update-service \
  --cluster drawe-prod-cluster \
  --service drawe-prod-backend \
  --desired-count 2 \
  --region ap-northeast-2

# fastapi-embed
AWS_PROFILE=drawe-prod aws ecs update-service \
  --cluster drawe-prod-cluster \
  --service drawe-prod-fastapi \
  --desired-count 1 \
  --region ap-northeast-2

# fastapi-guide
AWS_PROFILE=drawe-prod aws ecs update-service \
  --cluster drawe-prod-cluster \
  --service drawe-prod-fastapi-guide \
  --desired-count 1 \
  --region ap-northeast-2
```

ASG 가 prod_enabled=true 라면 EC2 가 capacity 충족하면서 ECS task placement 가능. 안 되면 ASG capacity 확인:

```bash
AWS_PROFILE=drawe-prod aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names drawe-prod-asg \
  --region ap-northeast-2 \
  --query 'AutoScalingGroups[0].{Desired:DesiredCapacity,Min:MinSize,Max:MaxSize,Current:length(Instances)}'
```

`Desired=0` 이면 `prod_enabled=false` 인 상태. `terraform.tfvars` 에 `prod_enabled=true` 박고 `terraform apply` (또는 -var 로 임시 override).

### Step 6 — ECS task 정상 기동 확인

```bash
AWS_PROFILE=drawe-prod aws ecs describe-services \
  --cluster drawe-prod-cluster \
  --services drawe-prod-backend drawe-prod-fastapi drawe-prod-fastapi-guide \
  --region ap-northeast-2 \
  --query 'services[].{Name:serviceName,Desired:desiredCount,Running:runningCount,Pending:pendingCount}'
```

`Running == Desired` 까지 대기 (보통 2~5 분).

### Step 7 — ECS ALB target health 확인

```bash
AWS_PROFILE=drawe-prod aws elbv2 describe-target-health \
  --target-group-arn $TGARN --region ap-northeast-2 \
  --query 'TargetHealthDescriptions[].{State:TargetHealth.State}'
# State=healthy 가 desired 개수만큼 보여야 함
```

`unhealthy` 면 backend health check (`/actuator/health/readiness`) 실패. 로그 확인:

```bash
AWS_PROFILE=drawe-prod aws logs tail /ecs/drawe-prod-backend \
  --since 5m --follow --region ap-northeast-2
```

### Step 8 — Cloudflare DNS 전환 (EKS → ECS ALB)

`cutover-eks.tf` 의 `eks_cutover` 변수를 false 로:

```bash
cd infra/terraform-prod
AWS_PROFILE=drawe-prod terraform apply -var='eks_cutover=false' -target=cloudflare_record.api

# 또는 진짜 비상이면 -var 대신 terraform.tfvars 에 박고 apply
# variable "eks_cutover" 가 .tfvars 에 없으면 한 줄 추가
```

cloudflare proxied=true 라 DNS 캐시는 빠르게 비워짐 (보통 30 초~2 분).

**검증**:
```bash
# DNS 가 ECS ALB 로 향하나
dig +short api.drawe.xyz @1.1.1.1
# 이건 Cloudflare proxy IP 라 그대로 보임. 진짜 검증은:
curl -I https://api.drawe.xyz/actuator/health/readiness
# 200 응답 + Cloudflare 헤더 정상이면 성공

# 직접 ALB 에 hit 해서 ECS 인지 확인
ECS_ALB=$(AWS_PROFILE=drawe-prod aws elbv2 describe-load-balancers \
  --names drawe-prod-alb \
  --region ap-northeast-2 \
  --query 'LoadBalancers[0].DNSName' --output text)
curl -I -H "Host: api.drawe.xyz" https://$ECS_ALB/actuator/health/readiness -k
# 200 이면 ECS 가 받고 있음
```

### Step 9 — 알림 + 사후 작업

```
[ROLLBACK 완료] api.drawe.xyz → ECS ALB.
- ECS 서비스: backend/fastapi/fastapi-guide 정상
- Cloudflare DNS 전환됨
- 완료: HH:MM, 소요 NN 분

다음:
- EKS 측 근본 원인 진단 (별도 슬랙 스레드)
- ECS 운영 모드 유지. EKS 재컷오버는 EKS 완전 복구 + 충분한 검증 후
```

## ECS → EKS 재컷오버 (롤백의 역방향)

EKS 복구가 끝나면 컷오버 절차 (`prod_eks_cutover.md`) 그대로 다시. 핵심 한 줄:

```bash
AWS_PROFILE=drawe-prod terraform apply -var='eks_cutover=true'
```

EKS ALB target group 이 비어있으면 안 됨 — `ArgoCD` 가 `backend` 등 ingress 를 다시 만들고 target group 에 EKS 노드들이 등록되도록 먼저 확인.

## 알려진 함정

1. **DB schema 호환성**: ECS task def 이 컷오버 직전 코드 SHA 라 그 사이 Flyway V13, V14… 가 돈 경우 schema 가 앞서 있음. ECS 코드가 옛 schema 가정이면 컬럼 missing 에러. **최신 ECR 이미지로 task def 갱신 (Step 4) 가 필요한 이유.**

2. **`backfill_ai_description.sh` 같은 비상 스크립트가 ECS pod 에서 동작**: SGP (Security Group for Pods) 가 EKS 만의 것이라, ECS task 가 RDS 접속 시 사용하는 SG 가 EKS 와 다름. `drawe-prod-mysql` RDS 의 SG ingress 가 ECS task SG 도 허용해야 함 (현재 허용 — `security-groups.tf` 참조).

3. **WORKFLOW_COMPOSE_LIVE_INTENTS**: 이 환경변수가 ECS task def 에는 없을 수도 있음 (EKS 만 적용했었음). ECS 부활 후 사용자 트래픽이 들어오면 옛 워크플로 (shadow) 만 돌아 — outage 는 아니지만 새 워크플로 회귀 데이터 없음. 비상 상황엔 OK, 정상화 후 ECS task def 의 환경변수도 EKS 와 맞출지 결정.

4. **observability**: ECS 의 alloy / loki / tempo / grafana 도 desired=0. ECS 부활 시 같이 켜야 로그·트레이스 보임. 다만 비상 트래픽 받는 게 우선이라 observability 는 안정화 후 켜도 됨.

5. **Cloudflare `grafana.drawe.xyz`**: 현재 `aws_lb.main` (ECS ALB) 가리킴. EKS 컷오버 후에도 변경 안 됐음. ECS observability 가 desired=0 이라 grafana 도 dormant 상태인데, 만약 운영 중 grafana 가 필요했으면 그건 아직 EKS 로 안 옮긴 별도 트랙 (`Phase B-observability`).

## 운영 메모

- 이 문서는 **한 번도 사용된 적 없음**이 좋은 상태다. 사용해야 하면 EKS 가 큰 사고를 겪은 것.
- 실제로 한 번이라도 비상 롤백이 발생하면 위 절차를 거기에 맞게 보강 (실제 명령 + 실제 소요 시간 + 함정).
- `prod_enabled=true` 토글 함정 — 평소 변경 시 ECS 가 부활하면서 EKS 와 충돌 가능 (`prod_eks_cutover.md` Phase D 함정).

## 관련 문서

- `infra/runbooks/prod_eks_cutover.md` — EKS 컷오버 본 절차 + 결정 기록 + 함정
- `infra/runbooks/journal.txt` — 전체 작업 기록