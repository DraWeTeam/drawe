# DraWe prod 재우기(teardown) 런북

> prod 전체를 시간당 비용 ~0 으로 내린다. **destroy 가 아니라 "재우기"** — 데이터·코드·state 는 보존되고, 재기동(`prod_eks_wake`)으로 ~1시간 내 복구.
환경: WSL `~/projects/drawe-projects/drawe-deploy/` (terraform/kubectl/aws), git 은 PowerShell.
계정: prod=933832340498 / dev=570515227314. region ap-northeast-2.
> 

---

## ⚠️ 핵심 함정 3가지 (이거 때문에 이 런북이 있음)

1. **순서가 안쪽→바깥쪽.** EKS(앱) → 공유 인프라(NAT/Cache/RDS). 거꾸로 하면 의존성 꼬임.
2. **EKS 를 먼저 destroy 하면 `cutover-eks.tf` 의 `data.aws_lb.eks_ingress` 가 "0 results" 에러** → `prod-shared-infra.sh` 의 전체 plan 이 막혀 apply 못 함.
→ 해결: 공유 인프라 끄기는 스크립트 대신 **`target` + `var='eks_cutover=false'`** 로 NAT/Cache 만 직접 apply.
3. **ArgoCD 앱은 finalizer + selfHeal.** 파드 먼저 지우면 selfHeal 이 되살림 → **앱부터** 삭제. 앱/파드/ns 가 Terminating 에 걸려 branch ENI 가 안 빠지면 SG destroy 가 DependencyViolation 으로 hang(지난번 13분).

---

## 0) 계정 가드 (매 명령 전, 필수)

dev 로 프로파일이 넘어간 채 prod 끈다고 dev 를 부수는 사고 방지.

```bash
[ "$(aws sts get-caller-identity --query Account --output text)" = "933832340498" ] \
  && echo "✅ prod (933832340498)" || { echo "✘ prod 아님 — export AWS_PROFILE=drawe-prod 후 재확인"; }

aws eks update-kubeconfig --name drawe-prod --region ap-northeast-2 2>/dev/null
kubectl config current-context   # ...cluster/drawe-prod 확인
```

> `prod-shared-infra.sh` 는 계정 가드(933832340498) 내장이라 이중 안전장치. 그래도 0) 을 습관화.
> 

---

## 1) 끄기 직전 — 알람 오탐 알림 차단 (선택)

끄면 backend/fastapi/nat unhealthy 알람이 ALARM 으로 메일·Discord 를 쏜다. 노이즈 막으려면:

```bash
aws cloudwatch disable-alarm-actions --region ap-northeast-2 \
  --alarm-names drawe-prod-backend-unhealthy drawe-prod-fastapi-unhealthy \
               drawe-prod-nat-a-unhealthy drawe-prod-nat-c-unhealthy
```

(알람 자체는 남음. 재기동 후 `enable-alarm-actions` 로 복구.)

---

## 2) ArgoCD 앱 삭제 (finalizer 가 리소스 cascade 정리)

selfHeal 때문에 **앱을 먼저** 지운다. 앱 4개: backend / fastapi-embed / fastapi-guide / observability.
삭제하면 ArgoCD 가 prune 으로 파드·Service·Ingress·SGP 정리 → ALB·branch ENI 해제.

```bash
kubectl delete applications -n argocd backend fastapi-embed fastapi-guide observability

# 2~3분 넘게 Terminating 에 걸려 안 끝나면 → ArgoCD 막힌 것. finalizer 강제 제거:
#   kubectl get applications -n argocd
#   kubectl patch app <name> -n argocd -p '{"metadata":{"finalizers":null}}' --type merge
```

진행 확인:

```bash
kubectl get pods -n drawe-prod
kubectl get pods -n observability
kubectl get ingress -A | grep drawe-prod   # 사라지면 ALB 정리 트리거됨
```

---

## 3) 잔여 파드·branch ENI 강제 정리 (SG hang 방지 — 핵심)

