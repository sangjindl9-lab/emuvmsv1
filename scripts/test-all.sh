#!/bin/sh
# EUMBMS 전체 검증: 타입체크 → 단위/소켓 테스트 → 프로덕션 빌드 → 실제 PostgreSQL + next start HTTP 스모크
# PostgreSQL이 없으면 로컬 .tools 클러스터를 기동한다.
set -e
cd "$(dirname "$0")/.."
export PATH=/workspace/.tools/node/bin:$PATH
export DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@127.0.0.1:55432/eumbms_test?schema=public}"
export SESSION_SECRET="${SESSION_SECRET:-eumbms-test-secret-0123456789}"
export NODE_ENV=production

sh scripts/db-up.sh
. /workspace/.tools/pg-env.sh
psql -h 127.0.0.1 -p 55432 -U postgres -d eumbms_test -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" >/dev/null
npx prisma migrate deploy
npx tsx prisma/seed.ts

echo "── 타입체크 ──"
npx tsc --noEmit
echo "── 단위·소켓 테스트 ──"
npx vitest run
echo "── 프로덕션 빌드 ──"
npm run build

echo "── 실제 서버 + Modbus 시뮬레이터 통합 스모크 ──"
npx tsx scripts/demo-simulator.ts > /tmp/eumbms-sim.log 2>&1 &
SIM_PID=$!
npx next start -H 127.0.0.1 -p 3100 > /tmp/eumbms-next.log 2>&1 &
NEXT_PID=$!
cleanup() {
  kill "$NEXT_PID" 2>/dev/null || true
  kill "$SIM_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
set +e
node scripts/smoke-http.mjs
SMOKE=$?
set -e
if [ "$SMOKE" -ne 0 ]; then
  echo "── next 로그 (마지막 40줄) ──"
  tail -40 /tmp/eumbms-next.log
  echo "── simulator 로그 ──"
  tail -20 /tmp/eumbms-sim.log
fi
exit "$SMOKE"
