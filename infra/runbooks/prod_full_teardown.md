# DraWe prod 완전 정리(teardown) & 복구 런북

> 배치 위치: `infra/runbooks/prod_full_teardown.md`
>
> **실행일 2026-07-28.** `prod_eks_teardown.md`(재우기)와 목표가 다르다. 저건 "시간당 비용 ~0,
> 데이터는 AWS에 그대로". 이건 **자원을 실제로 지워 청구를 0으로 만들고, 백업으로 되살린다.**
> `dev_full_teardown.md` 6장("prod 종료 시")의 골격을 실행한 기록이며, 그 표의 dev↔prod 차이를
> 실측으로 채운 판본이다.
>
> 계정: **prod=933832340498** / dev=570515227314(2026-07-17 정리 완료). region ap-northeast-2.
> 환경: WSL `~/projects/drawe-projects/drawe-deploy/` (terraform/kubectl/aws), git 은 PowerShell.

---

## 0. 정리 전 실측 (2026-07-28)

**7월 MTD 27일 $481.90 → 월 환산 ~$535.** 6월($78.25)에서 급증한 건 EKS·관측 스택이
본격 가동됐기 때문이다. dev($53.85/월)와는 자릿수가 다르다.

| 서비스 | 7월 MTD | 실체 |
| --- | --- | --- |
| EC2 Compute | $163.06 | EKS 노드 5대 — 관리형 t4g.large ×2($87, **온디맨드**) + Karpenter spot m7g.large ×3 |
| AMP | $70.39 | MetricSampleCount |
| EKS 컨트롤플레인 | $52.72 | perCluster 시간당 |
| RDS | $35.25 | db.t4g.small + gp3 50GB |
| CloudWatch | $30.03 | **VendedLog-Bytes $28.29** = `/aws/eks/drawe-prod/cluster` 7.1GB |
| ELB | $26.21 | ALB 2개 (ECS `drawe-prod-alb` + k8s ingress) |
| ElastiCache | $19.78 | Valkey cache.t4g.small |
| VPC | $18.84 | **PublicIPv4:InUseAddress $17.70** |
| EC2-Other | $14.21 | EBS gp3 7개 248GB |
| ECR / Bedrock / S3 / R53 | $6.84 | ECR 57GB(buildcache 포함) |
| Tax | $43.80 | |

리전 분포: ap-northeast-2 $435.00 / us-west-2 $2.26(Bedrock Stability) / us-east-1 $0.34(CE) / global $0.50(R53).
**즉 비용은 사실상 전부 서울 리전의 drawe-prod다.**

Terraform 자원 **288개** = terraform-prod 192 + eks/prod/2-cluster 20 + eks/prod/3-platform 76(실자원 59).

---

## ⚠️ dev 함정 F1~F9의 prod 판정 (★ 다른 것만 실행 전 반드시 확인)

| # | dev | **prod 실측** |
| --- | --- | --- |
| **F1** `skip_final_snapshot` | `true` → 경고 없이 소실 | **반전.** `false` + **`deletion_protection = true`** → destroy 가 **거부된다.** 먼저 보호를 꺼야 하고, 대신 최종 스냅샷이 자동 생성된다 |
| **F2** `force_destroy` 없음 | artref/bria 2개 | **성립·확대.** artref·bria·**loki·tempo 4개 전부** 없음 → 비워야 destroy 통과 |
| **F3** `eks_cutover` | 기본 true → plan 전체 차단 | **성립.** `cutover-eks.tf:30` `count = (var.eks_cutover && override=="") ? 1 : 0` → **`-var='eks_cutover=false'`** 로 해소 |
| **F4** SSM 실값 | 28개 | **성립.** `/drawe/prod` **27개**, `CHANGE_ME` 잔존 0, 빈 값 0. TF 관리 27 = 전량(dev와 달리 TF 밖 수동 파라미터 없음 — `grafana-admin-password` 도 `ssm.tf` 의 `random_password.grafana_admin` 소유) |
| **F5** selfHeal/finalizer | 미실증 | **실전.** 단 이번엔 앱 4개가 finalizer 개입 없이 정상 종료됨(§2 참조) |
| **F6** Karpenter state 밖 | 미실증 | **실전.** `module.platform.helm_release.karpenter` + `kubectl_manifest.nodepool` 이 3-platform state 안 → **NodeClaim 을 컨트롤러 살아있을 때 먼저 회수** |
| **F7** stop 은 답이 아님 | 7일 강제 기동 | 이번엔 stop 자체를 쓰지 않음(삭제가 목표). `enable_cost_schedule` 스케줄 0개는 prod 도 동일 |
| **F8** RDS 접근 경로 | NAT에 instance profile 없음 | **완화.** prod `nat-instance.tf:118` 에 `aws_iam_instance_profile.nat_instance` **있음**. 다만 이번엔 더 나은 경로를 씀(§1-D) |
| **F9** state 부재 ≠ 고아 | EIP·SG·로그그룹 | §4 스윕에서 재검증 |

