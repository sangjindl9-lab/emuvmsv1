# EUMBMS 아키텍처

## 1. 전체 구조

```
┌──────────────────────────── 중앙 서버 (Next.js / Node 24) ────────────────────────────┐
│  Web UI (React 19, 18 menus)                                                          │
│      │  fetch /api/v1/**  (세션 쿠키, HMAC 서명)                                        │
│  API Router (src/server/api.ts → routes/*)  ── RBAC ── Audit                          │
│      │                                                                                │
│  ┌───┴─────────────┐   ┌────────────────────┐   ┌───────────────────────────────┐    │
│  │ Protocol Center │   │ SCADA / Control    │   │ Metering / Energy / Alarms    │    │
│  │ Driver Registry │   │ Diagram / Assets   │   │ Tariff / Reports             │    │
│  └───┬─────────────┘   └─────────┬──────────┘   └──────────────┬────────────────┘    │
│      │                           │                             │                      │
│  PostgreSQL 18 (33 tables)  ← Prisma Client ── TagReading(시계열, Timescale 선택)     │
└───────────────────────────────────▲───────────────────────────────────────────────────┘
                                    │ HTTPS (게이트웨이 토큰)
┌───────────────────────────────────┴───────────────────────────────────────────────────┐
│ EUM EDGE GATEWAY (현장)                                                                │
│  Handshake → 장치/태그 설정 수신 → Modbus TCP/RTU-over-TCP/ASCII 수집                  │
│  중앙 단절 시 JSONL 로컬 버퍼 → 복구 후 순차 동기화 (ingest)                            │
└──────────────────────────────┬────────────────────────────────────────────────────────┘
                               │ RS-485 / Ethernet
                    PLC · RTU · 계량기 · 보호계전기 · UPS · 발전기
```

## 2. 계층

1. **표현 계층**: `src/app/(app)` 18개 메뉴 + `src/components` 공용 UI (반응형, 인쇄 스타일 포함).
2. **API 계층**: Next.js catch-all 라우트 `/api/v1/[...path]` → `src/server/api.ts`의 선언적 라우트 매칭.
   세션 검증, 권한 검사, 테넌트 격리, 감사 로그는 이 계층에서 수행한다.
3. **도메인 계층**:
   - `src/modules/protocol`: Modbus 프레임/클라이언트/시뮬레이터, 드라이버 레지스트리, 사용자 정의 프레임, 매뉴얼 추출·분석
   - `src/modules/telemetry`: 수집 사이클, 데이터 품질
   - `src/modules/alarms`: 규칙 평가, 중복 알람 합산·자동 복구
   - `src/modules/control`: 이중 승인·인터록·피드백 상태 머신
   - `src/modules/metering`: 요금 계산, 월별 사용량, 이상 탐지
4. **데이터 계층**: Prisma + PostgreSQL. 33개 테이블, 장치·태그·검침은 `tenant_id`/`site_id`로 격리.

## 3. 테넌트 격리

- 모든 업무 테이블에 `tenantId`가 있고, API 핸들러는 세션의 `tid`를 항상 WHERE 조건에 넣는다.
- 장치·태그·검침은 추가로 `siteId`를 가진다.
- 파일/문서(`protocol_documents`)도 테넌트 소유이며, 드라이버 키는 `(tenantId, key)` 유니크다.
- 게이트웨이는 발급 토큰의 SHA-256 해시만 저장하고, 요청 시 해시 비교로 게이트웨이/테넌트를 식별한다.

## 4. 프로토콜/드라이버 플러그인

```ts
interface DeviceDriver {
  testConnection(): Promise<ConnectionTestResult>;
  readTags(tags: TagSpec[]): Promise<TagValue[]>;
  writeTag(tag: TagSpec, value: number): Promise<void>;
  close(): void;
}
```

- `getDriver(endpoint)`가 `protocolKey`로 드라이버를 선택한다. 새 프로토콜은 이 인터페이스 구현을 등록하면 되고, 전체 프로그램을 수정하지 않는다.
- 내장 구현: Modbus TCP, Modbus RTU over TCP, Modbus ASCII over TCP (모두 실제 소켓).
- Modbus 기능: FC01/02/03/04/05/06/15/16, CRC-16, LRC, MBAP, 예외 응답, 타임아웃/재시도, 요청 직렬화, 폴링 간격.
- 데이터 형식: BOOL, INT16/UINT16, INT32/UINT32, FLOAT32/64, STRING, BITFIELD, ENUM, TIMESTAMP + 바이트/워드 순서(AB/BA, ABCD/CDAB/BADC/DCBA).
- 드라이버 버전은 `driver_versions`에 고정·검증·롤백 이력을 남긴다.

## 5. 프로토콜 자동등록 3방식

