# DraWe dev 완전 정리(teardown) & 복구 런북

> 배치 위치: `infra/runbooks/dev_full_teardown.md`
>
> **상태: dev teardown 완료 (2026-07-17).** 이 문서는 이제 세 가지 용도다 —
> ① **복구 절차**(5장, 대부분 미실증) ② **prod 종료 결정 시 골격**(6장) ③ 실측 기록.
>
> `prod_eks_teardown.md`(재우기)와 목표가 다르다. 저건 "시간당 비용 ~0, 데이터는 AWS에 그대로".
> 이건 **자원을 실제로 지워 청구를 0으로 만들고, 백업으로 되살린다.**
> 즉 **AWS에만 존재하던 것(시크릿·DB·S3 객체)은 백업하지 않으면 영구 소실**된다.
>
> 계정: **dev=570515227314**(정리 완료) / prod=933832340498(**종료 결정 전까지 손대지 않음**). ap-northeast-2.
> prod는 자기 계정에 GitHub OIDC provider를 따로 갖고 있어(`terraform-prod/iam.tf`) dev의 OIDC를 지워도 prod CI는 안 깨진다.

---

## 0. 실행 결과 (2026-07-17 실측)

| | before | after |
| --- | --- | --- |
| RDS `drawe-dev-mysql` (db.t4g.micro + gp3 20GB) | $20.54 | — |
| ALB `drawe-dev-alb` (타깃 0, 트래픽 0) | $16.20 | — |
| Public IPv4 ×2 (**ALB 부속물**, 고아 아님 → F9) | $7.21 | — |
| ECR 3 repo + S3 artref 9.1GB | $3.68 | — |
| EBS gp3 ×2 + EC2 nat·valkey (stopped) | $3.53 | — |
| KMS CMK ×2 (프로젝트 이전 실습 잔재) | $1.94 | $1.94 → **8/16 예약 만료 후 $0** |
| CW 알람 22 / Route53 private zone / SSM Advanced | $1.25 | — |
| EKS | $0 (07-05에 이미 teardown) | — |
| **합계** | **$53.85/월** | **$1.94 → $0** |

`terraform destroy` **141개**, `terraform state list` = 0.

> ⚠️ **순비용 $0은 안심할 근거가 아니었다.** 6월 실측 Usage $60.20 / Credit −$60.20 —
> 크레딧이 전액 상쇄 중이었을 뿐이고, 소진되는 순간 월 $54가 실청구로 전환된다.
> 크레딧 잔액·만료일은 API로 안 나온다(빌링 콘솔). 통합 결제라면 dev가 태우는 건 prod가 쓸 크레딧이다.

**백업 자산 8.6G**: `s3/artref` 8.4G(31,345객체) · `db/*.sql.gz` 146M · `tfstate` 352K · `ssm` 36K · `tfvars`(+`.env`) 16K

---

## ⚠️ 함정 F1~F9

**실증**된 것과 **미실증**을 구분해 읽을 것. 미실증은 prod 때 다시 검증해야 한다.

| # | 함정 | 결과 | 대응 | 실증 |
| --- | --- | --- | --- | --- |
| **F1** | `rds.tf`: **`skip_final_snapshot = true`** | destroy가 경고 없이 DB를 스냅샷 없이 삭제. 자동백업(retention 1일)도 인스턴스와 함께 소멸 | 2-D에서 수동 스냅샷 + mysqldump 먼저 | ✅ |
| **F2** | `s3-artref.tf`/`s3-bria.tf`: **`force_destroy` 없음** | 객체가 남으면 destroy가 `BucketNotEmpty`로 실패 → 진행하려면 비워야 하고, **비우는 순간 원본이 사라진다** | 2-E sync + 개수 대조 후 3-G에서 비움 | ✅ |
| **F3** | `cutover-eks.tf`의 `data.aws_lb.eks_ingress` (`eks_cutover` 기본 true) | EKS ALB가 없으면 0 results → **terraform-dev의 plan/apply/destroy가 전부 막힘** | **`eks_cutover=false`** 선행 (커밋 `848941b`) | ✅ |
| **F4** | `ssm.tf`: Category 2는 `CHANGE_ME` + `lifecycle { ignore_changes = [value] }` | **실제 API 키·OAuth·JWT는 AWS SSM에만 존재.** destroy = 소실 → 외부 서비스 키 재발급 | 2-B에서 `--with-decryption` 전량 export | ✅ |
| **F5** | ArgoCD `selfHeal` + finalizer, SGP branch ENI | 파드부터 지우면 되살아남. ENI 안 빠지면 SG가 `DependencyViolation` | 앱 먼저 → 파드 강제삭제 → ENI 0 | ❌ (EKS 기 teardown) |
| **F6** | **Karpenter 노드는 Terraform state 밖** | 3-platform을 먼저 destroy하면 NodeClaim finalizer 미실행 → EC2 고아 과금 | `nodeclaims` 0 + EC2 0 확인 후 destroy | ❌ |
| **F7** | **스케줄이 0개면 RDS가 영구 가동** ← **초판과 정반대** | 아래 참조 | **stop이 아니라 삭제만이 종결** | ✅ |
| **F8** | **RDS 접근 경로가 기본 상태에서 막힘** | 아래 참조 | valkey SG → RDS 3306 임시 추가 | ✅ |
| **F9** | **state 부재 ≠ 고아** (3회 반복) | 아래 참조 | 스윕 쿼리 교체 | ✅ |