### ★ prod 고유 함정 4개 (dev 에 없던 것)

> P1·P2 는 백업 단계에서, P3 는 덤프 단계에서, **P4(최종 스냅샷 이름이 거짓)** 는 정리 직후에 만난다.
> P4 는 §3-B 참조 — 되돌릴 수 없는 유형이라 여기 목록에도 이름을 남긴다.

**P1 — `.env` 의 DB 암호가 낡았다.**
`terraform-prod/.env` 의 `TF_VAR_db_password` 와 SSM `/drawe/prod/db-password` **값이 다르다.**
실제 RDS 마스터 암호는 **SSM 쪽**이다(§1-D 의 mysqldump 인증 성공이 증명).
→ **복구 시 `.env` 를 그대로 믿고 apply 하면 스냅샷 복원 DB와 영구 불일치**한다. SSM 값이 정본.

**P2 — `.env` 사본이 둘이고 WSL 쪽이 오타본이다.**

| 사본 | 키 | 값 |
| --- | --- | --- |
| WSL `~/projects/.../terraform-prod/.env` | `TF_VAR_valkey_password` ← **오타(존재하지 않는 변수)** | 동일 |
| Windows repo `infra/terraform-prod/.env` | `TF_VAR_valkey_auth_token` ← **정본** | 동일 |

값 자체는 3개 키 모두 동일(sha256 앞 8자 일치). **destroy/복구는 Windows 사본을 쓸 것.**
오타본을 source 하면 `var.valkey_auth_token` 이 빈 값이 되어 `random_password.valkey_auth[0]` 이
plan 에 나타난다. (state 에 `random_password` 가 **하나도 없다** = 과거 apply 는 TF_VAR 주입으로 됐다는 증거.)

**P3 — 덤프 파드에 `app=backend` 라벨을 붙이면 실사용자 트래픽을 먹는다.**
SGP `backend-rds` 의 selector 가 `app: backend` 인데, **backend Service 의 selector 도 `app: backend`** 다.
그 라벨로 mysql 파드를 띄우면 Service 엔드포인트에 합류해 502 를 유발한다.
→ **전용 SGP(`dbdump-rds`, selector `app: dbdump`)를 임시로 만들어 쓸 것**(§1-D).

---

## 1. 백업 — 되돌릴 수 없는 지점 전에 전부

실측 결과 **12G** / 소요 약 25분. `~/drawe-prod-backup-20260728/`, `chmod 700`.

```bash
export AWS_PROFILE=drawe-prod AWS_REGION=ap-northeast-2
[ "$(aws sts get-caller-identity --query Account --output text)" = "933832340498" ] \
  && echo "✅ prod" || { echo "✘ prod 아님 — 중단"; }
BK=~/drawe-prod-backup-20260728; mkdir -p $BK/{ssm,tfstate,tfvars,db,s3,ecr}; chmod 700 $BK
```

### 1-B. SSM 27개 (F4)

```bash
aws ssm get-parameters-by-path --path /drawe/prod --recursive --with-decryption \
  --query 'Parameters[].{Name:Name,Type:Type,Value:Value}' --output json > $BK/ssm/drawe-prod-ssm.json
chmod 600 $BK/ssm/drawe-prod-ssm.json
# 검증: 27 / CHANGE_ME 0 / 빈 값 0
jq -r '.[] | "aws ssm put-parameter --name \"\(.Name)\" --type \(.Type) --value \(.Value|@sh) --overwrite"' \
  $BK/ssm/drawe-prod-ssm.json > $BK/ssm/restore-ssm.sh
chmod 700 $BK/ssm/restore-ssm.sh && bash -n $BK/ssm/restore-ssm.sh
```

