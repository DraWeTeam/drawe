# DraWe prod 깨우기(wake) 런북

> 재우기(`prod_eks_teardown`)로 내려둔 prod 를 **~1시간 내** 복구한다.
> 재우기는 **EKS 를 destroy** 했고 ElastiCache 도 destroy 했다. 그래서 깨우기는 사실상 **cutover 재실행** — 단 데이터(RDS·SSM·S3), 코드(ECS dormant·Cloudflare 레코드), terraform state 는 보존돼 있어 일부 단계는 생략된다.
> 순서: **바깥쪽→안쪽** (공유 인프라 NAT/Cache/RDS → EKS cluster → platform → 앱 → DNS). 재우기의 정확한 역순.
> **작업 위치(★중요): 모노레포 `/mnt/c/Temp/gp/team-monorepo/drawe` (WSL).** flat `~/projects/drawe-projects/drawe-deploy` 는 stale 라 쓰면 안 된다(함정 1). terraform/kubectl/aws 는 WSL, git 은 PowerShell.
> 계정: prod=933832340498 / region ap-northeast-2.

---

## ⚠️ 핵심 함정 6가지 (실전에서 실제로 터진 것들)

1. **반드시 모노레포에서 실행. flat `drawe-deploy` 복사본은 stale.**
   `drawe-deploy/terraform-prod` 는 .tf 내용이 옛 버전이라 같은 prod state 를 읽어도 전체 plan 이 S3(`drawe-prod-bria-ai`/artref)·SSM 시크릿·브리지 output 을 **"not in configuration"** 으로 보고 **44개를 destroy** 하려 한다(데이터 영구 손실 직전). 파일 *이름* 은 같아서 `diff` 로 안 잡힌다 — *내용* 이 다른 것.
   → **항상 `cd /mnt/c/Temp/gp/team-monorepo/drawe` 에서.** 모든 경로는 `infra/...` prefix. (`-target` 만 쓰던 재우기에선 전체 config 를 평가 안 해 이 문제가 안 드러났다가, 깨우기의 전체 plan 에서 처음 노출됨.)

2. **비밀 env 미설정 → 살아있는 RDS 비번 회전 + Cloudflare 에러.**
   원래 배포는 `TF_VAR_db_password` / `TF_VAR_valkey_auth_token` / `CLOUDFLARE_API_TOKEN` 를 **셸 env 로** 줬다. 깨울 때 이걸 안 export 하면:
   - `random_password.db[0] will be created` → `local.db_password` 가 새 랜덤이 되어 **가동 중 RDS master password 를 회전**(+SSM 도). 지뢰.
   - `provider "cloudflare"` 에러: `must provide exactly one of "api_key","api_token",...`
   → **2단계에서 SSM 의 기존 값을 읽어 env 로 핀**한다. 그러면 `random_password.*` 가 count=0 → 회전 없음.

3. **EKS ALB 가 아직 없는 동안 `eks_cutover=true` 면 막힌다 (역함정).**
   재우기에서 준 `-var='eks_cutover=false'` 는 CLI 일회성이라 tfvars 엔 안 남았다(default=true). 이 상태로 공유 인프라 plan 을 돌리면 `cutover-eks.tf` 의 `data.aws_lb.eks_ingress` 가 (없는) EKS ALB 를 찾다 **`Search returned no results`** 로 막힌다.
   → **공유 인프라 ON 전에 모노레포 tfvars 에 `eks_cutover=false`.** api·grafana 가 잠시 ECS ALB(꺼짐) 를 가리키지만 무해. **8단계**에서 `true` 로 되돌려 DNS 를 EKS 로 컷오버.

4. **재생성으로 바뀌는 SG id — 파일이 3개다.**
   EKS destroy 로 pods-db SG·클러스터 SG 가 삭제됐고 재생성 시 새 id. overlay 의 옛 id 를 안 바꾸면 backend·guide·**grafana** 가 RDS 에 못 붙는다. 위치(옛 id 동일):
   - `infra/k8s/overlays/prod/backend/kustomization.yaml`
   - `infra/k8s/overlays/prod/fastapi-guide/kustomization.yaml`
   - `infra/k8s/overlays/prod/observability/grafana-sgp.yaml` ← grafana 도 pods-db SG 로 RDS grafana 스키마에 붙음.