### F7 — 초판이 정반대였다 (최대 과금 원인)

초판은 "스케줄 8개가 백업 중 RDS를 stop시킬 것"을 걱정했다. 실제로는 `terraform.tfvars:15`에
`enable_cost_schedule = false`라 **`aws_scheduler_schedule` 8개가 전부 `count=0`으로 존재하지 않았다.**

RDS 이벤트 로그가 정확히 말해준다:

```
2026-07-05 15:16  teardown으로 DB instance stopped
2026-07-12 15:19  "DB instance is being started due to it exceeding the
                   maximum allowed time being stopped"   ← AWS의 7일 강제 기동
이후              되돌릴 stop 스케줄이 없어 24/7 가동
```

일별 과금도 07-12 $1.386 → 07-13 $1.773으로 점프해 일치. **`stop`은 답이 아니다** —
stop할 때마다 7일 타이머가 다시 걸리므로 무한 반복이다. **삭제만이 종결.**

부수 효과: 이미 `available`이라 2-D의 `start-db-instance` + `wait`는 보통 불필요하다.

### F8 — RDS 접근 경로 (mysqldump가 막히는 지점)

`db-connect.sh`가 찾는 SSM 호스트 3개가 전부 안 된다:

| 후보 | 왜 안 되나 |
| --- | --- |
| ECS 인스턴스 | ASG desired=0, 0대 |
| NAT | `vpc.tf`의 `aws_instance.nat`에 **`iam_instance_profile`이 없음** → SSM 불가 (스크립트가 찾는 `Role=nat-instance` 태그도 실제로 없음) |
| valkey | SSM 프로필은 있으나 **RDS SG가 valkey SG를 허용하지 않음** (`security-groups.tf`의 rds ingress = ecs_backend / ecs_instance / ecs_fastapi) |

**정본: valkey SG → RDS 3306 임시 추가.** `aws_security_group.rds`에
`lifecycle { ignore_changes = [ingress] }`가 있어 **드리프트가 0**이다 —
EKS pods-db 규칙을 밖에서 꽂는 걸 공존시키려 만든 장치이고, 이게 정확히 같은 패턴이다.

```bash
RDS_SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=drawe-dev-rds-sg \
  --query 'SecurityGroups[0].GroupId' --output text)
VK_SG=sg-0690bcbd00757cd0b     # valkey SG (egress 는 이미 0.0.0.0/0)

trap 'aws ec2 revoke-security-group-ingress --group-id $RDS_SG \
        --protocol tcp --port 3306 --source-group $VK_SG' EXIT   # ★ 실패해도 원복
aws ec2 authorize-security-group-ingress --group-id $RDS_SG \
  --protocol tcp --port 3306 --source-group $VK_SG
```

> ★ **`db-connect.sh`를 쓰지 말 것** — `echo "    Password: ${DB_PWD}"`로 **암호를 stdout에 출력**한다.
> 에이전트가 실행하면 그대로 트랜스크립트 파일에 남는다. `ssm start-session`을 직접 호출할 것.
>
> ★ **valkey는 NAT가 떠야 SSM에 등록된다** — private_a에 있고 `vpc-endpoints.tf`의
> SSM 인터페이스 엔드포인트가 전부 주석 처리라, 아웃바운드 443이 NAT를 거친다.
> bring-up 런북의 "NAT 먼저" 교훈이 여기서도 나온다.

### F9 — **state 부재 ≠ 고아** (같은 계열로 3회 틀렸다)

**`terraform state list`가 비었다고 잔재가 없는 게 아니다. describe 스윕은 자기가 안 보는 걸 못 본다.**

| 사례 | 오판 | 진실 |
| --- | --- | --- |
| **EIP 2개**(13.125.93.11 / 54.116.64.126) | `aws_eip`가 state에 없다 → "고아 $7.21, 수동 정리" | `describe-addresses`의 **`ServiceManaged: alb`** — ALB 소유 IPv4가 과금 가시성 때문에 노출된 것. `release-address` 불가. **ALB 삭제 시 자동 해제**. 연결 ENI도 `RequesterManaged: true` |
| **EKS 고아 SG**(`sg-0f815ecda2fb7e9fc`) | 실사에서 "EKS 잔재 0" (검사 항목: 클러스터·Karpenter EC2·branch ENI·ALB **4개뿐**) | **SG를 안 봤다.** 07-05 teardown이 남긴 게 두 달 있다가 VPC 삭제를 붙잡음 → destroy가 **19분 재시도**하다 `DependencyViolation`으로 발견. 수동 삭제 후 VPC 1초 정리 |
| **로그그룹 5개** | 4장 표에 "로그그룹 → destroyed" | **9개 중 4개만.** `cloudwatch.tf`·`ecs-guide.tf`가 만든 4개만 TF 소유. RDS(`enabled_cloudwatch_logs_exports`)·Lambda 런타임·Container Insights가 만든 것과 `/ecs/drawe-dev-dump-oneoff`(코드에 없는 일회성)는 **destroy 후 잔존**(224KB, 비용 0). 수동 삭제함 |

