#!/usr/bin/env bash
###############################################################################
# prod-shared-infra.sh  —  EKS 가 필요로 하고 ECS 도 쓰던 "공유 자원만" 개별 제어
#
# 배경: prod_enabled 하나가 ECS 컴퓨트 + NAT + ElastiCache 를 다 묶어 일괄 on/off.
#       마이그레이션 동안은 ECS 컴퓨트는 끈 채로, EKS 가 재사용하는 공유 자원
#       (NAT / ElastiCache / RDS) 만 단계별로 켜고 싶다.
#
# 이 스크립트가 하는 것:
#   [1회·멱등] NAT·ElastiCache 를 prod_enabled 에서 분리(nat_enabled / cache_enabled)
#   [상태설정] prod_enabled=false(ECS 컴퓨트 OFF 유지) + 플래그대로 NAT/Cache/RDS 제어
#
# 공유 자원 ↔ 단계:
#   NAT        : EKS 노드 egress — 2-cluster 부터 필요        (기본 ON)
#   ElastiCache: 백엔드 세션 — 앱 검증 때 필요                (기본 OFF, --cache 로 ON)
#   RDS        : 백엔드 DB — 앱 검증 때 필요(토글無, CLI)     (기본 변경안함, --rds 로 start)
#   ※ 항상 켜진 것(토글 불필요): VPC/Subnet/SG/SSM/S3/ECR/ACM
#   ※ 계속 꺼두는 것: ECS 서비스·컨테이너 인스턴스·오토스케일링·관측성(grafana/loki/tempo)
#
# 플래그:
#   (기본)            NAT=on  Cache=off  RDS=변경안함   ← 2-cluster/3-platform 단계
#   --validate        NAT=on  Cache=on   RDS=start      ← 앱 검증 단계 한 방
#   --nat / --no-nat  --cache / --no-cache  --rds / --no-rds
#   --plan-only       plan 만   --yes  무인 apply
#
# 안전: 계정 prod(933832340498) 확인. 수정 전 .bak. 멱등. plan→확인→apply.
# 실행: terraform-prod 또는 레포 루트(자동탐색). 경로 인자 가능.
###############################################################################
set -euo pipefail

PROD_ACCOUNT_ID="933832340498"
AWS_REGION="${AWS_REGION:-ap-northeast-2}"
RDS_ID="drawe-prod-mysql"

NAT=on; CACHE=off; RDS=skip; AUTO_YES=0; PLAN_ONLY=0; TFDIR_ARG=""
for a in "$@"; do
  case "$a" in
    --validate)  NAT=on; CACHE=on; RDS=on ;;
    --nat)       NAT=on ;;   --no-nat)   NAT=off ;;
    --cache)     CACHE=on ;; --no-cache) CACHE=off ;;
    --rds)       RDS=on ;;   --no-rds)   RDS=off ;;
    --yes|-y)    AUTO_YES=1 ;;
    --plan-only) PLAN_ONLY=1 ;;
    -h|--help)   grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           TFDIR_ARG="$a" ;;
  esac
done

if [ -t 1 ]; then C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_B=$'\033[1m'; C_0=$'\033[0m'; else C_G=; C_Y=; C_R=; C_B=; C_0=; fi
info(){ echo "${C_G}✔${C_0} $*"; }
warn(){ echo "${C_Y}▲${C_0} $*"; }
err(){  echo "${C_R}✘${C_0} $*" >&2; }
step(){ echo; echo "${C_B}── $* ──${C_0}"; }
onoff(){ [ "$1" = on ] && echo true || echo false; }

# ── 0) 탐색 + 계정 가드 ─────────────────────────────────────────────────────
step "0) terraform-prod / 계정 확인"
find_tfdir(){
  for d in "$TFDIR_ARG" "." "infra/terraform-prod" "terraform-prod" "../terraform-prod"; do
    [ -n "$d" ] || continue
    if [ -f "$d/main.tf" ] && grep -q 'drawe/prod/terraform.tfstate' "$d/main.tf" 2>/dev/null; then
      ( cd "$d" && pwd ); return 0
    fi
  done; return 1
}
TFDIR="$(find_tfdir || true)"
[ -n "$TFDIR" ] || { err "terraform-prod 못 찾음. 경로 인자 지정: bash $0 /path/to/terraform-prod"; exit 1; }
info "terraform-prod: $TFDIR"
for f in nat-instance.tf elasticache.tf variables.tf; do
  [ -f "$TFDIR/$f" ] || { err "$TFDIR/$f 없음"; exit 1; }
