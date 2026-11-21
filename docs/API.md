# EUMBMS API 문서

- Base URL: `https://<host>/api/v1`
- 인증: 로그인 후 발급되는 `eumbms_session` HttpOnly 쿠키 (HMAC-SHA256 서명, 8시간)
- 게이트웨이 API(`gateway/*`)는 `x-gateway-token: eum_...` 헤더로 인증
- 응답: JSON. 실패 시 `{ "error": "메시지", "status": 400|401|403|404|409|422|500 }`
- 모든 업무 데이터는 로그인 사용자의 `tenant_id`로 격리됩니다.

## 공통

| Method | Path | 설명 |
|---|---|---|
| GET | `/health` | 서비스/DB 상태 |
| POST | `/auth/login` | `{email,password}` 로그인, 세션 쿠키 설정 |
| POST | `/auth/logout` | 로그아웃 |
| GET | `/auth/me` | 내 정보·테넌트·권한 |
| POST | `/auth/change-password` | `{currentPassword,newPassword}` |
| GET | `/audit-logs?limit=100` | 감사로그 (`audit.view`) |

### 로그인 예시

```bash
curl -c cookie.txt -X POST https://bms.example.com/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@eumbms.local","password":"Eumbms!2026"}'
```

## 대시보드·관제

| Method | Path | 설명 |
|---|---|---|
| GET | `/dashboard` | 사업장/장치/태그/알람/전력 태그/게이트웨이 요약 |
| GET | `/live?siteId=&standardKeys=ACTIVE_POWER,VOLTAGE_L1_N` | 태그 현재값·품질(STALE 포함) |
| GET | `/trends?tagIds=a,b&hours=24` | 시계열 조회 |
| GET | `/stream` | SSE 실시간 스트림(3초 주기, 최대 2분) |
| GET | `/collector/status` | 수집 엔진 상태 |
| POST | `/collector/run?siteId=` | 서버 내장 수집 1회 실행 (`device.manage`) |

## 사업장·건물·세대

| Method | Path | 설명 |
|---|---|---|
| GET/POST | `/sites` | 사업장 목록/등록 |
| PATCH | `/sites/:id` | 사업장 수정 |
| GET/POST | `/buildings` | 건물 목록/등록 (`?siteId=`) |
| GET/POST | `/floors` | 층 목록/등록 (`?buildingId=`) |
| GET/POST | `/units` | 세대 목록/등록 (`?buildingId=&q=`) |
| PATCH | `/units/:id` | 입주 상태·거주자명 수정 |

## 사용자·설정·라이선스

| Method | Path | 설명 |
|---|---|---|
| GET/POST | `/users` | 사용자 목록/추가 (`user.manage`) |
| PATCH | `/users/:id` | 이름·연락처·역할·상태·비밀번호 변경 |
| GET/PATCH | `/settings` | 테넌트 정보·카운트·라이선스·수집 설정 |
| GET/POST | `/licenses` | 라이선스 목록/발급 (`license.manage`) |
| POST | `/licenses/:id/revoke` | 라이선스 폐기 |

## 장치·통신변환기·태그

| Method | Path | 설명 |
|---|---|---|
| GET/POST | `/gateways` | 게이트웨이/통신변환기 목록/등록. 등록 응답의 `enrollToken`은 1회만 표시 |
| PATCH | `/gateways/:id` | 이름·IP·모드·상태 수정 |
| GET/POST | `/serial-buses` | RS-485 공유 버스 목록/등록 |
| GET/POST | `/devices` | 장치 목록/등록 (`?siteId=&q=`) |
| GET/PATCH/DELETE | `/devices/:id` | 상세/수정/비활성화 |
| POST | `/devices/:id/test` | 실제 연결 시험 + 샘플 태그 읽기 |
| POST | `/devices/:id/read` | 즉시 1회 수집 |
| POST | `/devices/:id/clone` | 장치 설정·태그 복제 |
| GET | `/devices/export` | 장치 CSV |
| POST | `/devices/import` | `{csv}` 대량 등록 |
| GET | `/device-connections?deviceId=` | 연결 이력 |
| GET/POST | `/tags` | 태그 목록/등록 (`?deviceId=&siteId=&q=`) |
| GET/PATCH/DELETE | `/tags/:id` | 상세/수정/비활성화 |
| GET | `/tags/templates` | 표준 태그 템플릿 |
| GET | `/tags/export` · POST `/tags/import` | CSV 대량 |
| GET/POST | `/alarm-rules` · PATCH `/alarm-rules/:id` | 알람 규칙 |
| GET | `/alarm-events` · POST `/alarm-events/:id/ack` · `/resolve` | 알람 이벤트/조치 |
| GET | `/alarms/summary` | 30일 알람 요약 |