**교훈: destroy가 진짜 탐지기다.** 사전 스윕은 보조일 뿐이다.

---

## 1. 계정 가드 (매 터미널)

```bash
export AWS_PROFILE=drawe-dev
export AWS_REGION=ap-northeast-2

[ "$(aws sts get-caller-identity --query Account --output text)" = "570515227314" ] \
  && echo "✅ dev" || { echo "✘ dev 아님 — 중단. prod(933832340498)일 수 있음"; }
```

CD 워크플로(`backend-cd`/`fastapi-cd`/`fastapi-guide-cd`)는 **develop·main 공용**이다.
파일을 지우거나 disable하면 **prod 배포까지 죽는다.** develop push만 하지 말 것.

---

## 2. 백업 — **되돌릴 수 없는 지점 전에 전부**

| 대상 | 왜 | 백업 안 하면 |
| --- | --- | --- |
| **SSM 파라미터 실값** | 코드엔 `CHANGE_ME` + `ignore_changes` (F4) | Google OAuth·Gemini·Claude·Grok·Bria·Pinecone·Qdrant·GA4·SMTP **전부 재발급** |
| **`infra/terraform-dev/.env`** ★ | `.gitignore` — **이 PC에만.** `CLOUDFLARE_API_TOKEN`(53자) + `TF_VAR_db_password` + `TF_VAR_valkey_password`의 **정본** | 토큰 재발급 + 아래 로테이션 지뢰 |
| **`terraform.tfvars`** | `.gitignore`. `key_pair_name`은 default 없는 필수 변수 | apply 자체가 안 됨 |
| **tfstate 3종** | 리소스 ID 기록 | 대조·import 불가 |
| **RDS 스냅샷 + mysqldump** | F1. `drawe_db`(17) + `drawe_guide`(9) **2개 DB** | 데이터 소실 |
| **S3 artref / bria** | F2. artref는 큐레이션 코퍼스 | 코퍼스 재구축 + `ref_id` 해소 붕괴 |
| **key pair `.pem`** | TF 밖 자원 | SSH 불가 (무료라 **지우지 말 것**) |
| ECR 이미지 | (선택) → 2-G 참조 | — |

> ★ **로테이션 지뢰**: `rds.tf:21`의 `count = var.db_password == "" ? 1 : 0` 때문에
> `random_password.db`가 **state에 없다**(=apply 당시 `TF_VAR_db_password`로 주입됨).
> 복구 때 `.env` 없이 apply하면 `count=1`이 되어 **새 32자를 생성해 RDS 마스터 암호와 SSM을 동시에 갈아버린다.**
> 스냅샷 복원 DB(옛 암호)와 영구 불일치 — `rds.tf` 주석이 경고하는 사고와 같은 계열이다.
> 실제 값은 **16자 수동 지정**이고 db/redis 동일(의도된 것).

> **벡터스토어(Qdrant Cloud `reference_images_dev`)·Pinecone·Grafana Cloud는 AWS 밖**이라 무관하게 살아 있다.
> 단 **`qdrant-keepalive.yml`(3일마다 ping)은 계속 돌게 두라** — 무료 티어는 미사용 시 정지되고,
> 날아가면 768차원 재시딩(`dev_store_backfill.md`)을 다시 해야 한다.

### 2-A. 백업 디렉터리

```bash
# ★ repo 밖 + 네이티브 FS. /mnt/c 는 chmod 700 이 안 먹고, repo 안은 커밋 사고.
BK=~/drawe-dev-backup-$(date +%Y%m%d); mkdir -p $BK/{ssm,tfstate,tfvars,db,s3,images}
chmod 700 $BK
```

### 2-B. SSM 전량 export (F4)

```bash
aws ssm get-parameters-by-path --path /drawe/dev --recursive --with-decryption \
  --query 'Parameters[].{Name:Name,Type:Type,Value:Value}' --output json > $BK/ssm/drawe-dev-ssm.json

jq 'length' $BK/ssm/drawe-dev-ssm.json                                    # 실측 28
jq -r '.[] | select(.Value|startswith("CHANGE_ME")) | .Name' $BK/ssm/drawe-dev-ssm.json   # 실측 0

# 재주입 스크립트 (5-C)
jq -r '.[] | "aws ssm put-parameter --name \"\(.Name)\" --type \(.Type) --value \(.Value|@sh) --overwrite"' \
  $BK/ssm/drawe-dev-ssm.json > $BK/ssm/restore-ssm.sh
chmod +x $BK/ssm/restore-ssm.sh && bash -n $BK/ssm/restore-ssm.sh
```