done
command -v aws >/dev/null 2>&1 || { err "aws CLI 없음"; exit 1; }
command -v terraform >/dev/null 2>&1 || { err "terraform 없음"; exit 1; }
CALLER_ACC="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo '?')"
[ "$CALLER_ACC" = "$PROD_ACCOUNT_ID" ] || { err "AWS 계정 prod 아님(=$CALLER_ACC). 프로파일 전환 후 재실행."; exit 1; }
info "계정 $CALLER_ACC (prod) / region $AWS_REGION"
echo
info "목표 상태 →  NAT=$NAT  Cache=$CACHE  RDS=$RDS  (ECS 컴퓨트=off 유지)"

TS="$(date +%Y%m%d-%H%M%S)"

# ── 1) [1회·멱등] NAT·ElastiCache 분리 패치 ─────────────────────────────────
step "1) 공유 자원 분리 패치 (멱등)"
# NAT
if grep -q "var.nat_enabled" "$TFDIR/nat-instance.tf"; then
  info "NAT 이미 분리됨 — 건너뜀"
else
  cp "$TFDIR/nat-instance.tf" "$TFDIR/nat-instance.tf.bak-$TS"
  python3 - "$TFDIR/nat-instance.tf" "nat_enabled" <<'PY'
import sys, pathlib
p=pathlib.Path(sys.argv[1]); var=sys.argv[2]; t=p.read_text(encoding='utf-8')
old="var.prod_enabled ? 1 : 0"; new=f"(var.prod_enabled || var.{var}) ? 1 : 0"
n=t.count(old); p.write_text(t.replace(old,new),encoding='utf-8')
print(f"  NAT 게이트 {n}곳 분리")
PY
  info "NAT 패치(+백업)"
fi
# ElastiCache
if grep -q "var.cache_enabled" "$TFDIR/elasticache.tf"; then
  info "ElastiCache 이미 분리됨 — 건너뜀"
else
  cp "$TFDIR/elasticache.tf" "$TFDIR/elasticache.tf.bak-$TS"
  python3 - "$TFDIR/elasticache.tf" "cache_enabled" <<'PY'
import sys, pathlib
p=pathlib.Path(sys.argv[1]); var=sys.argv[2]; t=p.read_text(encoding='utf-8')
old="var.prod_enabled ? 1 : 0"; new=f"(var.prod_enabled || var.{var}) ? 1 : 0"
n=t.count(old); p.write_text(t.replace(old,new),encoding='utf-8')
print(f"  ElastiCache 게이트 {n}곳 분리")
PY
  info "ElastiCache 패치(+백업)"
fi
# 변수 선언 (각각 멱등)
add_var(){ # $1=name $2=desc
  grep -q "variable \"$1\"" "$TFDIR/variables.tf" && { info "variable $1 이미 있음"; return 0; }
  cp "$TFDIR/variables.tf" "$TFDIR/variables.tf.bak-$TS" 2>/dev/null || true
  cat >> "$TFDIR/variables.tf" <<TF

# EKS 마이그레이션: prod_enabled 와 무관하게 켜는 공유자원 분리 스위치. default=false(동작 보존).
variable "$1" {
  description = "$2"
  type        = bool
  default     = false
}
TF
  info "variable $1 추가"
}
add_var "nat_enabled"   "true 면 prod_enabled 무관 NAT 유지(EKS 노드 egress)."
add_var "cache_enabled" "true 면 prod_enabled 무관 ElastiCache 유지(백엔드 세션)."

# ── 2) tfvars 상태 설정 ─────────────────────────────────────────────────────
step "2) tfvars 설정 (prod_enabled=false, nat/cache 플래그)"
TFVARS="$TFDIR/terraform.tfvars"; USE_VAR=0
NAT_B="$(onoff "$NAT")"; CACHE_B="$(onoff "$CACHE")"
if [ -f "$TFVARS" ]; then
  cp "$TFVARS" "$TFVARS.bak-$TS"
  python3 - "$TFVARS" "$NAT_B" "$CACHE_B" <<'PY'
import sys, re, pathlib
p=pathlib.Path(sys.argv[1]); nat=sys.argv[2]; cache=sys.argv[3]
lines=p.read_text(encoding='utf-8').split('\n')
def setkv(lines,k,v):
    pat=re.compile(rf'^\s*{re.escape(k)}\s*=')   # 주석(#) 라인은 매칭 안 함 → 예시 주석 오인 방지
    out=[];done=False
    for ln in lines:
        if pat.match(ln):
            if not done: out.append(f"{k} = {v}");done=True
            # 이미 처리됨 → 중복 실제 할당은 버림(self-heal)
        else: out.append(ln)
    if not done:
        if out and out[-1].strip()!="" : out.append("")
        out.append(f"{k} = {v}")
    return out
lines=setkv(lines,"prod_enabled","false")
lines=setkv(lines,"nat_enabled",nat)
lines=setkv(lines,"cache_enabled",cache)
p.write_text('\n'.join(lines),encoding='utf-8')
print(f"  prod_enabled=false, nat_enabled={nat}, cache_enabled={cache}")
PY
  info "tfvars 갱신(+백업)"