> 값은 **절대 stdout 으로 출력하지 말 것**(에이전트 트랜스크립트에 남는다). 개수·이름·해시만 확인.

### 1-C. .env + tfvars + tfstate 3종

```bash
cp /mnt/c/Temp/gp/team-monorepo/drawe/infra/terraform-prod/.env $BK/tfvars/terraform-prod.env.windows-copy  # ★ P2 정본
cp ~/projects/drawe-projects/drawe-deploy/terraform-prod/.env    $BK/tfvars/terraform-prod.env
cp ~/projects/drawe-projects/drawe-deploy/terraform-prod/terraform.tfvars $BK/tfvars/
chmod 600 $BK/tfvars/*

# ★ dev 와 state 키 구조가 다르다. dev=prod/... 가 아니라 drawe/prod/...
for k in drawe/prod/terraform.tfstate eks/prod/cluster/terraform.tfstate eks/prod/platform/terraform.tfstate; do
  aws s3 cp "s3://drawe-tfstate-933832340498/$k" "$BK/tfstate/$(echo $k | tr '/' '_')"
done
```

> 버킷 이름도 dev(`drawe-terraform-state-570515227314`)와 **다르다**: `drawe-tfstate-933832340498`.
> 실측 크기 468K / 58K / 184K.

### 1-D. RDS — 스냅샷 + mysqldump (F1 반전, F8 완화, P3)

```bash
SNAP=drawe-prod-mysql-final-20260728
aws rds create-db-snapshot --db-instance-identifier drawe-prod-mysql --db-snapshot-identifier $SNAP
echo $SNAP > $BK/db/snapshot-id.txt
aws rds wait db-snapshot-completed --db-snapshot-identifier $SNAP
```

> 실측 `KmsKeyId` = **`alias/aws/rds`**(AWS 관리형, `5254966c…`) → **CMK 삭제와 무관.**
> 계정의 비-aws KMS 2개(`cloudtrail-log-key`, `security-lab-key`)는 이미 `PendingDeletion` 이다.

**논리 덤프 — 전용 SGP + 임시 파드**(P3. dev 의 "valkey SG 임시 추가"보다 깨끗하고 원복이 필요 없다):

```bash
PWD_=$(jq -r '.[]|select(.Name=="/drawe/prod/db-password")|.Value' $BK/ssm/drawe-prod-ssm.json)  # ★ SSM 이 정본(P1)
kubectl -n drawe-prod create secret generic dumpjob \
  --from-literal=MYSQL_PWD="$PWD_" \
  --from-literal=DBHOST="drawe-prod-mysql.cds86q4oy48b.ap-northeast-2.rds.amazonaws.com"

cat <<'EOF' | kubectl apply -f -
apiVersion: vpcresources.k8s.aws/v1beta1
kind: SecurityGroupPolicy
metadata: { name: dbdump-rds, namespace: drawe-prod }
spec:
  podSelector: { matchLabels: { app: dbdump } }     # ★ app=backend 금지(P3)
  securityGroups: { groupIds: [ sg-0ce73e01249357fe2, sg-01cd9b17e6765c840 ] }
---
apiVersion: v1
kind: Pod
metadata: { name: dbdump, namespace: drawe-prod, labels: { app: dbdump } }
spec:
  restartPolicy: Never
  containers:
  - name: mysql
    image: mysql:8.4                                 # 노드가 Graviton → arm64 매니페스트 필요(공식 이미지 OK)
    command: ["sleep","3600"]
    envFrom: [ { secretRef: { name: dumpjob } } ]
EOF
kubectl -n drawe-prod wait --for=condition=Ready pod/dbdump --timeout=180s

kubectl -n drawe-prod exec dbdump -- sh -c 'mysqldump -h $DBHOST -u drawe_admin \
  --databases drawe_db drawe_guide grafana \
  --single-transaction --routines --triggers --events --set-gtid-purged=OFF | gzip -c > /tmp/dump.sql.gz'
kubectl -n drawe-prod cp dbdump:/tmp/dump.sql.gz $BK/db/drawe-prod-20260728.sql.gz

kubectl -n drawe-prod delete pod dbdump secret dumpjob securitygrouppolicy dbdump-rds
```

