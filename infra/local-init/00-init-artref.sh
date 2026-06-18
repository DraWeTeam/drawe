#!/bin/bash
# MySQL 최초 기동 시(빈 볼륨) 1회 실행. artref DB + 스키마 적용.
# --force: ddl 에 이미 반영된 ALTER 마이그레이션의 "duplicate column" 류 에러를 무시하고 계속.
set -u
echo "[init] applying artref schema..."
mysql --force -uroot -p"${MYSQL_ROOT_PASSWORD}" < /schema/artref-schema.sql
echo "[init] artref schema applied."
