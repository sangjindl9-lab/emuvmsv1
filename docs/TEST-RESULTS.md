# 검증 결과 (EUMBMS 2.0.0)

검증 일시: 2026-11-22 (Asia/Seoul)
환경: Linux, Node.js 24.22.3, PostgreSQL 18.6, Next.js 16.4.6 (프로덕션 `next start`)
DB: `eumbms_test` (마이그레이션 + 시드 적용)

## 1. 결과 요약

| 항목 | 결과 |
|---|---|
| TypeScript 타입체크 (`tsc --noEmit`) | **통과** (0 errors) |
| 단위·소켓 테스트 (Vitest) | **34 / 34 통과** (3 files) |
| 프로덕션 빌드 (`next build`) | **성공** (21 routes) |
| HTTP 통합 스모크 (실제 `next start` + PostgreSQL) | **28 / 28 통과** |
| Modbus TCP 실소켓 통신 | 통과 (수집값 220.6V, 품질 GOOD) |
| Modbus RTU over TCP 실소켓 | 통과 |
| Modbus ASCII over TCP 실소켓 | 통과 |
| 사용자 정의 프레임 실 TCP | 통과 (응답 `AA 55 01 03 00 2A 00 00` → 42) |
| 원격제어 전체 흐름 | 통과 (REQUESTED → 승인 2 → FEEDBACK_OK → 최종 OPEN → CLOSE 복구) |
| 매뉴얼 업로드 → 초안 → 승인 → 장치 생성 | 통과 (레지스터 3개 자동 추출) |
| 게이트웨이 handshake / ingest / 잘못된 토큰 차단 | 통과 |
| RBAC (조회자 등록 차단) | 통과 (403) |
| CSV 보고서 | 통과 (검침 12행) |
| 감사로그 기록 | 통과 |

## 2. 재현 방법

```bash
npm ci
sh scripts/db-up.sh                 # 로컬 검증용 PostgreSQL (55432)
npm run typecheck
npm run test
npm run build
sh scripts/test-all.sh              # 위 전체 + next start + 시뮬레이터 + HTTP 스모크
```

전체 실행 로그: [`docs/test-run.log`](test-run.log)

## 3. 단위·소켓 테스트 상세

`tests/protocol.test.ts`
- CRC-16/MODBUS 표준 벡터 (`01 03 00 00 00 0A` → `C5 CD`) 및 손상 검출
- LRC / ASCII 프레임 왕복
- MBAP/PDU 생성·파싱, FC03/05/06/16
- 예외 응답(ILLEGAL_DATA_ADDRESS) 감지
- FLOAT32/INT32/INT16 변환, 워드 순서(CDAB 등)
- 수식 평가기 sandbox(허용 연산/함수, 임의 코드 거부)
- 사용자 정의 프레임 생성/파싱/헤더 검증
- 누진·TOU·역률 요금 계산, 월별 사용량, 이상치
- 알람 조건 평가
- CSV/DOCX/XLSX/ZIP 추출, 주소 정규화(40001→0), 매뉴얼 분석

`tests/modbus-socket.test.ts`
- 실제 TCP 서버(ModbusSimulator)와 FC01/03/04 읽기, FC05/06 쓰기
- RTU over TCP (CRC 포함 프레임)
- ASCII over TCP (LRC)
- 응답 없는 포트 타임아웃
- 손상된 LRC 거부

`tests/schema.test.ts`
- 필수 **33개 테이블** 존재 확인
- 시드 테넌트/장치/태그/자산/요금표/라이선스 확인
- 장치·태그의 `tenant_id`/`site_id` 필수 확인

## 4. HTTP 스모크 테스트 상세 (28개)

| # | 항목 | 결과 |
|---|---|---|
| 1 | health endpoint | PASS |
| 2 | 로그인(운전원) | PASS |
| 3 | 로그인(최고관리자) | PASS |
| 4 | 대시보드 조회 | PASS (장치 2대, 태그 10개) |
| 5 | 실시간 계측 | PASS |
| 6 | 내장 수집기 → 실제 Modbus TCP | PASS (2/2 장치, 정상 10태그) |
| 7 | 수집값 220.6V 저장 | PASS |
| 8 | 에너지 분석 | PASS (7개월, 19,152kWh) |
| 9 | 매뉴얼 업로드 분석 | PASS (레지스터 3개) |
| 10 | 프로파일 승인 | PASS |
| 11 | 승인 프로파일 → 장치/태그 | PASS (태그 3개) |
| 12 | 사용자 정의 프레임 TCP | PASS (값 42) |
| 13 | 제어 준비 설비 조회 | PASS (수전 VCB-1) |
| 14 | 제어 요청 | PASS (REQUESTED) |
| 15 | 요청자 본인 승인 차단 | PASS |
| 16 | 1차 승인 | PASS |
| 17 | 2차 승인 → APPROVED | PASS |
| 18 | 실행 → FEEDBACK_OK | PASS |
| 19 | 중복 실행 차단 | PASS (409) |
| 20 | 차단기 상태 OPEN 반영 | PASS |
| 21 | CLOSE 복구 피드백 | PASS |
| 22 | 게이트웨이 등록·토큰 | PASS |
| 23 | 게이트웨이 handshake | PASS (장치 3대) |
| 24 | ingest 저장 | PASS |
| 25 | 잘못된 토큰 차단 | PASS (401) |
| 26 | 조회자 사업장 등록 차단 | PASS (403) |
| 27 | 검침 CSV 보고서 | PASS (12행) |
| 28 | 제어 감사로그 | PASS |

## 5. 실장비 검증 현황

**실장비 통신 검증(FIELD_VERIFIED)은 0건입니다.**
모든 Modbus 검증은 실제 TCP 소켓 기반 시뮬레이터에서 수행되었으며, 실제 제조사 장비·펌웨어·주소 맵과의 검증은 포함되지 않았습니다.
상세는 [`docs/COMPATIBILITY.md`](COMPATIBILITY.md), 제한은 [`docs/LIMITATIONS.md`](LIMITATIONS.md)를 참조하세요.

## 6. 성능

이번 검증은 기능·통신 정확성 중심이며 **부하시험은 수행하지 않았습니다.**
마스터 프롬프트의 성능 수치(게이트웨이당 100대, 사업장당 10,000태그, 중앙 100,000태그)는 설계 목표입니다.