> ★ **인증 성공 자체가 "이 암호 = 현재 RDS 마스터 암호 = 스냅샷 암호"의 증명**이고,
> 이번엔 그게 **P1(.env 와 SSM 불일치)의 판정**이기도 했다.
> ★ **DB가 dev 의 2개가 아니라 3개다** — `drawe_db` · `drawe_guide` · **`grafana`**(Grafana 상태 RDS 저장).
> 실측: 76.7MB gz / **CREATE TABLE 103개** / "Dump completed" 정상 종료.

### 1-E. S3 (F2 — 4개 전부)

```bash
aws configure set default.s3.max_concurrent_requests 20
aws s3 sync s3://drawe-prod-artref  $BK/s3/artref/
aws s3 sync s3://drawe-prod-bria-ai $BK/s3/bria/
# 대조 (du -sb 아님 — 파일 바이트 합)
find $BK/s3/artref -type f -printf '%s\n' | paste -sd+ | bc     # 8927120004 = S3 Total Size
find $BK/s3/artref -type f | wc -l                              # 31342
```

실측 **artref 31,342개 / 8,927,120,004B · bria 55개 / 102,655,494B — 개수·바이트 완전 일치.**
loki(10,296개/81MB)·tempo(2,204개/164MB)는 관측 데이터라 백업 대상에서 제외(정리 대상).

### 1-F. ECR — **비우지 말 것**, 대신 이미지를 내려받을 것

3개 repo 모두 `force_delete = true`(`ecr.tf` ×2, `ecs-guide.tf` ×1) → destroy 가 이미지째 지운다.
dev 때는 "prod 가 살아 있으니 중복 보관"이라며 스킵했지만, **이번이 그 마지막 사본을 내리는 시점이다.**

**Docker Desktop 이 꺼져 있으면 `crane`**(단일 정적 바이너리, sudo 불필요):

```bash
mkdir -p ~/bin && curl -fsSL \
  https://github.com/google/go-containerregistry/releases/latest/download/go-containerregistry_Linux_x86_64.tar.gz \
  | tar xz -C ~/bin crane && chmod +x ~/bin/crane
REG=933832340498.dkr.ecr.ap-northeast-2.amazonaws.com
aws ecr get-login-password | ~/bin/crane auth login $REG -u AWS --password-stdin
~/bin/crane pull --format=tarball $REG/drawe-prod-fastapi-guide:latest $BK/ecr/fastapi-guide-latest.tar
~/bin/crane pull --format=tarball $REG/drawe-prod-fastapi:latest       $BK/ecr/fastapi-embed-latest.tar
```

> **왜 이 둘인가 — 가중치 핀 여부가 기준이다.**
> - `Dockerfile.guide`: **`usyd-community/vitpose-base`(커뮤니티 리포, revision 미핀)** + open_clip ViT-L-14 → **재빌드 시 조용히 다른 가중치가 들어오거나 404.** 최우선.
> - `Dockerfile`(embed): `openai/clip-vit-large-patch14` — HF 정본이라 위험은 낮지만 3분·2GB 보험.
> - `drawe-prod-backend`: 모델 없음(Spring) → git 에서 재빌드 가능, 백업 불요.
>
> 실측 2.0G + 1.5G. repo 합계 57GB 중 대부분은 **buildcache**(실이미지보다 크다. `ecr.tf` lifecycle
> "untagged 1일 후 삭제"가 안 먹는 듯 — 별건이지만 dev 때부터 반복 관찰됨).

### 1-G. 봉인

```bash
cd $BK && sha256sum ssm/*.json tfvars/* tfstate/* db/*.sql.gz ecr/*.tar > MANIFEST.sha256
du -sh $BK      # 실측 12G
```

> **여기까지가 되돌릴 수 있는 마지막 지점.** 1-D·1-E 대조가 통과하지 않았으면 2장으로 가지 말 것.
> 백업에는 평문 시크릿과 사용자 데이터가 들어 있다 — repo/Slack/Drive 금지. 장기 보관은 `age -p`/`gpg -c`.

---

## 2. 정리 (안쪽 → 바깥쪽)

**실측 총 259자원 destroy** = 3-platform 59 + 2-cluster 17 + terraform-prod 183. 소요 약 50분.

### 2-A. 알람 오탐 차단 (선택이지만 권장)

```bash
aws cloudwatch disable-alarm-actions \
  --alarm-names $(aws cloudwatch describe-alarms --query 'MetricAlarms[].AlarmName' --output text)   # 실측 17개
```