```bash
kubectl delete pod -n drawe-prod    --all --force --grace-period=0 2>/dev/null
kubectl delete pod -n observability --all --force --grace-period=0 2>/dev/null

# branch ENI 가 다 풀렸는지 — destroy 전 반드시 0(또는 available) 확인
aws ec2 describe-network-interfaces --region ap-northeast-2 \
  --filters Name=interface-type,Values=branch \
  --query 'NetworkInterfaces[].{Id:NetworkInterfaceId,Status:Status,Desc:Description}' --output table

# EKS ALB 자동 삭제됐나 (Ingress 다 빠지면 ALB Controller 가 지움)
aws elbv2 describe-load-balancers --region ap-northeast-2 \
  --query "LoadBalancers[?starts_with(LoadBalancerName,'k8s-draweprod')].LoadBalancerName" --output text
# 비어야 정상. 남아있으면 잠시 후 재확인.
```

---

## 4) EKS 3-platform destroy

```bash
cd ~/projects/drawe-projects/drawe-deploy/eks/prod/3-platform
terraform destroy   # 약 56개 자원, 5~10분
```

- pods-db SG(예: sg-05d6…) **DependencyViolation 으로 멈추면** → 3) 의 branch ENI 가 덜 빠진 것.
in-use 면 파드 강제삭제 다시(3번) → ENI 0 되면 `terraform destroy` 재시도.
    
    ```bash
    aws ec2 describe-network-interfaces --region ap-northeast-2 \  --filters Name=interface-type,Values=branch \  --query 'NetworkInterfaces[].{Id:NetworkInterfaceId,Att:Attachment.Status}' --output table
    ```
    

---

## 5) EKS 2-cluster destroy

```bash
cd ~/projects/drawe-projects/drawe-deploy/eks/prod/2-cluster
terraform destroy   # 약 17개
# versions.tf ~> 6.0 커밋돼 있어 lock 충돌 안 남(과거 ~>5.0 paradox 해결됨)
```

확인:

```bash
aws eks list-clusters --region ap-northeast-2   # drawe-prod 없어야
```

---

## 6) 공유 인프라 off — NAT/Cache (★ 스크립트 말고 -target)

**여기가 함정 2.** EKS 를 4·5 에서 내렸으니 `prod-shared-infra.sh` 를 그냥 돌리면
`cutover-eks.tf` 의 `data.aws_lb.eks_ingress` 가 EKS ALB 를 못 찾아(0 results) 전체 plan 이 막힌다.
→ **NAT·Cache 만 `-target` 으로 직접 apply + `-var='eks_cutover=false'`** (그 data source 를 count=0 으로 스킵).

### 6-a) 먼저 tfvars 게이트 false 확인

```bash
cd ~/projects/drawe-projects/drawe-deploy/terraform-prod
grep -E 'prod_enabled|nat_enabled|cache_enabled' terraform.tfvars
# 셋 다 false 여야 함. 아니면:
sed -i 's/nat_enabled *= *true/nat_enabled = false/; s/cache_enabled *= *true/cache_enabled = false/; s/prod_enabled *= *true/prod_enabled = false/' terraform.tfvars
grep -E 'prod_enabled|nat_enabled|cache_enabled' terraform.tfvars
```

### 6-b) target apply — NAT ASG 2개 + ElastiCache[0]

```bash
terraform apply \
  -var='eks_cutover=false' \
  -target=aws_autoscaling_group.nat_a \
  -target=aws_autoscaling_group.nat_c \
  -target='aws_elasticache_replication_group.main[0]'
```

> ElastiCache 는 count 기반 → **`[0]` 인덱스 필수.**
> 

기대 plan (`yes` 치기 전 확인):

- `aws_autoscaling_group.nat_a/nat_c` : desired·min·max **1 → 0** ✅
- `aws_elasticache_replication_group.main[0]` : **destroy** ✅
- 그 외 자원 안 보임 ✅ / `target` 경고는 정상 / eks_ingress 에러 안 남
→ 맞으면 `yes`. (다른 게 섞이거나 eks_ingress 에러 다시 뜨면 멈추고 점검.)

---

## 7) RDS stop (CLI — terraform 토글 아님)

```bash
aws rds stop-db-instance --db-instance-identifier drawe-prod-mysql --region ap-northeast-2
```

> stop 이라 데이터·grafana 스키마 보존. destroy 아님.
> 