5. **재발급 식별자는 "바뀔 수도, 그대로일 수도" — 무조건 fresh 값으로 재설정.**
   - **클러스터 SG** : EKS 재생성이라 보통 새 id 지만, **같은 id 가 다시 나올 때도 있다**(실측: cluster SG·REDIS 는 그대로, pods-db SG 만 바뀐 케이스 있음). 같으면 sed 가 그냥 no-op 이라 무해.
   - **ElastiCache primary endpoint** : destroy→재생성이라 hostname 토큰(`...valkey.<토큰>.apn2...`)이 **바뀔 수 있다.** 단 같은 `replication_group_id` 로 재생성하면 **동일 엔드포인트가 그대로 오는 경우도 흔하다**(이때 REDIS_HOST sed 도 no-op).
   - 결론: WHY(바뀜/안바뀜) 신경 쓰지 말고 **6단계에서 `terraform output`·`aws describe` 로 fresh 값을 읽어 sed 로 재설정**하면 양쪽 케이스 다 자동 처리. (RDS 는 stop 이라 DB_HOST 불변 — 안 건드림.)

6. **SGP 는 소급 안 됨 → 첫 기동 파드는 거의 항상 재생성해야 한다 + ArgoCD targetRevision=main + selfHeal.**
   4·5 갱신 커밋은 **앱 등록(7단계) 전에 main 에 push.** EKS 재생성 직후 앱 파드는 SGP 보다 먼저 떠서 branch ENI 를 못 받는 게 사실상 기본 — pod-eni 가 없으면 **즉시 재생성**(7-1). `fastapi-guide`/`fastapi-embed` 가 Healthy 라도 안심 금지: guide 는 DB 를 lazy 로 잡고 health 에서 안 봐서 RDS 경로가 막혀도 Healthy 로 보일 수 있다(False 신호). backend·grafana 의 부팅-시-DB 가 진짜 판정.

---

## 0) 계정 가드 + 작업 위치 (매번)

```bash
export AWS_PROFILE=drawe-prod
[ "$(aws sts get-caller-identity --query Account --output text)" = "933832340498" ] \
  && echo "✅ prod (933832340498)" || { echo "✘ prod 아님 — 프로파일 전환 후 재확인"; }

cd /mnt/c/Temp/gp/team-monorepo/drawe      # ★ 모노레포. drawe-deploy 금지(함정 1)
```

---

## 1) eks_cutover=false 박기 (모노레포 tfvars, 함정 3)

```bash
cd /mnt/c/Temp/gp/team-monorepo/drawe/infra/terraform-prod
grep -qE '^\s*eks_cutover\s*=' terraform.tfvars \
  && sed -i 's/^\s*eks_cutover\s*=.*/eks_cutover = false/' terraform.tfvars \
  || printf '\neks_cutover = false\n' >> terraform.tfvars
grep eks_cutover terraform.tfvars          # eks_cutover = false
```

---

## 2) 비밀 env 핀 (★ 함정 2 — 회전·에러 방지)

기존 비번을 몰라도 SSM 에 배포 당시 값이 그대로 있다(teardown 이 SSM 은 안 건드림). 그 값을 env 로 박으면 `random_password.*` 가 count=0 → **회전이 사라진다.**

