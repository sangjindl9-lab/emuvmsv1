# EUM BMS PRO (이음BMS)

빌딩·아파트·산업시설 통합 전력제어 및 원격검침 플랫폼 **EUMBMS 2.0.0**입니다.
특정 제조사에 종속되지 않고, 공개 프로토콜 문서를 기반으로 PLC·RTU·전력량계·통신변환기·보호계전기·UPS·발전기·수배전반을 통합 등록·감시·제어·검침합니다.

> 핵심 원칙: **실제 통신이 검증되지 않은 기능은 검증 완료로 표시하지 않습니다.**
> 이 저장소에서 실장비 통신까지 확인된 프로토콜은 없으며, Modbus 계열은 시뮬레이터(실제 TCP 소켓) 검증 완료로 표시됩니다.

## 구성

| 시스템 | 구현 위치 |
|---|---|
| A. EUM BMS CORE (중앙 서버·관제 엔진) | `src/app`, `src/server` |
| B. EUM PROTOCOL CENTER (프로토콜·드라이버) | `src/modules/protocol` |
| C. EUM DEVICE MANAGER (장치·태그 등록) | `src/server/routes/devices.ts`, `/devices`, `/tags` |
| D. EUM POWER SCADA (전력설비 감시·제어) | `src/server/routes/scada.ts`, `/scada`, `/diagrams` |
| E. EUM SMART METERING (원격검침·요금) | `src/modules/metering`, `/metering`, `/tariffs` |
| F. EUM ENERGY MANAGER (에너지 분석) | `/energy`, `energy/analysis` API |
| G. EUM EDGE GATEWAY (현장 수집·버퍼링) | `gateway/agent.ts` |

## 기술 스택

- TypeScript, Next.js 16 App Router, React 19, Tailwind CSS 4
- API Routes (`/api/v1/**`) + Zod 검증 보조 + Prisma ORM
- PostgreSQL 18 (TimescaleDB 선택), 33개 테이블
- 별도 프로토콜/드라이버 엔진 (`src/modules/protocol`) — 플러그인 구조
- Edge Gateway는 Node.js + `tsx`로 실행되는 독립 수집 에이전트

## 빠른 시작 (로컬)

```bash
# 1. 의존성
npm install

# 2. PostgreSQL 준비 (예: Docker)
docker compose up -d db

# 3. 환경변수
cp .env.example .env        # DATABASE_URL, SESSION_SECRET 수정

# 4. 마이그레이션 + 시드
npm run db:migrate
npm run db:seed

# 5. 빌드/실행
npm run build
npm start                   # http://localhost:3000

# 6. 선택: Modbus 시뮬레이터 (데모 장치가 15020/15021에 연결)
npm run demo:simulator
```

### 초기 계정 (시드)

| 이메일 | 역할 | 비밀번호 |
|---|---|---|
| `admin@eumbms.local` | 최고관리자 | `Eumbms!2026` |
| `manager@eumbms.local` | 관리자 | `Eumbms!2026` |
| `operator@eumbms.local` | 운전원 (제어 요청) | `Eumbms!2026` |
| `approver@eumbms.local` | 승인자 (제어 승인/실행) | `Eumbms!2026` |
| `viewer@eumbms.local` | 조회자 | `Eumbms!2026` |

운영 배포 직후 반드시 비밀번호를 변경하고 `SESSION_SECRET`을 새 값으로 교체하세요.

## 검증

```bash
npm run typecheck     # TypeScript
npm run test          # 단위 + 실제 TCP 소켓 Modbus + DB 스키마/시드 (34개)
npm run build         # 프로덕션 빌드
sh scripts/test-all.sh # 위 전체 + 실제 PostgreSQL·next start·HTTP/Modbus 통합 스모크
```

최근 검증 결과는 [`docs/TEST-RESULTS.md`](docs/TEST-RESULTS.md)에 있습니다.

## 화면(18개 메뉴)

1. 통합 대시보드 · 2. 사업장 관리 · 3. 건물·설비 관리 · 4. 전력 통합 관제 · 5. 단선결선도
6. PLC/RTU 관리 · 7. 통신변환기 관리 · 8. 프로토콜 센터 · 9. 태그·레지스터 관리 · 10. 원격검침
11. 전기요금 관리 · 12. 에너지 분석 · 13. 알람·장애관리 · 14. 원격제어 · 15. 보고서
16. 사용자·권한관리 · 17. 시스템 설정 · 18. 라이선스 관리

PC에서는 다중 패널 관제, 모바일에서는 경보 확인·계측 조회·검침·승인 중심으로 동작합니다.

## 문서

- [아키텍처](docs/ARCHITECTURE.md)
- [API 문서](docs/API.md)
- [운영자 매뉴얼](docs/OPERATOR-MANUAL.md)
- [제조사 호환성 검증표](docs/COMPATIBILITY.md)
- [알려진 제한사항](docs/LIMITATIONS.md)
- [배포/설치](docs/DEPLOYMENT.md)
- [검증 결과](docs/TEST-RESULTS.md)

## 안전 관련 고지

- 원격제어는 **이중 승인 + Local/Remote 확인 + 인터록 확인 + 피드백 검증**을 통과할 때만 전송됩니다.
- 통신 실패 시 명령을 자동 재전송하지 않으며, 결과가 불확정이면 `UNCERTAIN` 상태와 현장 확인 알람을 남깁니다.
- PLC/RTU는 인터넷에 직접 노출하지 말고 Edge Gateway를 통해 중앙 서버로만 연결하세요.
- 이 프로그램은 현장 보호계전·비상정지·기계적 안전장치를 대체하지 않습니다.