else
  warn "terraform.tfvars 없음 → -var 로 전달"
  USE_VAR=1
fi

# ── 3) RDS (토글 무관, CLI) ─────────────────────────────────────────────────
step "3) RDS 처리 ($RDS)"
if [ "$RDS" = skip ]; then
  info "RDS 변경 안 함 (--rds / --no-rds 로 제어)"
else
  ST="$(aws rds describe-db-instances --db-instance-identifier "$RDS_ID" --region "$AWS_REGION" \
        --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo NOTFOUND)"
  if [ "$RDS" = on ]; then
    case "$ST" in
      available) info "RDS 이미 available" ;;
      stopped)   aws rds start-db-instance --db-instance-identifier "$RDS_ID" --region "$AWS_REGION" >/dev/null; info "RDS start 요청(available 3~10분)" ;;
      NOTFOUND)  err "RDS $RDS_ID 없음"; exit 1 ;;
      *)         warn "RDS 상태=$ST — 잠시 후 재확인" ;;
    esac
  else # off
    case "$ST" in
      available) aws rds stop-db-instance --db-instance-identifier "$RDS_ID" --region "$AWS_REGION" >/dev/null; info "RDS stop 요청" ;;
      stopped)   info "RDS 이미 stopped" ;;
      NOTFOUND)  err "RDS $RDS_ID 없음"; exit 1 ;;
      *)         warn "RDS 상태=$ST — stop 보류" ;;
    esac
  fi
fi

# ── 4) plan ─────────────────────────────────────────────────────────────────
step "4) terraform plan"
VAR_ARGS=(); [ "$USE_VAR" = 1 ] && VAR_ARGS=(-var "prod_enabled=false" -var "nat_enabled=$NAT_B" -var "cache_enabled=$CACHE_B")
terraform -chdir="$TFDIR" init -input=false >/dev/null && info "init OK"
terraform -chdir="$TFDIR" plan -input=false "${VAR_ARGS[@]}" -out tfplan
echo
warn "기대 plan:"
warn "  · ECS(서비스·컨테이너 ASG·오토스케일링·관측성) → 0/destroy  (prod_enabled=false)"
warn "  · NAT ASG       → $([ "$NAT" = on ] && echo '유지(변화 없음 또는 0→1)' || echo 'destroy/0')"
warn "  · ElastiCache   → $([ "$CACHE" = on ] && echo 'create/유지' || echo 'destroy/없음')"
warn "  의도와 다르면(특히 NAT 가 안 켜지면) 멈추고 확인."

if [ "$PLAN_ONLY" = 1 ]; then step "plan-only"; echo "  terraform -chdir=$TFDIR apply tfplan"; exit 0; fi

# ── 5) 확인 후 apply ────────────────────────────────────────────────────────
step "5) apply"
if [ "$AUTO_YES" != 1 ]; then
  printf "%s" "${C_B}위 상태로 적용할까요? [y/N] ${C_0}"; read -r ans
  case "$ans" in y|Y|yes|YES) ;; *) warn "취소(tfplan 보존)"; exit 0 ;; esac
fi
terraform -chdir="$TFDIR" apply tfplan
info "apply 완료"

# ── 6) 확인 ─────────────────────────────────────────────────────────────────
step "완료 — 확인"
cat <<EOF
${C_B}목표${C_0}  NAT=$NAT  Cache=$CACHE  RDS=$RDS  (ECS=off)

${C_B}점검${C_0}
  NAT:    aws autoscaling describe-auto-scaling-groups --region $AWS_REGION \\
            --query "AutoScalingGroups[?contains(AutoScalingGroupName,'nat')].[AutoScalingGroupName,DesiredCapacity]" --output text
          → $([ "$NAT" = on ] && echo 'nat_a/nat_c = 1' || echo 'nat_a/nat_c = 0')
  Cache:  aws elasticache describe-replication-groups --replication-group-id drawe-prod-valkey \\
            --region $AWS_REGION --query 'ReplicationGroups[0].Status' 2>&1
          → $([ "$CACHE" = on ] && echo 'available' || echo 'NotFound(없음)')
  RDS:    aws rds describe-db-instances --db-instance-identifier $RDS_ID --region $AWS_REGION \\
            --query 'DBInstances[0].DBInstanceStatus'
  ECS:    aws ecs describe-clusters --clusters drawe-prod-cluster --region $AWS_REGION \\
            --query 'clusters[0].registeredContainerInstancesCount'  → 0

${C_B}단계별 사용${C_0}
  2-cluster / 3-platform :  bash $(basename "$0")              # NAT만
  앱 검증(Phase 6)       :  bash $(basename "$0") --validate   # NAT+Cache+RDS
  ※ Cache 재생성 시 primary endpoint 가 바뀜 → overlay REDIS_HOST 갱신.
EOF