```bash
# RDS 비번을 기존 값으로 핀 → random_password.db 안 생김 → RDS 회전 없음
export TF_VAR_db_password="$(aws ssm get-parameter --name /drawe/prod/db-password \
  --with-decryption --region ap-northeast-2 --query Parameter.Value --output text)"

# Valkey 토큰도 기존 값으로 핀 → SSM redis-password 무변경(백엔드 seamless)
export TF_VAR_valkey_auth_token="$(aws ssm get-parameter --name /drawe/prod/redis-password \
  --with-decryption --region ap-northeast-2 --query Parameter.Value --output text)"

# Cloudflare Zone>DNS>Edit 토큰 (provider 가 var 비면 이 env 자동 사용)
export CLOUDFLARE_API_TOKEN='<당신의 Cloudflare DNS Edit 토큰>'

# 핀 확인(비어있으면 안 됨)
[ -n "$TF_VAR_db_password" ] && [ -n "$TF_VAR_valkey_auth_token" ] && [ -n "$CLOUDFLARE_API_TOKEN" ] \
  && echo "✅ 3개 env 세팅됨" || echo "✘ 비어있는 env 있음 — 멈춤"
```

> 이 env 들은 같은 셸 세션에서 3단계 스크립트까지 유지돼야 한다(`terraform plan` 이 상속). 셸 새로 열면 2단계 재실행.

---

## 3) 공유 인프라 ON — NAT + Cache + RDS (script --validate)

```bash
cd /mnt/c/Temp/gp/team-monorepo/drawe
bash infra/scripts/prod-shared-infra.sh --validate --plan-only   # 먼저 plan 만
```

`--validate` = **NAT=on, Cache=on, RDS=start** (prod_enabled=false 유지). RDS 는 stop→start 요청(available 3~10분), ElastiCache create.

### ★ apply 전 합격 기준 (이게 다 맞아야 함)

- `aws_autoscaling_group.nat_a/nat_c` desired **0 → 1** ✅
- `aws_elasticache_replication_group.main[0]` **create** ✅
- `random_password.db` / `random_password.valkey_auth` **"will be created" 안 보임** ✅ (핀 성공)
   - `random_password.valkey_auth[0] will be destroyed (index out of range for count)` 는 **state 정리라 무해** ✅
- `aws_ssm_parameter.db_password` / `redis_password` **변경 없음** ✅
- `aws_db_instance` password 변경 **없음** ✅
- **데이터 destroy(S3/SSM/브리지 output) 0** ✅  ← 하나라도 있으면 함정 1(stale dir) 의심, 멈춤

무해한 동반 변경(정상):
- 알람 dimension 이 `app/k8s-draweprod-…` → `app/drawe-prod-alb` (eks_cutover=false 라 모니터링이 ECS ALB 로 임시 전환, 8단계서 복귀)
- `cloudflare api`/`grafana` content → ECS ALB (임시), grafana **이름은 `grafana.drawe.xyz` 그대로**
- `launch_template.ecs` image_id / `ecs_task_definition.backend` 교체 → **ECS dormant(desired 0)** 라 무해
- 신규 알람(`fastapi_unhealthy`) 생성 → 노이즈만

맞으면 apply:

```bash
bash infra/scripts/prod-shared-infra.sh --validate            # y 로 확인
# 또는 저장된 plan 적용:
# terraform -chdir=infra/terraform-prod apply tfplan
```

> 참고: 알람이 ECS ALB(꺼짐) 를 보게 돼 잠깐 ALARM→SNS(Discord/메일) 노이즈가 날 수 있다. EKS 뜨면 8단계서 복귀. 거슬리면 apply 후 `aws cloudwatch disable-alarm-actions ...` 로 잠재웠다가 마지막(11단계)에 재활성화.

대기/확인:

```bash
aws autoscaling describe-auto-scaling-groups --region ap-northeast-2 \
  --query "AutoScalingGroups[?contains(AutoScalingGroupName,'nat')].[AutoScalingGroupName,DesiredCapacity]" --output text
aws rds describe-db-instances --db-instance-identifier drawe-prod-mysql \
  --region ap-northeast-2 --query 'DBInstances[0].DBInstanceStatus' --output text        # available
aws elasticache describe-replication-groups --replication-group-id drawe-prod-valkey \
  --region ap-northeast-2 --query 'ReplicationGroups[0].Status' --output text             # available
```

---

## 4) EKS 2-cluster 생성