| 방식 | 흐름 | 저장 결과 |
|---|---|---|
| ① 기존 프로토콜 | 제조사→모델→프로토콜→통신정보→연결시험→태그 등록 | `device_profiles(source=CATALOG)` + `devices`/`device_tags` |
| ② 매뉴얼 업로드 | PDF/DOCX/XLSX/CSV/JSON/XML/TXT/ZIP → 텍스트·표 추출 → 제조사/모델/프로토콜 추정 → 레지스터·형식 추출 → 초안 | `protocol_documents` + `device_profiles(source=MANUAL_UPLOAD, PENDING_REVIEW)` → 관리자 승인 후 장치 생성 |
| ③ 사용자 정의 프레임 | Header/Length/FC/Address/Command/Payload/Checksum + 응답 파싱 정의 → 미리보기 → 실제 TCP 시험 → 버전관리 | `protocol_drivers` + `driver_versions` |

추출기 한계(스캔 PDF OCR 미지원, CID 폰트 한글 PDF, 암호화 파일)는 `docs/LIMITATIONS.md`에 명시했다.

## 6. 수집 경로

1. **서버 내장 수집기** (`POST /collector/run`, `ENABLE_COLLECTOR=1`): 검증·데모용. 요청 시 또는 서버 타이머로 `collectDevice` 실행.
2. **Edge Gateway** (운영 권장): `gateway/agent.ts`가 handshake로 장치/태그 설정을 받아 주기적으로 수집하고 `gateway/ingest`로 전송. 중앙 단절 시 JSONL 버퍼에 저장 후 복구 시 재전송.

수집 결과는 `device_tags.last_value`(현재값)와 `tag_readings`(시계열)에 저장되고, 알람 규칙이 즉시 평가된다. 품질은 `GOOD/UNCERTAIN/BAD/STALE`로 구분하며, 3회 폴링 주기 이상 갱신이 없으면 화면에서 `STALE`로 표시한다.

## 7. 원격제어 상태 머신

```
REQUESTED ──(승인 2명, 요청자 제외)──▶ APPROVED ──(실행)──▶ SENDING
   │                                        │                   │
   ├─ 거부 ─▶ REJECTED                       ├─ 만료 ─▶ EXPIRED  ├─ 피드백 일치 ─▶ FEEDBACK_OK
   └─ 취소 ─▶ CANCELED                       └─ 인터록/상태 불충족 ─▶ REJECTED
                                                                  └─ 피드백 미확인 ─▶ UNCERTAIN
```

- 실행 전 재검증: 설비 트립 여부, Local/Remote, 인터록 태그, 제어 태그 매핑, 승인 유효시간(30분).
- `idempotencyKey` 유니크로 중복 요청을 차단하고, 이미 전송 단계에 들어간 명령은 재실행하지 않는다.
- 결과가 불확정이면 자동 재전송하지 않고 `MAJOR` 알람을 남긴다.
- 모든 단계는 `audit_logs`에 기록된다.

## 8. 알람

- 규칙: GT/LT/EQ/NE/OUT_OF_RANGE/COMM_FAIL (RATE_OF_CHANGE는 스키마만 지원).
- 동일 규칙·대상에 활성 알람이 있으면 `repeatCount`를 증가시키고, 정상 복귀 시 자동 `RESOLVED`.
- 등급: INFO/WARNING/MAJOR/CRITICAL. 담당자 배정·조치 결과를 기록.
- 통보 채널은 스키마(`channels`)에 정의되어 있으나 이 빌드에서는 인앱 알람만 실제 동작한다(이메일/문자/푸시 게이트웨이 미연동).

## 9. 검침·요금

- 계층: 고객사 → 사업장 → 건물 → 동 → 층 → 호실 → 계량기.
- 원본 `meter_readings`와 보정 `meter_adjustments`(CORRECTION/ROLLOVER/REPLACEMENT/ESTIMATE)를 분리.
- 누적값 감소 시 롤오버 보정을 자동 기록.
- 요금표 `tariff_versions.config`: 기본요금/수요요금/누진구간/TOU/부가세/기후환경/연료비/역률 페널티/탄소계수.
- 탄소배출량은 기본 0.4781 kgCO₂e/kWh로 계산하는 **추정치**다.

## 10. 보안

- 비밀번호: scrypt + salt, 세션: HMAC-SHA256 서명 쿠키(HttpOnly, SameSite=Lax, 8시간).
- 권한: 역할 기반 16개 권한. 제어 요청/승인 분리, 요청자 본인 승인 금지.
- 게이트웨이 토큰은 발급 시 1회만 표시하고 DB에는 해시만 저장.
- 사용자 정의 프레임의 변환식은 `eval` 없이 제한된 수식 평가기에서 수행.
- 감사 로그에 행위자·대상·변경 전후·IP·UA 기록.
- 운영 시 HTTPS 종료(리버스 프록시)와 `secure` 쿠키가 적용된다(`NODE_ENV=production`).

## 11. 확장 지점

- 새 드라이버: `DeviceDriver` 구현 + `getDriver` 매핑 등록.
- 새 알람 조건: `isTriggered` 확장.
- 새 요금 모델: `TariffConfig` 확장 + `calculateBill`.
- TimescaleDB: `scripts/timescale-setup.sql`(선택, 수동 적용).