> **28 = TF 관리 27 + 수동 1.** `/drawe/dev/grafana-admin-password`는 코드에 없어
> **destroy 후에도 남는다**(F9 계열). 스윕에서 `delete-parameter`로 정리.
>
> jq가 없으면 python3 `shlex.quote`로 대체 가능(`@sh`와 동일한 POSIX quoting).
> `sudo apt install jq`는 비대화식에서 멈출 수 있다.

### 2-C. .env + tfvars + tfstate ★

```bash
cp infra/terraform-dev/.env          $BK/tfvars/terraform-dev.env      # ★ 정본. 156B
cp infra/terraform-dev/terraform.tfvars $BK/tfvars/
chmod 600 $BK/tfvars/*
# 키 확인 (값 금지). grep -o '^[A-Z_]*=' 는 TF_VAR_db_password 를 못 잡는다 — 소문자 포함.
grep -oE '^[A-Za-z_]+=' $BK/tfvars/terraform-dev.env

for k in dev/terraform.tfstate eks/dev/cluster/terraform.tfstate eks/dev/platform/terraform.tfstate; do
  aws s3 cp "s3://drawe-terraform-state-570515227314/$k" "$BK/tfstate/$(echo $k | tr '/' '_')"
done   # eks 2개가 182바이트(resources: [])면 정상
```

`eks/dev/{2-cluster,3-platform}`은 변수 전부 default라 tfvars가 없는 게 정상이다.

### 2-D. RDS (F1)

```bash
# F7 때문에 대개 이미 available. stopped 면 start + wait (스냅샷은 available 에서만 가능)
aws rds describe-db-instances --db-instance-identifier drawe-dev-mysql \
  --query 'DBInstances[0].DBInstanceStatus' --output text

SNAP=drawe-dev-mysql-final-$(date +%Y%m%d)
aws rds create-db-snapshot --db-instance-identifier drawe-dev-mysql --db-snapshot-identifier $SNAP
aws rds wait db-snapshot-completed --db-snapshot-identifier $SNAP
aws rds describe-db-snapshots --db-snapshot-identifier $SNAP \
  --query 'DBSnapshots[0].{Status:Status,Encrypted:Encrypted,KmsKeyId:KmsKeyId}' --output table
echo $SNAP > $BK/db/snapshot-id.txt
```

> `KmsKeyId`가 `alias/aws/rds`(실측 `77b6bcec`)면 CMK 삭제와 무관하다. CMK면 먼저
> `copy-db-snapshot --kms-key-id alias/aws/rds`로 갈아탈 것.

**논리 덤프** — F8의 SG 규칙을 먼저 열고:

```bash
NAT=$(aws ec2 describe-instances --filters Name=tag:Name,Values=drawe-dev-nat \
  Name=instance-state-name,Values=stopped --query 'Reservations[].Instances[].InstanceId' --output text)
VK=$(aws ec2 describe-instances --filters Name=tag:Name,Values=drawe-dev-valkey \
  Name=instance-state-name,Values=stopped --query 'Reservations[].Instances[].InstanceId' --output text)
aws ec2 start-instances --instance-ids $NAT && aws ec2 wait instance-status-ok --instance-ids $NAT
aws ec2 start-instances --instance-ids $VK  && aws ec2 wait instance-status-ok --instance-ids $VK
aws ssm describe-instance-information --query "InstanceInformationList[?InstanceId=='$VK'].PingStatus"  # Online

# ★ db-connect.sh 금지 (암호 echo). 직접:
RDS_HOST=$(aws rds describe-db-instances --db-instance-identifier drawe-dev-mysql \
  --query 'DBInstances[0].Endpoint.Address' --output text)
aws ssm start-session --target $VK \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=$RDS_HOST,portNumber=3306,localPortNumber=3306" &

# 암호를 명령줄에 두지 말 것 — my.cnf (chmod 600)
mysqldump --defaults-file=$BK/db/my.cnf -h 127.0.0.1 -P 3306 \
  --databases drawe_db drawe_guide \
  --single-transaction --routines --triggers --events --set-gtid-purged=OFF \
  | gzip > $BK/db/drawe-dev-$(date +%Y%m%d).sql.gz
rm -f $BK/db/my.cnf
```

> ★ **인증 성공 자체가 "백업된 암호 = 현재 RDS 마스터 암호 = 스냅샷 암호"의 증명이다.**
> `Access denied`면 즉시 중단 — 복구 계획 전체가 흔들리는 신호.