---

## 8) 최종 검증 (재우기 완료 + NAT 진짜 꺼졌나)

```bash
# EKS 없음
aws eks list-clusters --region ap-northeast-2

# NAT ASG desired 0
aws autoscaling describe-auto-scaling-groups --region ap-northeast-2 \
  --query "AutoScalingGroups[?contains(AutoScalingGroupName,'nat')].[AutoScalingGroupName,DesiredCapacity]" --output text

# NAT 인스턴스 실제 종료 (★ 지난번 안 꺼진 실수 재발 방지)
aws ec2 describe-instances --region ap-northeast-2 \
  --filters 'Name=tag:Name,Values=drawe-prod-nat-*' 'Name=instance-state-name,Values=running' \
  --query 'Reservations[].Instances[].InstanceId' --output text   # 비어야 정상

# ElastiCache 없음
aws elasticache describe-replication-groups --replication-group-id drawe-prod-valkey \
  --region ap-northeast-2 2>&1 | grep -iE 'not found|available'

# RDS stopped
aws rds describe-db-instances --db-instance-identifier drawe-prod-mysql \
  --region ap-northeast-2 --query 'DBInstances[0].DBInstanceStatus' --output text
```

---

## 끄기 후 상태 / 보존되는 것

| 자원 | 끄기 후 | 비용 |
| --- | --- | --- |
| EKS 2-cluster + 3-platform | destroyed | 0 |
| NAT ASG nat_a/nat_c | desired 0 (인스턴스 종료) | 0 |
| ElastiCache Valkey | destroyed | 0 |
| RDS drawe-prod-mysql | **stopped** (데이터·grafana 스키마 보존) | 스토리지만 |
| Loki/Tempo 로그·트레이스 | **S3 보존** | S3 스토리지만 |
| ECS (서비스/task def) | dormant 유지(prod_enabled=false) | 0 |
| SSM/VPC/SG/S3/ECR/ACM | 유지 | ~0 |
| Cloudflare api·grafana 레코드 | dangling(코드 보존) | 0 |

**시간당 비용 ~0. 잔여는 RDS·S3 스토리지뿐.**

---

## 안 건드리는 것 / 주의

- **ECS observability(Loki/Tempo/Grafana on ECS)** 는 Phase D dormant — 끄기에서 손대지 않음. EKS observability 는 2~5 에서 EKS 와 함께 destroy.
- **데이터 전부 보존** → 재기동 시 백필 재실행 불필요, grafana 대시보드/데이터소스 그대로.
- NAT 가 ASG 라 desired 0 이면 인스턴스 종료, 재기동 시 `nat_enabled=true` 로 ASG 가 **새 인스턴스(새 ID)** 1대씩 띄움. (그래서 인스턴스 ID 는 매번 바뀜 — 하드코딩 금지.)

---

## 한눈 요약

```
0) 계정 가드(933832340498)
1) (선택) 알람 disable-alarm-actions
2) ArgoCD 앱 4개 삭제 (backend/fastapi-embed/fastapi-guide/observability)  ← 앱 먼저(selfHeal)
3) 파드 강제삭제(drawe-prod + observability) → branch ENI 0 확인          ← SG hang 방지
4) eks/prod/3-platform   terraform destroy
5) eks/prod/2-cluster    terraform destroy
6) terraform-prod: tfvars 3개 false → terraform apply -var='eks_cutover=false'
     -target nat_a -target nat_c -target 'aws_elasticache_replication_group.main[0]'   ← 스크립트 X
7) aws rds stop-db-instance drawe-prod-mysql
8) 검증 (EKS 없음 / NAT 인스턴스 0 / Cache 없음 / RDS stopped)
```

## 재기동은 역순 (참고)

NAT/Cache/RDS on(`prod-shared-infra.sh --validate`, 이땐 EKS ALB 없어 에러 안 남)
→ 2-cluster → 3-platform → 오버레이 pods-db SG **새 ID로 갱신**(매번 바뀜) → 커밋
→ ArgoCD 앱 등록 → 파드 CrashLoop 시 **강제 재생성(SGP 소급 안 됨)** → DNS(eks_cutover=true, 기본값).