### 장치 등록 예시

```json
POST /devices
{
  "siteId": "site_...",
  "name": "101동 지하 변전실 PLC",
  "deviceType": "PLC",
  "protocolKey": "modbus-tcp",
  "host": "192.168.10.21",
  "port": 502,
  "slaveId": 1,
  "pollingMs": 1000,
  "timeoutMs": 1500,
  "retryCount": 2,
  "applyTemplate": true
}
```

### 태그 등록 예시

```json
POST /tags
{
  "deviceId": "dev_...",
  "key": "VOLTAGE_L1",
  "name": "수전 전압 L1",
  "address": 0,
  "functionCode": 3,
  "dataType": "FLOAT32",
  "unit": "V",
  "scale": 1,
  "offset": 0,
  "byteOrder": "AB",
  "wordOrder": "ABCD",
  "alarmHigh": 250,
  "alarmLow": 190
}
```

## 프로토콜 센터

| Method | Path | 설명 |
|---|---|---|
| GET | `/protocols/catalog` | 프로토콜 카탈로그 + 등록 드라이버 |
| GET | `/manufacturers` | 제조사·모델 |
| GET/POST | `/protocols/drivers` | 커스텀 드라이버 목록/등록 |
| POST | `/protocols/drivers/:id/versions` | 새 버전 등록 |
| POST | `/protocols/drivers/:id/rollback` | `{versionId}` 롤백 |
| POST | `/protocols/test-connection` | 저장 없이 Modbus 연결 시험 |
| POST | `/protocols/profiles/from-catalog` | 방식 ① 프로파일 생성 |
| GET | `/protocols/documents` | 업로드 문서 목록 |
| POST | `/protocols/documents/upload` | 방식 ② multipart `file` 업로드·분석 |
| GET | `/protocols/profiles` | 프로파일 목록 (`?reviewStatus=`) |
| GET/PATCH | `/protocols/profiles/:id` | 프로파일 상세/수정 |
| POST | `/protocols/profiles/:id/review` | `{approve:true|false, note}` 승인/반려 |
| POST | `/protocols/profiles/:id/instantiate` | 승인 프로파일 → 장치·태그 생성 |
| GET | `/protocols/frame/default` | 기본 프레임 템플릿 |
| POST | `/protocols/frame/preview` | 요청 HEX 미리보기 |
| POST | `/protocols/frame/test` | 방식 ③ 실제 TCP 송수신 시험 |
| GET | `/protocols/compatibility` | 호환성 검증표 |

### 매뉴얼 업로드 예시

```bash
curl -b cookie.txt -X POST https://bms.example.com/api/v1/protocols/documents/upload \
  -F 'file=@Modicon_M340_Modbus_Map.csv'
```

```json
{
  "document": { "id": "doc_...", "docType": "CSV", "status": "DRAFTED" },
  "profile": { "id": "pro_...", "reviewStatus": "PENDING_REVIEW", "confidence": 0.83 },
  "analysis": {
    "manufacturerGuess": "Schneider Electric",
    "protocolGuess": "modbus-tcp",
    "driverType": "STANDARD_DRIVER",
    "registers": [{ "name": "Voltage", "address": 0, "functionCode": 3, "dataType": "FLOAT32", "unit": "V" }],
    "warnings": ["자동 분석 결과는 초안입니다. 승인 전에는 실제 수집에 사용되지 않습니다."]
  }
}
```