```bash
gzip -t $BK/db/drawe-dev-*.sql.gz
zcat $BK/db/drawe-dev-*.sql.gz | grep -E "^-- Current Database"   # drawe_db, drawe_guide 둘 다
zcat $BK/db/drawe-dev-*.sql.gz | grep -c "CREATE TABLE"           # 실측 26
zcat $BK/db/drawe-dev-*.sql.gz | tail -1                          # "Dump completed"
```

`drawe_guide`의 `schema_version`을 `fastapi/guide/schema/migrations/`와 대조(bring-up D3).
실측: `013_practice_log_project`까지 일치. **필요한 `session-manager-plugin`이 없으면 여기서 막힌다.**

### 2-E. S3 (F2)

```bash
aws s3 ls s3://drawe-dev-artref --recursive --summarize | tail -2 | tee $BK/s3/artref-before.txt
aws s3 ls s3://drawe-dev-bria-ai --recursive --summarize | tail -2 | tee $BK/s3/bria-before.txt

aws configure set default.s3.max_concurrent_requests 20
aws s3 sync s3://drawe-dev-artref  $BK/s3/artref/
aws s3 sync s3://drawe-dev-bria-ai $BK/s3/bria/
```

> **실측: 8.3GiB / 31,345객체 = 4~5분 (39 MiB/s).** 초판의 "몇 시간"은 객체 수만 보고 겁먹은 오판.
> bria는 4객체 / 6.5MiB. 버저닝은 둘 다 **Disabled** → 삭제 마커·이전 버전 스윕 불필요
> (`plan`이 "0 to change"인 게 그 증거).

```bash
# ★ 대조 — du -sb 는 디렉터리 블록을 포함하므로 S3 바이트와 비교할 값이 아니다.
echo "local=$(find $BK/s3/artref -type f | wc -l) / target=31345"
find $BK/s3/artref -type f -printf '%s\n' | paste -sd+ | bc    # target 8934319127
```

### 2-F. ECR — **비우지 말 것**

3개 repo 모두 **`force_delete = true`**(`ecr.tf` ×2, `ecs-guide.tf` ×1) → destroy가 이미지째 지운다.
**F2는 S3 전용이다.** 미리 비우면 이미지만 잃는다.

백업은 **guide만** 고려. 이유는 용량이 아니라 **`Dockerfile.guide`가
`usyd-community/vitpose-base`를 revision 핀 없이 받기 때문** — 재빌드 시 조용히 다른 가중치가
들어오거나 404가 난다.

```bash
# ★ 태그 선택 함정: sort_by(imageDetails,&imagePushedAt)[-1] 는 buildcache 를 잡는다.
#   BuildKit 캐시가 실이미지보다 4분 늦게 푸시되므로 항상 캐시가 이긴다.
#   buildcache = 4.27GB, OCI manifest, docker load 해도 못 쓴다. 실이미지 = 2.1GB.
TAG=$(aws ecr describe-images --repository-name drawe-dev-fastapi-guide \
  --query "sort_by(imageDetails[?imageTags[0]!='buildcache' && imageTags[0]!=null],&imagePushedAt)[-1].imageTags[0]" \
  --output text)
```

> **2026-07-17에는 스킵했다** — prod ECR `drawe-prod-fastapi-guide:latest`(2,096,377,820 B)가
> dev `21b8095...`(2,096,380,865 B)와 **3KB 차·8분 차**로 동등본이다. 같은 `Dockerfile.guide`,
> 같은 가중치. prod가 살아 있는 한 중복 보관이다.
>
> ★ **prod 종료 시엔 그게 가중치의 마지막 사본이므로 반드시 먼저 내려야 한다.** (6장)
>
> 별도 트랙: `revision='<sha>'` 핀은 무료·영구이고 **prod도 같은 구멍**이다.

### 2-G. 봉인

```bash
du -sh $BK/*          # 실측 8.6G
tar czf $BK.tar.gz -C $(dirname $BK) $(basename $BK)
age -p -o $BK.tar.gz.age $BK.tar.gz     # 또는 gpg -c. 평문 시크릿 포함 — repo/Slack/Drive 금지
sha256sum $BK.tar.gz.age | tee $BK.sha256
```

> **여기까지가 되돌릴 수 있는 마지막 지점.** 2-D·2-E 검증이 통과하지 않았으면 3장으로 가지 말 것.

---

## 3. 정리 (안쪽 → 바깥쪽)

### 3-A. EKS (dev는 07-05에 완료 — **검증용**)

```bash
aws eks list-clusters                                    # []
kubectl get nodeclaims 2>/dev/null                       # Karpenter 노드 0 (F6)
aws ec2 describe-instances --filters "Name=tag:karpenter.sh/nodepool,Values=*" \
  "Name=instance-state-name,Values=running,pending" --query 'Reservations[].Instances[]' --output text
aws ec2 describe-network-interfaces --filters Name=interface-type,Values=branch \
  --query 'NetworkInterfaces[]' --output text            # 0 (F5)
aws elbv2 describe-load-balancers \
  --query "LoadBalancers[?starts_with(LoadBalancerName,'k8s-drawedev')].LoadBalancerName"
```