### 2-B. ArgoCD 앱 4개 → 파드 → ENI (F5)

```bash
kubectl delete applications -n argocd backend fastapi-embed fastapi-guide observability
kubectl get pods -A; kubectl get ingress -A
aws ec2 describe-network-interfaces --filters Name=interface-type,Values=branch --query 'length(NetworkInterfaces)'
aws elbv2 describe-load-balancers --query "LoadBalancers[?starts_with(LoadBalancerName,'k8s-draweprod')].LoadBalancerName"
```

실측: **finalizer 개입이 필요 없었다.** 앱·파드·ns 가 스스로 정리되고 branch ENI 는 1개→0,
k8s ingress ALB(`k8s-draweprod-f1b562a804`)는 ALB Controller 가 자동 삭제했다.
`prod_eks_teardown.md` 가 경고한 13분 hang 은 재현되지 않았다.

### 2-C. ★ Karpenter NodeClaim 회수 — **F6 가 실제로 터진 지점**

```bash
kubectl delete nodeclaims --all --timeout=300s
kubectl get nodeclaims; kubectl get nodes
```

**여기서 끝났다고 보면 안 된다.** 실측에서 이런 일이 있었다:

1. NodeClaim 3개(m7g.large spot)를 지우자 Karpenter 가 **곧바로 새 노드(c7g.medium)를 프로비저닝**했다.
   앱이 사라져도 kube-system/argocd 파드가 재배치되면서 시스템 노드그룹(t4g.large ×2)에 안 들어갔기 때문이다.
2. 그 상태로 3-platform destroy 를 돌리자 — terraform 은 의존 역순으로 nodepool·ec2nodeclass 를 먼저 지우고
   `helm_release.karpenter`(컨트롤러)까지 지운 뒤 — **`helm_release.karpenter_crd` 에서 5분 타임아웃**으로
   `Error: uninstallation completed with 1 error(s): context deadline exceeded` 를 냈다.
3. 원인: NodeClaim `default-b9mpx` 가 **`karpenter.sh/termination` finalizer** 를 단 채 남았는데
   **finalize 해줄 컨트롤러가 이미 없다** → CRD 삭제가 영원히 안 끝난다.
   그 사이 EC2 `i-048993c1e5ab2be04` 는 **아무도 회수하지 않는 고아 과금 인스턴스**였다.

**해소:**

```bash
kubectl patch nodeclaim <name>   -p '{"metadata":{"finalizers":null}}' --type merge
kubectl patch ec2nodeclass default -p '{"metadata":{"finalizers":null}}' --type merge
# 태그로 고아 전수 종료 (state 에 없으므로 이것 말고는 찾을 방법이 없다)
aws ec2 terminate-instances --instance-ids $(aws ec2 describe-instances \
  --filters "Name=tag:karpenter.sh/nodepool,Values=*" "Name=instance-state-name,Values=running,pending" \
  --query 'Reservations[].Instances[].InstanceId' --output text)
terraform destroy -auto-approve     # 재실행 → 잔여 0
```

> **교훈:** F6 은 "3-platform 을 먼저 destroy 하면 고아가 생긴다"보다 한 겹 더 깊다.
> **NodeClaim 을 지워도 Karpenter 가 즉시 새로 띄우므로, "0 을 확인한 뒤 곧바로 destroy" 로는 부족하다.**
> destroy 중간에 컨트롤러가 사라지는 순간 남아 있던 NodeClaim 이 그대로 고아가 된다.
> → **destroy 후 반드시 `karpenter.sh/nodepool` 태그로 EC2 를 재확인할 것.**

### 2-D. 3-platform → 2-cluster

```bash
cd eks/prod/3-platform && terraform plan -destroy -out=p && terraform apply p   # 실측 59
cd ../2-cluster        && terraform plan -destroy -out=p && terraform apply p   # 실측 17
aws eks list-clusters   # 비어야 정상
```

> plan 에 **`0 to add`** 가 아니면 멈출 것. 실측 둘 다 `0 to add, 0 to change`.

### 2-E. S3 4개 비우기 (F2) — ★ 1-E 대조 통과 후에만

```bash
for b in drawe-prod-artref drawe-prod-bria-ai drawe-prod-loki-chunks drawe-prod-tempo-blocks; do
  aws s3 rm s3://$b --recursive
  aws s3 ls s3://$b --recursive | wc -l    # 0
done
```