```bash
cd /mnt/c/Temp/gp/team-monorepo/drawe/infra/eks/prod/2-cluster
terraform init && terraform apply        # 약 17개, ~10분 (versions.tf ~>6.0 라 lock 충돌 없음)

aws eks update-kubeconfig --name drawe-prod --region ap-northeast-2
kubectl config current-context           # ...cluster/drawe-prod
kubectl get nodes                        # 시스템 NG(t4g.large) Ready
```

---

## 5) EKS 3-platform 설치

```bash
cd /mnt/c/Temp/gp/team-monorepo/drawe/infra/eks/prod/3-platform
terraform init && terraform apply        # ALB Controller·Karpenter·ESO·ArgoCD·IRSA·pods-db SG, ~10분

kubectl get clustersecretstore aws-ssm
kubectl get pods -n kube-system | grep -E "load-balancer|karpenter"
kubectl get pods -n external-secrets
kubectl get pods -n argocd
```

> ESO bootstrap race 로 멈추면: `helm uninstall external-secrets -n external-secrets` → `terraform apply`.

---

## 6) ★ 재생성된 식별자 갱신 — SG id ×3파일 + REDIS_HOST (함정 4·5·6)

앱 등록 **전에** overlay 를 새 값으로 맞추고 **main 에 push** (ArgoCD 가 main 만 봄).

### 6-a) 새 값 수집

```bash
NEW_CLUSTER=$(cd /mnt/c/Temp/gp/team-monorepo/drawe/infra/eks/prod/2-cluster && terraform output -raw cluster_security_group_id)
NEW_PODSDB=$(cd /mnt/c/Temp/gp/team-monorepo/drawe/infra/eks/prod/3-platform && terraform output -raw pods_db_security_group_id)
NEW_REDIS=$(aws elasticache describe-replication-groups --replication-group-id drawe-prod-valkey \
  --region ap-northeast-2 --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' --output text)
echo "cluster=$NEW_CLUSTER"; echo "pods-db=$NEW_PODSDB"; echo "redis  =$NEW_REDIS"
```

옛 값(현재 하드코딩): pods-db `sg-05d63299e0850d902` / 클러스터 `sg-01cd9b17e6765c840` / REDIS_HOST `master.drawe-prod-valkey.c0hrlm.apn2.cache.amazonaws.com`.
(DB_HOST `drawe-prod-mysql.cds86q4oy48b...` 는 RDS stop 이라 **불변 — 안 건드림**.)

> 셋 중 일부가 옛 값과 **동일하게 나올 수 있다**(실측: cluster SG·REDIS 가 그대로고 pods-db SG 만 바뀐 케이스). 같으면 sed 가 no-op 이라 정상 — 6-c diff 에 그 줄이 안 뜰 뿐. 어느 게 바뀌든 fresh 값으로 sed 하면 끝.

### 6-b) 치환

```bash
cd /mnt/c/Temp/gp/team-monorepo/drawe/infra/k8s/overlays/prod
for f in backend/kustomization.yaml fastapi-guide/kustomization.yaml observability/grafana-sgp.yaml; do
  sed -i "s/sg-05d63299e0850d902/$NEW_PODSDB/g; s/sg-01cd9b17e6765c840/$NEW_CLUSTER/g" "$f"
done
sed -i "s#master\.drawe-prod-valkey\.[a-z0-9]*\.apn2\.cache\.amazonaws\.com#$NEW_REDIS#g" \
  backend/kustomization.yaml
```

### 6-c) diff 검증 → 커밋 → push (git 은 PowerShell)

```bash
git -C /mnt/c/Temp/gp/team-monorepo/drawe diff -- infra/k8s/overlays/prod   # SG 2종 + REDIS_HOST 만
```
```powershell
git add infra/k8s/overlays/prod
git commit -m "chore(prod): EKS 재생성에 따른 SG id + Redis 엔드포인트 갱신"
git push origin main
```

---

## 7) 앱 등록 (ArgoCD Applications)

```bash
kubectl apply -f /mnt/c/Temp/gp/team-monorepo/drawe/infra/k8s/argocd/apps/prod/
kubectl get applications -n argocd                       # backend/fastapi-embed/fastapi-guide/observability
kubectl get pods,externalsecret,ingress -n drawe-prod
kubectl get pods -n observability
```