> ★ **state가 비어도(182바이트 `resources: []`) SG와 로그그룹은 남는다** — F9(b).
> 이 4개 항목만 보고 "잔재 0"이라 결론내린 게 이번 실사의 오류다.
> 살아 있는 클러스터를 내릴 땐 F5·F6 순서(앱 → 파드 → ENI → nodeclaims → 3-platform → 2-cluster)를 지킬 것.

### 3-B. S3 비우기 (★ 2-E 대조 통과 후에만)

```bash
aws s3 rm s3://drawe-dev-artref --recursive
aws s3 rm s3://drawe-dev-bria-ai --recursive
aws s3 ls s3://drawe-dev-artref --recursive | wc -l    # 0. 3만 개라 일부 실패 가능 — 아니면 재실행
```

**ECR은 건드리지 말 것** (2-F).

### 3-C. terraform-dev destroy (F3)

```bash
cd infra/terraform-dev
source .env                                    # CLOUDFLARE_API_TOKEN + TF_VAR_db/valkey_password
terraform init
terraform plan -destroy -out=destroy.tfplan    # ★ eks_cutover=false 커밋 선행 (848941b)
```

`plan` 확인 포인트 (실측 **141 destroy**):

- `random_password.db` / `.valkey`가 보이면 **즉시 중단** — `.env` 주입 실패 신호
- `aws_ssm_parameter` **27**(28 아님 — 수동 1개는 TF 밖)
- `aws_db_instance.main`은 CLI로 먼저 지웠다면 plan에 없는 게 정상(refresh가 state에서 제거)
- `cloudflare_record` 2종(`api[0]`, `cert_validation`)
- prod 계정 자원이 하나라도 보이면 즉시 중단

```bash
terraform apply destroy.tfplan
```

> ⚠️ **CLI로 자원을 먼저 지우면 state 드리프트가 생긴다.** 그 시점부터 **`apply` 금지, `plan -destroy`만.**
> apply 한 번이면 RDS가 새 random 암호로 부활한다.
>
> **`DependencyViolation`으로 19분 재시도**하면 F9(b) — VPC 안 SG를 훑어라:
> ```bash
> VPC=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=drawe-dev-vpc --query 'Vpcs[0].VpcId' --output text)
> aws ec2 describe-security-groups --filters Name=vpc-id,Values=$VPC \
>   --query 'SecurityGroups[].{Id:GroupId,Name:GroupName}' --output table   # default 는 무시
> aws ec2 delete-security-group --group-id <고아>    # 참조가 있으면 AWS가 거부하므로 자기방어적
> ```

---

## 4. 검증 스윕

```bash
# ★ ServiceManaged 필수 — 이게 없어서 EIP 를 고아로 오판했다 (F9-a)
aws ec2 describe-addresses --query 'Addresses[].{IP:PublicIp,Assoc:AssociationId,SvcMgd:ServiceManaged}'
# ★ SG — 초판 스윕에 없었다 (F9-b)
aws ec2 describe-security-groups --filters Name=vpc-id,Values=$VPC --query 'SecurityGroups[].GroupName'

aws elbv2 describe-load-balancers --query 'LoadBalancers[].LoadBalancerName'
aws ec2 describe-instances --filters Name=instance-state-name,Values=running,stopped \
  --query 'Reservations[].Instances[].[InstanceId,Tags[?Key==`Name`]|[0].Value]'
aws ec2 describe-volumes / describe-network-interfaces / describe-snapshots --owner-ids 570515227314
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier'
aws ecr describe-repositories / aws ecs list-clusters / aws eks list-clusters
aws s3 ls | grep drawe
aws elasticache describe-cache-clusters --query 'CacheClusters[].CacheClusterId'

# ★ 로그그룹 — TF 소유는 4개뿐. 나머지는 남는다 (F9-c)
aws logs describe-log-groups --query 'logGroups[].[logGroupName,storedBytes]' --output table
#   실측 잔존 5개: /aws/rds/instance/drawe-dev-mysql/{error,slowquery} (RDS 가 생성),
#   /aws/lambda/drawe-dev-discord-notify (Lambda 런타임), Container Insights,
#   /ecs/drawe-dev-dump-oneoff (코드에 없는 일회성 — ★ 읽지 말고 지울 것, 접속 문자열 가능)
#   → aws logs delete-log-group 으로 수동 정리

# ★ TF 밖 SSM (F9 계열)
aws ssm get-parameters-by-path --path /drawe/dev --recursive --query 'Parameters[].Name'
#   /drawe/dev/grafana-admin-password 만 남음 → delete-parameter

aws kms describe-key --key-id <id> --query 'KeyMetadata.[KeyState,DeletionDate]'
```

**남아야 정상**: state 버킷(수 KB) · 수동 스냅샷 · key pair(무료) · KMS PendingDeletion