버저닝은 4개 모두 Disabled → 삭제 마커·이전 버전 스윕 불필요. 실측 4개 전부 0.

### 2-F. RDS 보호 해제 (F1 반전) — **CLI 로, apply 금지**

```bash
aws rds modify-db-instance --db-instance-identifier drawe-prod-mysql \
  --no-deletion-protection --apply-immediately
aws rds describe-db-instances --db-instance-identifier drawe-prod-mysql \
  --query 'DBInstances[0].DeletionProtection'    # False
```

> `deletion_protection = true` 인 채로 destroy 하면 provider 가 `DeleteDBInstance` 에서 거부당한다.
> **terraform 으로 끄지 말 것** — `apply` 한 번이 다른 드리프트를 함께 밀어버릴 수 있다.
> 이 시점부터는 **`plan -destroy` 만** 쓴다.

### 2-G. terraform-prod destroy (F3)

```bash
set -a; . /mnt/c/.../infra/terraform-prod/.env; set +a   # ★ Windows 사본(P2)
env | grep -oE '^TF_VAR_[a-z_]+'                        # valkey_auth_token, db_password 둘 다 보여야 함
cd terraform-prod
terraform plan -destroy -var='eks_cutover=false' -out=/tmp/tp-destroy.tfplan
```

**plan 게이트 (실측값):**

| 확인 | 실측 |
| --- | --- |
| `Plan:` | **0 to add, 0 to change, 183 to destroy** |
| `will be created` 개수 | **0** ← 하나라도 있으면 중단 |
| dev 계정(570515227314) 등장 | **0** |
| `random_password` | `grafana_admin` **1개만 destroy** — `ssm.tf` 의 무조건 자원이라 정상. `random_password.db`/`.valkey_auth` 가 보이면 `.env` 주입 실패(P2) |

Cloudflare 토큰은 **plan 전에** 살아 있는지 확인해두면 destroy 중간 실패를 막는다:

```bash
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  https://api.cloudflare.com/client/v4/user/tokens/verify | jq .success   # true
```

```bash
terraform apply /tmp/tp-destroy.tfplan
```

실측 **183 destroyed / 에러 0 / state 0**. **`aws_vpc.main` 이 0초에 정리됐다** —
dev 에서 19분을 잡아먹은 고아 SG `DependencyViolation`(F9-b)은 **prod 에서 재현되지 않았다.**
2-B/2-C 에서 branch ENI·노드를 0으로 만든 뒤 진입했기 때문이다.

---

## 3. 검증 스윕 (F9 — describe 는 자기가 안 보는 걸 못 본다)

```bash
aws ec2 describe-instances --filters Name=instance-state-name,Values=running,stopped,pending \
  --query 'Reservations[].Instances[].InstanceId'
aws ec2 describe-addresses --query 'Addresses[].{IP:PublicIp,Svc:ServiceManaged}'   # ★ ServiceManaged 필수(F9-a)
aws ec2 describe-volumes / describe-network-interfaces / describe-nat-gateways
aws ec2 describe-security-groups --query 'SecurityGroups[].[GroupId,GroupName,VpcId]'  # ★ F9-b
aws rds describe-db-instances / describe-db-snapshots
aws eks list-clusters / aws ecs list-clusters / aws ecr describe-repositories
aws elbv2 describe-load-balancers / aws elasticache describe-cache-clusters / aws amp list-workspaces
aws logs describe-log-groups --query 'logGroups[].[logGroupName,storedBytes]'         # ★ F9-c
aws ssm get-parameters-by-path --path /drawe --recursive --query 'Parameters[].Name'
aws route53 list-hosted-zones / aws acm list-certificates / aws iam list-open-id-connect-providers
aws cloudwatch describe-alarms / aws sns list-topics / aws s3 ls
```

**실측 결과 — 전부 빈 값.** dev 에서 세 번 틀렸던 F9 계열이 prod 에선 이렇게 갈렸다:

| F9 사례 | prod 실측 |
| --- | --- |
| **EIP `ServiceManaged`** | ALB 가 사라지며 **6개 전부 자동 해제**. 고아 0, 수동 정리 불필요 |
| **고아 SG** | VPC 와 함께 정리, **잔재 0**. default VPC 의 lab SG 3개(`security-lab-sg`·`linux-practice-sg`·`default`)만 남고 이건 무료 |
| **TF 밖 SSM** | **0.** dev 의 `grafana-admin-password` 같은 수동 파라미터가 prod 엔 없다(TF 가 `random_password.grafana_admin` 으로 소유) |
| **로그그룹** | **성립.** destroy 후 5개 잔존 → 수동 삭제 |

### 3-A. 잔존 로그그룹 (실측 5개, 전부 수동 삭제)

```bash
aws logs delete-log-group --log-group-name /aws/eks/drawe-prod/cluster            # ★ 7,113,550,913 B
aws logs delete-log-group --log-group-name /aws/ecs/containerinsights/drawe-prod-cluster/performance
aws logs delete-log-group --log-group-name /aws/lambda/drawe-prod-discord-notify
aws logs delete-log-group --log-group-name /aws/rds/instance/drawe-prod-mysql/error
aws logs delete-log-group --log-group-name /aws/rds/instance/drawe-prod-mysql/slowquery
```

> **`/aws/eks/drawe-prod/cluster` 7.1GB 가 핵심이다.** 7월 CloudWatch $30.03 중 $28.29 가
> `VendedLog-Bytes`, 즉 **EKS 컨트롤플레인 로깅**이었다. 클러스터를 지워도 로그그룹은 남는다.

### 3-B. ★ RDS 최종 스냅샷의 이름 함정 (prod 신규 발견 — P4)

destroy 직후 수동 스냅샷이 **3개** 나온다. 그중 하나가 지뢰다:

| 스냅샷 | 실제 생성 시각 | 정체 |
| --- | --- | --- |
| `drawe-prod-mysql-final-**20260512-0439**` | **2026-07-28 03:08 UTC** | ★ **오늘 destroy 가 만든 최종 스냅샷** |
| `drawe-prod-mysql-final-20260728` | 2026-07-28 02:36 UTC | 1-D 의 수동 스냅샷 |
| `drawe-prod-mysql-pre-v3-20260513-1547` | 2026-05-13 | 진짜 옛것 |

**이름의 5월 날짜는 거짓이다.** `rds.tf` 의
`final_snapshot_identifier = "...-${formatdate(..., timestamp())}"` + `lifecycle { ignore_changes = [final_snapshot_identifier] }`
조합 때문에 **최초 apply 당시의 `timestamp()` 가 state 에 얼어붙어** 그 이름으로 최종 스냅샷이 만들어진다.
→ **"5월 거네"라며 지우면 방금 만든 최종 백업을 지우는 것이다.** 반드시 `SnapshotCreateTime` 으로 판별할 것.

정리(최종 1개만 남기기) — 이름 함정을 영구히 없애려면 복사 후 원본 3개를 지운다:

```bash
aws rds copy-db-snapshot --source-db-snapshot-identifier drawe-prod-mysql-final-20260512-0439 \
  --target-db-snapshot-identifier drawe-prod-teardown-final-20260728 --kms-key-id alias/aws/rds
aws rds wait db-snapshot-completed --db-snapshot-identifier drawe-prod-teardown-final-20260728
# 복사가 available 인 것을 확인한 뒤에만
aws rds delete-db-snapshot --db-snapshot-identifier <원본 3개 각각>
```

> **자동 스냅샷 32개**(`rds:drawe-prod-mysql-*`)는 인스턴스와 함께 사라진다
> (`delete_automated_backups` 기본 true). 실측: destroy 직후 32 → 잠시 뒤 **0**,
> `describe-db-instance-automated-backups` 도 비어 있음. **수동 개입 불필요.**

---

## 4. 계정 전체 $0 마무리 (drawe 밖)

비용 기여는 미미했지만 계정을 비우는 결정이라 함께 정리했다.

```bash
aws cloudtrail stop-logging --name security-audit-trail && aws cloudtrail delete-trail --name security-audit-trail
aws lambda delete-function --function-name seoul-air-api
aws glue delete-crawler --name seoul-air-crawler && aws glue delete-database --name seoul_air_db
aws apigatewayv2 delete-api --api-id <id>          # ★ REST 가 아니라 HTTP API(v2) 였다
aws logs delete-log-group --log-group-name <lab 로그그룹>
```

