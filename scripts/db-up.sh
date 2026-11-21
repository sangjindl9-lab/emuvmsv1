#!/bin/sh
# 로컬 개발용 PostgreSQL 기동 (workspace .tools 클러스터, 포트 55432)
set -e
. /workspace/.tools/pg-env.sh
mkdir -p /tmp/pgsock
if ! pg_isready -q -h 127.0.0.1 -p 55432 2>/dev/null; then
  rm -f /workspace/.tools/pgdata/postmaster.pid
  pg_ctl -D /workspace/.tools/pgdata -l /workspace/.tools/pg.log \
    -o "-p 55432 -k /tmp/pgsock -c listen_addresses=127.0.0.1" -w start >/dev/null
fi
for db in eumbms eumbms_test; do
  if ! psql -h 127.0.0.1 -p 55432 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    psql -h 127.0.0.1 -p 55432 -U postgres -c "CREATE DATABASE $db" >/dev/null
  fi
done
echo "postgres ready on 127.0.0.1:55432"
