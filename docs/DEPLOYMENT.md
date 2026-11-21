# 배포·설치 가이드

## 1. 요구사항

| 구분 | 최소 | 권장 |
|---|---|---|
| OS | Windows Server 2019 / Ubuntu 22.04 | Windows Server 2022 / Ubuntu 24.04 |
| CPU | 4 core | 8 core |
| RAM | 8GB | 16GB+ (태그 10만 기준) |
| DB | PostgreSQL 16+ | PostgreSQL 18 + TimescaleDB(선택) |
| Node.js | 24 LTS | 24 LTS |
| 저장공간 | 50GB | 500GB+ (시계열 보관 기간에 따름) |

네트워크: 관제 PC ↔ 중앙 서버 HTTPS, 현장 게이트웨이 → 중앙 서버 outbound HTTPS.
PLC/RTU는 인터넷에 직접 노출하지 마세요.

---

## 2. Docker Compose (권장)

```bash
cp .env.example .env
# .env 에서 SESSION_SECRET, POSTGRES_PASSWORD, DATABASE_URL 확인

docker compose up -d db
docker compose run --rm server npx prisma migrate deploy
docker compose run --rm server npx tsx prisma/seed.ts   # 최초 1회(선택)
docker compose up -d server
```

- 접속: `http://<서버IP>:3000`
- TimescaleDB 사용: `DB_IMAGE=timescale/timescaledb:latest-pg16 docker compose up -d db`
  이후 `psql "$DATABASE_URL" -f scripts/timescale-setup.sql` (선택, 백업 후)
- 데모: `docker compose --profile demo up -d simulator`
- 게이트웨이(현장 PC): `.env`에 `EUMBMS_GATEWAY_TOKEN` 설정 후
  `docker compose --profile gateway up -d gateway`
- 운영에서는 앞단에 nginx/Caddy로 TLS를 종료하고 3000 포트를 외부에 노출하지 마세요.

### HTTPS 예시 (Caddy)

```
bms.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

---

## 3. Linux (systemd)

```bash
sudo DATABASE_URL='postgresql://eumbms:비밀번호@127.0.0.1:5432/eumbms?schema=public' \
  sh scripts/install-linux.sh
```

- 설치 위치: `/opt/eumbms`
- 서비스: `systemctl status eumbms`
- 최초 시드: `SEED=yes sudo -E sh scripts/install-linux.sh` (또는 수동 `npx tsx prisma/seed.ts`)
- 게이트웨이: `/etc/systemd/system/eumbms-gateway.service`에 `EUMBMS_GATEWAY_TOKEN` 추가 후
  `systemctl enable --now eumbms-gateway`

### 수동 설치 요약

```bash
npm ci
npx prisma migrate deploy
npm run build
NODE_ENV=production npm start
```

---

## 4. Windows Server

```powershell
.\scripts\install-windows.ps1 -DatabaseUrl "postgresql://eumbms:비밀번호@127.0.0.1:5432/eumbms?schema=public" -Seed
```

- 설치 위치: `C:\EUMBMS`
- 서비스 등록은 NSSM 사용(스크립트가 명령 안내)
- 방화벽 3000 인바운드 허용
- PostgreSQL은 Windows 서비스로 설치하고 `pg_hba.conf`에서 로컬 접속만 허용

---

## 5. 게이트웨이 설치 (현장)

1. EUMBMS 웹 → **통신변환기 관리** → 게이트웨이 등록 → **토큰 1회 표시** 복사
2. 현장 PC에 소스/이미지 배포
3. 환경변수 설정

```bash
export EUMBMS_CENTRAL_URL=https://bms.example.com
export EUMBMS_GATEWAY_TOKEN=eum_xxxxxxxx
export EUMBMS_BUFFER_DIR=/opt/eumbms/.queue
npm run gateway
```

- 중앙 서버와 단절되면 `.queue/buffer-*.jsonl`에 저장하고, 복구 시 순서대로 전송합니다.
- 게이트웨이는 중앙 서버로만 outbound 연결합니다.
- 시리얼 RS-485 장치는 시리얼-이더넷 변환기를 통해 Modbus RTU over TCP로 연결하세요(직접 시리얼 구동 미지원).

---

## 6. 데이터베이스

```bash
# 마이그레이션 적용 (운영)
npx prisma migrate deploy

# 백업
sh scripts/backup.sh /backup/eumbms-$(date +%F).dump

# 복구 (서비스 중지 후)
sh scripts/restore.sh /backup/eumbms-2026-11-22.dump
```

권장 백업 정책: 일 1회 전체 백업, 30일 보관, 월 1회 복구 훈련, 백업 파일 별도 저장소 보관.

---

## 7. 업데이트·롤백

```bash
sudo sh scripts/update-rollback.sh update
# 문제 시
sudo sh scripts/update-rollback.sh rollback <이전 커밋>
```

업데이트 전 자동 백업과 이전 리비전 기록(`.last-good-revision`)을 남깁니다.
DB 마이그레이션이 포함된 롤백은 백업 복구가 필요할 수 있습니다.

---

## 8. 운영 설정

| 환경변수 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL 접속 문자열 |
| `SESSION_SECRET` | 세션 서명 키(32바이트 이상 권장) |
| `ENABLE_COLLECTOR` | `1`이면 서버 내장 수집기 사용(데모/검증용) |
| `COLLECTOR_INTERVAL_MS` | 서버 내장 수집 주기(기본 5000) |
| `EUMBMS_CENTRAL_URL` | 게이트웨이 → 중앙 서버 URL |
| `EUMBMS_GATEWAY_TOKEN` | 게이트웨이 등록 토큰 |
| `EUMBMS_POLL_MS` | 게이트웨이 폴링 주기 |
| `EUMBMS_BUFFER_DIR` | 게이트웨이 오프라인 버퍼 경로 |

---

## 9. 배포 후 체크리스트

- [ ] `admin@eumbms.local` 기본 비밀번호 변경
- [ ] `SESSION_SECRET` 운영용으로 교체
- [ ] HTTPS 적용, 3000 포트 외부 차단
- [ ] DB 계정 최소 권한, 원격 접속 제한
- [ ] 게이트웨이 토큰 재발급·안전 보관
- [ ] 백업 스케줄 등록 및 복구 훈련
- [ ] 승인자 계정 2개 이상 확보
- [ ] 실장비 통신 시험 후에만 원격제어 허용
- [ ] 알람 임계값 현장 기준 확인
