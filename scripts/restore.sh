#!/bin/sh
# EUMBMS PostgreSQL 복구 (pg_restore). 기존 객체는 삭제 후 복구합니다.
set -e
cd "$(dirname "$0")/.."
[ -f .env ] && . ./.env
: "${DATABASE_URL:?DATABASE_URL이 필요합니다}"
FILE=${1:?복구할 dump 파일 경로를 인자로 주세요}
[ -f "$FILE" ] || { echo "파일 없음: $FILE"; exit 1; }
echo "주의: $DATABASE_URL 의 기존 객체를 삭제하고 $FILE 로 복구합니다."
printf "계속하려면 yes 입력: "
read -r ANSWER
[ "$ANSWER" = "yes" ] || { echo "취소됨"; exit 1; }
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" "$FILE"
echo "복구 완료. 서버를 재시작하세요."