## 단선결선도·설비

| Method | Path | 설명 |
|---|---|---|
| GET/POST | `/assets` | 전력설비 자산 목록/등록 |
| PATCH | `/assets/:id` | 상태·원격허용·인터록·태그 매핑 수정 |
| GET/POST | `/diagrams` | 도면 목록/생성 |
| GET/PATCH | `/diagrams/:id` | 도면 상세(요소 포함)/수정 |
| PUT | `/diagrams/:id/elements` | 요소 전체 저장 `{elements:[...]}` |
| POST | `/diagrams/:id/duplicate` | 도면 복제 |

## 원격제어

| Method | Path | 설명 |
|---|---|---|
| GET | `/control/assets` | 제어 가능 여부 포함 설비 목록 |
| GET/POST | `/control/commands` | 명령 목록/요청 (`control.request`) |
| GET | `/control/commands/:id` | 승인·피드백 포함 상세 |
| POST | `/control/commands/:id/approve` | `{decision, comment}` (`control.approve`, 요청자 본인 불가) |
| POST | `/control/commands/:id/execute` | 승인 완료 후 실행·피드백 검증 |
| POST | `/control/commands/:id/cancel` | 전송 전 취소 |

### 제어 요청/승인/실행 예시

```bash
curl -b operator.txt -X POST .../control/commands -H 'content-type: application/json' \
 -d '{"assetId":"asset_...","command":"OPEN","reason":"정기점검","idempotencyKey":"open-2026-11-22-01"}'

curl -b approver.txt -X POST .../control/commands/<id>/approve \
 -H 'content-type: application/json' -d '{"decision":"APPROVED","comment":"1차 승인"}'

curl -b approver.txt -X POST .../control/commands/<id>/execute
# → {"status":"FEEDBACK_OK","finalState":"OPEN",...} 또는 UNCERTAIN
```

## 원격검침·요금·에너지

| Method | Path | 설명 |
|---|---|---|
| GET/POST | `/meter-readings` | 검침 목록/수동 등록 |
| POST | `/meter-readings/import` | `{csv}` 검침 대량 등록 |
| POST | `/meter-readings/collect` | `{deviceId}` 계량기 누적값 즉시 검침 |
| GET | `/meter-readings/missing?period=YYYY-MM` | 누락 세대 |
| POST | `/meter-adjustments` | `{kind, deltaValue, reason}` 보정 |
| GET/POST | `/tariffs` | 요금표 목록/등록(버전 자동 증가) |
| POST | `/tariffs/:id/activate` | 요금표 적용(기존 ACTIVE는 RETIRED) |
| POST | `/billing/calculate` | `{usageKwh, peakKw, contractPowerKw, powerFactor, tariffId}` 요금 추정 |
| GET | `/energy/analysis?months=12&siteId=` | 월별 사용량·전년비·이상치·탄소 |
| POST | `/reports/export` | `{type: metering|energy|alarms|control, format: csv|json, period}` |

## 게이트웨이 (현장 에이전트)

| Method | Path | 인증 |
|---|---|---|
| POST | `/gateway/handshake` | `x-gateway-token` — 장치/태그 설정 수신, 온라인 표시 |
| POST | `/gateway/heartbeat` | `{bufferDepth, firmware}` |
| POST | `/gateway/ingest` | `{readings:[{deviceId,tagId,value,quality,ts}]}` 최대 500건 권장 |

## 오류 코드

| 코드 | 의미 |
|---|---|
| 400 | 필수 값 누락·형식 오류 |
| 401 | 로그인/토큰 필요 |
| 403 | 권한 부족 |
| 404 | 대상 없음 |
| 409 | 상태 충돌(중복·승인 미완료·인터록·Local 상태) |
| 422 | 문서 추출 실패 |
| 500 | 서버 오류(로그 확인) |

## 총 API 수

110개 엔드포인트(메서드+경로 기준)가 구현되어 있습니다.
