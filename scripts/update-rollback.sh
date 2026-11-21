#!/bin/sh
# EUMBMS 업데이트 및 롤백
# 사용: sudo sh scripts/update-rollback.sh update [git-ref]
#       sudo sh scripts/update-rollback.sh rollback <git-ref>
set -e
cd "$(dirname "$0")/.."
ACTION=${1:-update}
REF=${2:-}
[ -f .env ] && . ./.env

case "$ACTION" in
  update)
    echo "── 백업 ──"
    sh scripts/backup.sh "backups/pre-update-$(date +%Y%m%d-%H%M%S).dump"
    PREV=$(git rev-parse --short HEAD)
    echo "$PREV" > .last-good-revision
    if [ -n "$REF" ]; then git fetch --all && git checkout "$REF"; else git pull --ff-only; fi
    npm ci --no-audit --no-fund
    npx prisma migrate deploy
    npm run build
    systemctl restart eumbms 2>/dev/null || echo "systemd 서비스가 없으면 수동으로 재시작하세요."
    echo "업데이트 완료. 이전 리비전: $PREV (롤백: sh scripts/update-rollback.sh rollback $PREV)"
    ;;
  rollback)
    [ -n "$REF" ] || { echo "롤백할 git ref를 지정하세요."; exit 1; }
    echo "── 롤백 $REF ──"
    sh scripts/backup.sh "backups/pre-rollback-$(date +%Y%m%d-%H%M%S).dump"
    git checkout "$REF"
    npm ci --no-audit --no-fund
    npx prisma migrate deploy
    npm run build
    systemctl restart eumbms 2>/dev/null || true
    echo "롤백 완료. DB 마이그레이션은 이전 스키마와 호환되는 경우에만 자동 적용됩니다. 필요 시 backup dump로 복구하세요."
    ;;
  *)
    echo "사용: $0 update [ref] | rollback <ref>"
    exit 1
    ;;
esac