> ★ **`get-rest-apis` 는 비어 있는데 API 가 살아 있으면 v2 를 볼 것.**
> `delete-rest-api` 가 `Invalid API identifier` 를 내면 그 API 는 HTTP API(v2)다.
> (`apigateway` 는 삭제 API 에 강한 레이트리밋이 있어 연속 삭제 시 `TooManyRequestsException` — 30초 간격 재시도.)

**KMS 2개(`cloudtrail-log-key`·`security-lab-key`)는 이미 `PendingDeletion`, 만료 2026-08-12.**
대기 중에도 과금되지만(합계 ~$2) 취소 가능한 안전망이라 그대로 둔다.

---

## 5. 최종 상태

| | before (7월 MTD 27일) | after |
| --- | --- | --- |
| EC2 Compute / EKS / ELB / VPC(IPv4) / EBS | $274.84 | — |
| AMP / CloudWatch | $100.42 | — |
| RDS / ElastiCache | $55.03 | 스냅샷 1개(~$0.1/월) |
| ECR / S3 / Bedrock / R53 | $6.84 | tfstate 712KB |
| Tax | $43.80 | — |
| **합계** | **$481.90 (월 환산 ~$535)** | **~$0** (8/12 KMS 만료 전까지 ~$2) |

일별 추이 실측: 7/24 $21.23 → 7/25 $18.55 → 7/26 $18.00 → **7/27 $10.63**.

**남기기로 한 것**

| 자원 | 이유 |
| --- | --- |
| `drawe-prod-teardown-final-20260728` (RDS 스냅샷) | 유일한 AWS 측 안전망 |
| `s3://drawe-tfstate-933832340498` (712KB, 3객체) | state 이력 |
| DynamoDB `drawe-tfstate-lock` | state 잠금(on-demand, ~$0) |
| KMS 2개 | 8/12 예약 삭제 대기 중 |
| default VPC + lab SG 3개, IAM 사용자 | 무료 |

---

## 6. 복구 — ⚠️ 미실증

**검증된 것은 "덤프가 복원된다"가 아니라 "덤프가 온전하다"까지다**(gzip 무결성 · DB 3개 ·
CREATE TABLE 103 · `Dump completed`). dev 처럼 로컬 mysql 컨테이너 리허설까지는 하지 않았다.

절차는 `dev_full_teardown.md` 5장과 같되 **prod 고유 차이**를 지킬 것:

1. **`.env` 는 Windows 사본**(P2). WSL 사본을 source 하면 `TF_VAR_valkey_auth_token` 이 비어
   `random_password.valkey_auth[0]` 가 새로 생성된다.
2. **DB 암호는 `.env` 가 아니라 SSM 백업(`ssm/drawe-prod-ssm.json`)의 `/drawe/prod/db-password` 가 정본**(P1).
   `.env` 값으로 apply 하면 스냅샷 복원 DB 와 영구 불일치한다.
   → 복구 시 `terraform.tfvars`/`.env` 의 `TF_VAR_db_password` 를 **SSM 값으로 먼저 교체**할 것.
3. `rds.tf` 에 `snapshot_identifier` 스위치를 임시 추가하고
   `-var="db_snapshot_identifier=drawe-prod-teardown-final-20260728"` 로 apply.
4. **SSM 재주입은 apply 직후**(`bash $BK/ssm/restore-ssm.sh`). 순서가 반대면 apply 가 `CHANGE_ME` 로 덮는다.
5. S3 4개 sync 복원. **키가 곧 `ref_id` → Qdrant → `reference_images` → presigned 체인**이므로 키 보존 필수.
6. ECR: `crane push $BK/ecr/fastapi-guide-latest.tar <new-repo>:latest` 로 **재빌드 대신 밀어넣을 것**
   (재빌드하면 `usyd-community/vitpose-base` 가중치가 달라질 수 있다).
7. EKS 는 2-cluster → 3-platform → **overlay 의 pods-db/cluster SG id 를 새 값으로 교체 후 커밋** → ArgoCD 앱 등록.
8. 마지막에 `eks_cutover=true` 로 재apply → api/grafana DNS 컷오버.

**벡터스토어(Qdrant Cloud)·Pinecone·Grafana Cloud·Bedrock 은 AWS 자원이 아니라 그대로 살아 있다.**
Qdrant 무료 티어는 미사용 시 정지되므로 `qdrant-keepalive.yml` 은 계속 돌게 둘 것.
