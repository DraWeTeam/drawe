#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────
# scripts/db-connect.sh
#
# RDS 에 로컬 mysql 클라이언트로 접속하기 위한 SSM port forwarding.
#
# 전제:
#   - AWS CLI 설치 + 자격증명 (terraform 쓰는 계정과 동일 권한)
#   - SSM Session Manager plugin 설치:
#       macOS: brew install --cask session-manager-plugin
#       그 외: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
#   - 로컬 mysql 클라이언트 (mysql 또는 mycli)
#
# 사용:
#   ./scripts/db-connect.sh dev        # dev RDS 로 port forward
#   ./scripts/db-connect.sh prod       # prod RDS 로 port forward
#
# 이 스크립트가 background 로 SSM 세션 띄우고 RDS 비밀번호 출력해줍니다.
# 그 후 다른 터미널에서:
#   mysql -h 127.0.0.1 -P 3306 -u drawe_admin -p
# ────────────────────────────────────────────────────────────
set -euo pipefail

ENV="${1:-dev}"
LOCAL_PORT="${2:-3306}"

if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
    echo "Usage: $0 <dev|prod> [local_port=3306]"
    exit 1
fi

PROJECT="drawe"
PREFIX="${PROJECT}-${ENV}"

echo "──────────────────────────────────────────────────────"
echo "🔌 ${ENV} RDS port forwarding 준비 중..."
echo "──────────────────────────────────────────────────────"

# 1) SSM-ready 인스턴스 찾기 — ECS host 우선, 없으면 NAT instance, 없으면 valkey
INSTANCE_ID=$(aws ec2 describe-instances \
    --filters \
        "Name=tag:Name,Values=${PREFIX}-ecs-instance" \
        "Name=instance-state-name,Values=running" \
    --query 'Reservations[0].Instances[0].InstanceId' \
    --output text 2>/dev/null || echo "None")

if [[ "$INSTANCE_ID" == "None" || -z "$INSTANCE_ID" ]]; then
    INSTANCE_ID=$(aws ec2 describe-instances \
        --filters \
            "Name=tag:Role,Values=nat-instance" \
            "Name=instance-state-name,Values=running" \
        --query 'Reservations[0].Instances[0].InstanceId' \
        --output text 2>/dev/null || echo "None")
fi

if [[ "$INSTANCE_ID" == "None" || -z "$INSTANCE_ID" ]]; then
    INSTANCE_ID=$(aws ec2 describe-instances \
        --filters \
            "Name=tag:Name,Values=${PREFIX}-valkey" \
            "Name=instance-state-name,Values=running" \
        --query 'Reservations[0].Instances[0].InstanceId' \
        --output text 2>/dev/null || echo "None")
fi

if [[ "$INSTANCE_ID" == "None" || -z "$INSTANCE_ID" ]]; then
    echo "❌ SSM 으로 접근 가능한 running EC2 인스턴스를 찾지 못했습니다."
    echo "   ECS 클러스터가 켜져 있는지 (dev 면 평일 13~18시 외엔 OFF) 확인하세요."
    exit 1
fi

echo "  instance: ${INSTANCE_ID}"

# 2) RDS endpoint
RDS_HOST=$(aws rds describe-db-instances \
    --db-instance-identifier "${PREFIX}-mysql" \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text)

echo "  RDS:      ${RDS_HOST}:3306"

# 3) DB 비밀번호 출력 (편의)
DB_PWD=$(aws ssm get-parameter \
    --name "/${PROJECT}/${ENV}/db-password" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text)

echo ""
echo "──────────────────────────────────────────────────────"
echo "📌 다른 터미널에서 다음 명령으로 접속:"
echo ""
echo "    mysql -h 127.0.0.1 -P ${LOCAL_PORT} -u drawe_admin -p"
echo ""
echo "    Password: ${DB_PWD}"
echo "──────────────────────────────────────────────────────"
echo ""
echo "  Ctrl+C 로 세션 종료"
echo ""

# 4) Port forwarding 세션 시작
aws ssm start-session \
    --target "${INSTANCE_ID}" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "host=${RDS_HOST},portNumber=3306,localPortNumber=${LOCAL_PORT}"