기대: 파드 `1/1 Running`, ExternalSecret `SecretSynced=True`, Ingress 에 ALB DNS 생성.

### 7-1) ★ pod-eni 확인 → 없으면 즉시 재생성 (기본 절차 — 거의 항상 필요)

EKS 재생성 직후엔 **앱 파드가 SGP 보다 먼저 떠서 branch ENI 를 못 받는 게 거의 기본값**이다(실측: backend·**fastapi-guide**·grafana **셋 다** 첫 기동 시 pod-eni 없어 RDS 3306 timeout). SGP 는 **소급 적용 안 됨** — 고쳐도 기존 파드엔 안 붙으니 **재생성이 유일한 처방**. CrashLoop 을 기다리지 말고 등록 직후 바로 확인한다.

> ⚠️ **fastapi-guide 는 빠뜨리기 쉽다 (False 신호).** guide 는 DB 를 lazy 로 잡고 health 에서 DB 를 안 봐서, RDS 가 막혀도 **`Synced/Healthy` 로 떠 있다.** 그래서 backend·grafana 만 고치고 넘어가면, 앱은 멀쩡한데 **레퍼런스 썸네일만 공백 + 브라우저 콘솔에 CORB(Cross-Origin Read Blocking)** 가 뜬다(레퍼런스 이미지는 `api/.../image/{refId}` → guide → presigned artref S3 경로인데, guide 가 RDS 메타를 못 읽어 이미지 대신 에러를 반환 → 브라우저가 CORB 차단). guide 도 backend·grafana 와 **함께 pod-eni 확인·재생성**한다.

```bash
# pod-eni 가 비어있으면(이름만 나오면) SGP 미부착 = node SG 통신 = RDS timeout 예약
for app in backend fastapi-guide; do
  echo "== drawe-prod/$app =="
  kubectl get pod -n drawe-prod -l app=$app \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.annotations.vpc\.amazonaws\.com/pod-eni}{"\n"}{end}'
done
echo "== observability/grafana =="
kubectl get pod -n observability -l app=grafana \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.annotations.vpc\.amazonaws\.com/pod-eni}{"\n"}{end}'
```

> SGP 대상 = pods-db SG 를 다는 파드: **backend / fastapi-guide / grafana**. (fastapi-embed 는 SGP 없음 — DB 안 써서 재생성 불필요.)

**비어있으면(거의 그렇다) → 재생성.** (단, 재생성 전에 6단계 SG 가 main 에 push 되고 ArgoCD synced 인지, RDS SG 가 새 pods-db SG 를 3306 으로 허용하는지 확인. 아래 7-2 참조)

```bash
kubectl delete pod -n drawe-prod    -l app=backend
kubectl delete pod -n drawe-prod    -l app=fastapi-guide
kubectl delete pod -n observability -l app=grafana
# ArgoCD selfHeal 이 즉시 새 파드 → 이번엔 SGP 살아있어 branch ENI 받음
```

재생성 후 같은 명령으로 다시 확인 — 이번엔 이름 뒤에 `[{"eniId":"eni-...","associationID":"trunk-assoc-..."}]` 가 나와야 정상. 그러면 DB timeout 사라지고 backend 는 `Started DraweBackendApplication`, guide 는 `Application startup complete` + RDS timeout 소멸 → 레퍼런스 썸네일도 복구(프론트 Ctrl+Shift+R 또는 새 추천으로 캐시된 빈 결과 갱신).

### 7-2) 재생성해도 pod-eni 가 여전히 비면 (드묾) — 진단

