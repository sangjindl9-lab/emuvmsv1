#!/bin/sh
# EUMBMS Linux 서버 설치 (systemd)
# 사용: sudo sh scripts/install-linux.sh
# 전제: Node.js 24, PostgreSQL 18, npm, git
set -e

APP_DIR=${APP_DIR:-/opt/eumbms}
APP_USER=${APP_USER:-eumbms}
DB_URL=${DATABASE_URL:-}
SRC_DIR=$(cd "$(dirname "$0")/.." && pwd)

if [ "$(id -u)" -ne 0 ]; then
  echo "root 권한으로 실행하세요: sudo sh scripts/install-linux.sh"
  exit 1
fi
if [ -z "$DB_URL" ]; then
  echo "DATABASE_URL 환경변수가 필요합니다. 예: postgresql://eumbms:비밀번호@127.0.0.1:5432/eumbms?schema=public"
  exit 1
fi
command -v node >/dev/null || { echo "Node.js 24가 필요합니다."; exit 1; }
command -v psql >/dev/null || { echo "PostgreSQL 클라이언트(psql)가 필요합니다."; exit 1; }

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"
cp -a "$SRC_DIR"/. "$APP_DIR"/
cd "$APP_DIR"

echo "── 의존성 설치 ──"
sudo -u "$APP_USER" npm ci --no-audit --no-fund

if [ ! -f .env ]; then
  SECRET=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
  cat > .env <<EOF
DATABASE_URL="$DB_URL"
SESSION_SECRET="$SECRET"
APP_NAME="EUMBMS"
ENABLE_COLLECTOR="0"
EOF
  chmod 600 .env
  echo ".env 생성 완료 (SESSION_SECRET 자동 생성)"
fi

echo "── DB 마이그레이션 ──"
sudo -u "$APP_USER" env DATABASE_URL="$DB_URL" npx prisma migrate deploy
if [ "${SEED:-no}" = "yes" ]; then
  sudo -u "$APP_USER" env DATABASE_URL="$DB_URL" npx tsx prisma/seed.ts
fi

echo "── 빌드 ──"
sudo -u "$APP_USER" npm run build

cat > /etc/systemd/system/eumbms.service <<EOF
[Unit]
Description=EUMBMS Server (EUM BMS PRO)
After=network.target postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/env npm start
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/eumbms-gateway.service <<EOF
[Unit]
Description=EUMBMS Edge Gateway
After=network-online.target eumbms.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=EUMBMS_CENTRAL_URL=http://127.0.0.1:3000
Environment=EUMBMS_BUFFER_DIR=$APP_DIR/.queue
ExecStart=/usr/bin/env npx tsx gateway/agent.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
mkdir -p "$APP_DIR/.queue"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

systemctl daemon-reload
systemctl enable eumbms.service
systemctl restart eumbms.service

cat <<EOF

설치 완료.
- 서비스: systemctl status eumbms
- 주소:   http://$(hostname -I | cut -d' ' -f1):3000
- 초기 관리자: admin@eumbms.local / Eumbms!2026 (로그인 후 즉시 변경)
- 게이트웨이: /etc/systemd/system/eumbms-gateway.service 의 EUMBMS_GATEWAY_TOKEN 을 설정한 뒤
             systemctl enable --now eumbms-gateway
- HTTPS: 앞단에 nginx/Caddy 리버스 프록시를 두고 NODE_ENV=production(secure 쿠키)을 유지하세요.
EOF