### KMS 고아 (진짜 고아, 유일한 수동 정리 대상)

`alias/dr-lab-key`(`5e7e42b9`, 4/01) · `alias/lab-kms-key`(`f905e6fe`, 3/26) — 프로젝트 이전 실습 잔재.
정책 주체 `cli-user`(3/13)·`dr-lab-restricted-user`(4/01)가 `drawe-admin`(5/05)보다 먼저 생성됐다.
삭제 안전 판정: 90일 CloudTrail 암호화 사용 0건 · grant 0 · 전 서비스 참조 0 · 계정 기본 EBS 암호화 false.

```bash
aws kms schedule-key-deletion --key-id <id> --pending-window-in-days 30   # 취소 가능한 안전망
```

> **대기 중에도 과금된다**(30일 ≈ $2). 하지만 이벤트 히스토리가 90일이라
> 키 생성 직후 3주(3/26~4/18)는 조회 범위 밖이고, 그때 만든 암호문이 AWS 밖에 있으면
> 어떤 API로도 탐지 못 한다. 그 $2는 보험료로 싸다.
>
> 같은 계보의 `my-vpc`(`vpc-002d8f6fd74aae6b2`)는 과금 0이니 **그대로 두라** —
> 8/16까지 아무 일 없으면 "실습 잔재" 판정이 실증된다. 지금 지우면 판단 근거만 사라진다.

---

## 5. 복구 — **⚠️ 대부분 미실증**

**검증된 것은 "덤프가 복원된다"까지다.** 2026-07-17 로컬 `mysql:8.4` 도커 리허설 통과 —
`drawe_db` 17 + `drawe_guide` 9 = 26테이블, `schema_version` `013_practice_log_project`까지 일치.

**"인프라가 그대로 살아난다"는 실제 복구해봐야 안다.** 5-A~5-F는 미실증이다.
**이 구분이 방심 지점이다.**

**바뀌는 것**: 리소스 ID(VPC/SG/EC2/ALB DNS), EKS SG id(→ overlay 커밋 필요), ACM(재발급·자동검증).
앱 env는 TF 참조라 자동 추종. **소요 추정**: RDS 복원 10~20분 + apply ~15분 + EKS 20~30분 + 이미지 재빌드 20~40분.

### 5-A. 입력값 ★

```bash
cp $BK/tfvars/terraform-dev.env    infra/terraform-dev/.env
cp $BK/tfvars/terraform.tfvars     infra/terraform-dev/terraform.tfvars
cd infra/terraform-dev && source .env
env | grep -c TF_VAR_    # 2 (값 출력 금지)
```

> 이걸 빼먹으면 `random_password`가 새 32자를 만들어 **스냅샷 복원 DB와 영구 불일치**한다(2장 지뢰).

### 5-B. apply — RDS는 스냅샷에서

`rds.tf`에 복원 스위치를 임시 추가:

```hcl
variable "db_snapshot_identifier" { type = string, default = "" }

resource "aws_db_instance" "main" {
  snapshot_identifier = var.db_snapshot_identifier != "" ? var.db_snapshot_identifier : null
}
```

```bash
terraform plan -var="db_snapshot_identifier=$(cat $BK/db/snapshot-id.txt)" -var='eks_cutover=false' -out=p
#  ↑ eks_cutover=false : 아직 EKS ALB 가 없다. EKS 올린 뒤 true 로 재apply → DNS 컷오버
terraform apply p
```

스냅샷이 없으면(리허설 후 삭제했다면) 빈 DB로 apply → F8의 SG 규칙 → `zcat $BK/db/*.sql.gz | mysql`

### 5-C. SSM 재주입 (apply **직후**)

```bash
bash $BK/ssm/restore-ssm.sh
aws ssm get-parameters-by-path --path /drawe/dev --recursive --with-decryption \
  --query 'Parameters[?starts_with(Value, `CHANGE_ME`)].Name'    # 비어야 정상
```

`ignore_changes = [value]`라 이후 plan은 깨끗하다. 순서가 반대면 apply가 CHANGE_ME로 덮는다.

### 5-D. S3

```bash
aws s3 sync $BK/s3/artref/ s3://drawe-dev-artref/
aws s3 sync $BK/s3/bria/   s3://drawe-dev-bria-ai/
```

> 버킷 이름은 전역 유일 — 삭제 후 재생성이라 `BucketAlreadyExists`가 뜨면 잠시 후 재시도.
> **키 보존이 중요하다** — `ref_id` → Qdrant → `reference_images` → S3 presigned 체인이 키로 이어진다.

### 5-E. ECR 재빌드

```bash
gh workflow run backend-cd.yml -f environment=dev    # fastapi-cd, fastapi-guide-cd 도
```

guide는 `vitpose-base` revision 미핀이라 **가중치가 달라질 수 있다**(2-F). 확인 필요.

### 5-F. EKS — `dev_eks_bringup.md` 그대로

