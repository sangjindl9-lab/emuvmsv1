#!/bin/sh
# EUMBMS PostgreSQL 백업 (pg_dump custom format)
set -e
cd "$(dirname "$0")/.."
[ -f .env ] && . ./.env
: "${DATABASE_URL:?DATABASE_URL이 필요합니다}"
OUT=${1:-"backup-eumbms-$(date +%Y%m%d-%H%M%S).dump"}
mkdir -p "$(dirname "$OUT")"
echo "백업 시작: $OUT"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$OUT"
echo "백업 완료: $(ls -lh "$OUT" | tr -s ' ' | cut -d' ' -f5) $OUT"