```bash
# A) 살아있는 SGP 가 새 SG 를 가리키나 (옛 sg-05d6… 면 push/sync 안 된 것)
kubectl get sgp -n drawe-prod -o jsonpath='{range .items[*]}{.metadata.name}{": "}{.spec.securityGroups.groupIds}{"\n"}{end}'
# B) 파드가 nitro 노드인가 (t4g 시스템노드면 SGP 미지원 — 함정 6/7. 단 system NG 는 taint 라 보통 안 감)
kubectl get pod -n drawe-prod -l app=backend -o wide
kubectl get nodes -L node.kubernetes.io/instance-type,karpenter.sh/nodepool
# C) RDS SG 가 새 pods-db SG 를 3306 허용하나 (3-platform ingress)
aws ec2 describe-security-groups --group-ids <RDS_SG_id: sg-0f963e6960b7816da> --region ap-northeast-2 \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`3306`].UserIdGroupPairs[].GroupId' --output text
```
A 가 옛 SG → `git show origin/main:.../backend/kustomization.yaml | grep sg-` 로 push 확인 후 `kubectl annotate app backend -n argocd argocd.argoproj.io/refresh=hard --overwrite`. A·C 정상인데도 B 가 비면 거의 "SGP 소급 안 됨" 이라 7-1 재생성 반복.

---

## 8) dark 검증 (DNS 는 아직 ECS)

```bash
TGARN=$(kubectl get targetgroupbindings -n drawe-prod \
  -o jsonpath='{.items[?(@.spec.serviceRef.name=="backend")].spec.targetGroupARN}')
aws elbv2 describe-target-health --region ap-northeast-2 --target-group-arn "$TGARN"   # healthy

kubectl port-forward -n drawe-prod svc/backend 8080:8080 &
curl http://localhost:8080/actuator/health/readiness    # UP

kubectl logs deploy/backend -n drawe-prod --tail=200 | grep -iE "error|exception|timeout|failed"
# DB Communications link failure / Redis SSL handshake / SSM 오류 없으면 OK
```

---

## 9) DNS 컷오버 — eks_cutover=true 되돌리고 apply (함정 3 마무리)

EKS ALB 가 실제로 생겼으니 `data.aws_lb.eks_ingress` 가 resolve 됨.

```bash
cd /mnt/c/Temp/gp/team-monorepo/drawe/infra/terraform-prod
sed -i 's/^\s*eks_cutover\s*=.*/eks_cutover = true/' terraform.tfvars
grep eks_cutover terraform.tfvars
terraform plan      # data.aws_lb.eks_ingress 1개 read + cloudflare api/grafana → EKS ALB
terraform apply
```

> 이 apply 도 같은 셸(2단계 env 유지)에서. 새 셸이면 2단계 env export 먼저.

---

## 10) 최종 검증

```bash
curl -I https://api.drawe.xyz/actuator/health/readiness    # HTTP/2 200
```
- 브라우저 **OAuth 로그인 1회** (멀티파드 Valkey 공유 세션 e2e). 이게 성공해야 완료.
- backend 로그에 DB/Redis 연결 오류, ERROR/FATAL 없음(5분 관찰). Cloudflare 5xx<0.5%(10분).

---

## 11) 알람 재활성화 (재우기 1단계의 역 — 맨 끝)

```bash
aws cloudwatch enable-alarm-actions --region ap-northeast-2 \
  --alarm-names drawe-prod-backend-unhealthy drawe-prod-fastapi-unhealthy \
               drawe-prod-nat-a-unhealthy drawe-prod-nat-c-unhealthy
```

---

## 성공 기준 (체크리스트)

- [ ] NAT ASG nat_a/nat_c desired **1**, 인스턴스 running
- [ ] RDS `available`, ElastiCache `available`
- [ ] (공유 인프라 plan) `random_password.*` create 없음, db_password/redis_password 무변경, 데이터 destroy 0
- [ ] `kubectl get nodes` Ready, Karpenter 노드 nitro 패밀리
- [ ] ClusterSecretStore aws-ssm `Ready=True`, ExternalSecret `SecretSynced=True`
- [ ] ArgoCD 4앱 `Synced`+`Healthy`
- [ ] backend ×2 / fastapi-embed / fastapi-guide / grafana·loki·tempo `1/1` 안정(5분)
- [ ] backend·**fastapi-guide**·grafana 파드에 `vpc.amazonaws.com/pod-eni`(eni-…/trunk-assoc) 존재 — **없으면 재생성(7-1) 후 재확인**
- [ ] 프론트에서 가이드 **레퍼런스 썸네일(참고 1/2/3) 정상 표시** — 공백 + 콘솔 CORB 면 guide 가 RDS 못 붙은 것(7-1 guide 재생성)
- [ ] ALB target group healthy
- [ ] `curl -I https://api.drawe.xyz/.../readiness` 200, OAuth 로그인 1회 성공
- [ ] DB/Redis 연결 오류 로그 없음