- **0단계 필수**: NAT + Valkey `start-instances` → `wait instance-status-ok`
- 2-cluster → 3-platform apply
- **SG id 갱신**: `pods_db_security_group_id`·`cluster_security_group_id`가 전부 바뀐다 →
  `overlays/dev/{backend,fastapi-guide}/kustomization.yaml` 교체 후 **develop 커밋**
- ArgoCD 앱 4개(backend/fastapi-embed/fastapi-guide/observability) → **D3 스키마 대조**
- 마지막에 `eks_cutover=true`로 재apply → api-dev DNS 컷오버

### 5-G. 검증

bring-up 6단계: readiness 200 · OAuth 실로그인 · AuthedImage 로드 · 가이드 1건 관통 ·
`ref_id` → Qdrant → `reference_images` → S3 presigned.

---

## 6. prod 종료 시 (**2026-07-28 실행 완료** → `prod_full_teardown.md`)

> **이 장은 예측이었고, 실행 기록은 `prod_full_teardown.md` 에 있다.** 아래 표의 예측은 대체로 맞았지만
> 세 가지가 빗나갔다 — ① **F1 이 반전**(prod 는 `skip_final_snapshot=false` + `deletion_protection=true`
> 라 destroy 가 *거부*된다) ② **F9 의 EIP·고아 SG·TF 밖 SSM 이 prod 엔 없었다**(로그그룹만 성립)
> ③ **F6 은 예측보다 한 겹 깊었다** — NodeClaim 을 지워도 Karpenter 가 즉시 새로 띄우고,
> destroy 중 컨트롤러가 사라지는 순간 남은 NodeClaim 이 고아가 되어 CRD uninstall 이 5분 타임아웃 났다.
> 반대로 **dev 에 없던 함정 4개(P1~P4)** 가 새로 나왔다: `.env` 의 DB 암호가 낡음 / `.env` 사본 2개 중
> WSL 쪽이 오타본 / 덤프 파드에 `app=backend` 라벨을 붙이면 실트래픽을 먹음 /
> **최종 스냅샷 이름의 날짜가 거짓**(`ignore_changes` 가 `timestamp()` 를 얼림).

이 골격을 쓰되 **차이가 있다**:

| dev | prod |
| --- | --- |
| NAT = 단일 EC2 (`aws_instance.nat`) | **NAT = ASG ×2** (`nat-instance.tf`, `aws_eip` 실존 — 이건 진짜 EIP다) |
| Valkey = EC2 self-host | **ElastiCache** (스냅샷 별도 고려) |
| — | **AMP**(`amp.tf`, `amp-rules.tf`) · **observability self-host**(`observability.tf`) |
| S3 2개 (artref, bria) | **+ Loki/Tempo 버킷**(`s3.tf`) — force_destroy 여부 확인 필수. 로그·트레이스 보존 판단 |
| — | `iam-bedrock.tf` |
| 이미 EKS teardown | **EKS 살아 있음** → F5·F6가 실전. `prod_eks_teardown.md`(재우기)와 단계 diff 필요 |

**★ `drawe-prod-fastapi-guide:latest`를 반드시 먼저 내릴 것** — ViTPose·OpenCLIP 가중치의 마지막 사본이다(2-F).

**F1~F4·F7~F9는 prod에도 성립하는지 코드로 재확인할 것.** 특히
`terraform-prod/rds.tf`의 `skip_final_snapshot`, prod S3의 `force_destroy`,
prod의 `random_password` count 패턴.

참고: prod ECR에도 buildcache가 5개(4.27GB × 5) 쌓여 있다 — 실이미지 6개보다 크다.
`ecr.tf` lifecycle의 "untagged 1일 후 삭제"가 안 먹는 듯. 별건.

---

## 한눈 요약

```
0) 계정 가드 (570515227314 — prod 아님!)
1) develop push 금지 (워크플로 파일은 건드리지 말 것 — main 공용)
2) 백업  ← 되돌릴 수 없는 지점 전
   B. SSM --with-decryption 28개                    (F4)
   C. .env ★ + tfvars + tfstate 3종                 (로테이션 지뢰)
   D. 스냅샷 + mysqldump (SG 임시 추가 필요)         (F1, F8)
   E. S3 sync + sum(file sizes) 대조                (F2)
   F. ECR 은 비우지 말 것 (force_delete=true)
   G. tar + 암호화
3) 정리
   A. EKS 검증 (state 비어도 SG·로그그룹 남음)      (F9)
   B. S3 비우기 (대조 통과 후에만)
   C. terraform destroy  ← eks_cutover=false 선행    (F3)
      DependencyViolation → 고아 SG 의심            (F9)
4) 스윕: ServiceManaged + describe-security-groups + 로그그룹 + TF 밖 SSM
5) 복구: .env → apply(snapshot_identifier) → SSM 재주입 → S3 sync → CI → bring-up
   ⚠️ 덤프 복원만 실증됨. 나머지는 미실증.
```
