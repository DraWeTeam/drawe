#!/bin/bash
# 로컬 테스트용: 이메일 인증을 우회한다 (실제 메일 발송 없이).
# 사용법:  ./verify-email.sh your@email.com
# 그 후 프론트(5173)에서 같은 이메일로 회원가입하면 인증 통과됨.
if [ -z "$1" ]; then echo "사용법: ./verify-email.sh <email>"; exit 1; fi
EMAIL=$(echo "$1" | tr '[:upper:]' '[:lower:]')
docker exec drawe-valkey valkey-cli -a 'change-me-redis' SET "email:verify:verified:$EMAIL" true >/dev/null 2>&1
echo "[OK] $EMAIL 인증 플래그 주입 완료 (30분 유효). 이제 이 이메일로 회원가입하세요."