---

## 한눈 요약

```
0) 계정 가드(933832340498) + cd 모노레포(team-monorepo/drawe)   ← flat drawe-deploy 금지(함정 1)
1) infra/terraform-prod tfvars: eks_cutover=false               ← EKS ALB 아직 없음(함정 3)
2) ★ 비밀 env 핀(SSM 에서 read):
     TF_VAR_db_password / TF_VAR_valkey_auth_token / CLOUDFLARE_API_TOKEN   ← 회전·에러 방지(함정 2)
3) bash infra/scripts/prod-shared-infra.sh --validate
     합격기준: NAT 0→1 + ElastiCache create, random_password 생성 없음, 데이터 destroy 0
     → RDS/Cache available 대기
4) infra/eks/prod/2-cluster   terraform apply → update-kubeconfig → nodes Ready
5) infra/eks/prod/3-platform  terraform apply → ESO/ALB/Karpenter/ArgoCD 확인
6) ★ 새 SG id ×3파일(backend·fastapi-guide·grafana-sgp) + backend REDIS_HOST → main push
7) kubectl apply -f infra/k8s/argocd/apps/prod/  → 4앱
     ★ 등록 직후 pod-eni 확인 → 거의 항상 비어있음 → backend·**fastapi-guide**·grafana 파드 재생성(SGP 소급 X)
     (guide 는 Healthy 로 떠도 DB 막힘=False 신호 → 빠뜨리면 레퍼런스 썸네일 공백+CORB)
     → 재생성 파드에 eni-...trunk-assoc 붙으면 1/1 Running
8) dark 검증(port-forward readiness + target health + 로그)
9) tfvars eks_cutover=true → terraform apply   ← DNS 를 EKS ALB 로
10) curl api.drawe.xyz 200 + OAuth 로그인 1회
11) enable-alarm-actions
```

### 재우기와의 대칭 (참고)

| 자원 | 재우기 때 | 깨우기 때 | 갱신 필요? |
| --- | --- | --- | --- |
| EKS 2-cluster/3-platform | destroy | apply | pods-db SG 보통 새 id, **클러스터 SG 는 같을 수도** → overlay 3파일은 무조건 fresh 값으로 |
| ElastiCache | destroy | 재생성(기존 토큰 핀) | SSM redis-password 무변경, primary endpoint **바뀔 수도/그대로일 수도** → REDIS_HOST 무조건 fresh 값으로 |
| RDS | stop | start(기존 비번 핀) | 엔드포인트·비번 불변 → DB_HOST 그대로 |
| NAT ASG | desired 0 | desired 1 | 인스턴스 ID 새로 발급(하드코딩 없음) |
| Cloudflare api/grafana | ECS ALB(임시) | eks_cutover=true 로 EKS ALB | — |
| ECS | dormant 유지 | dormant 유지 | — |

### 작업 위치 메모

- 정식 TFDIR = **모노레포 `/mnt/c/Temp/gp/team-monorepo/drawe/infra/terraform-prod`**. 스크립트도 모노레포 루트에서 실행하면 `find_tfdir` 가 `infra/terraform-prod` 로 잡는다.
- flat `~/projects/drawe-projects/drawe-deploy` 는 stale(.tf 내용 옛 버전) → 전체 plan 이 44 destroy. **나중에 정리하거나 삭제.** 둘을 섞어 쓰면 재발.
- 비밀값(db_password/valkey_auth_token/cloudflare token)은 git 에 없다(secret). 깨울 때 env 로 핀하되, 값은 **SSM 의 기존 값을 read** 해서 쓰면 회전 없이 안전.
