# 제조사 · 프로토콜 호환성 검증표

확인일: 2026-11-22
원칙: **공개 문서 확인과 실제 통신 검증을 구분**합니다. 실장비 검증 증빙이 없는 항목은 절대 “실장비 검증”으로 표시하지 않습니다.

## 상태 정의

| 상태 | 의미 |
|---|---|
| 문서 확인 (DOC_VERIFIED) | 공식/공개 문서만 확인. 드라이버 미구현 또는 미검증 |
| 드라이버 개발 중 (IN_DEVELOPMENT) | 드라이버 구현 착수, 통신 검증 없음 |
| 시뮬레이터 검증 (SIMULATOR_VERIFIED) | 실제 TCP 소켓 시뮬레이터와 송수신 검증 완료. **실장비 미검증** |
| 실장비 검증 (FIELD_VERIFIED) | 현장 실장비와 통신 검증 완료(증빙 필요) |
| 부분 지원 (PARTIAL) | 일부 기능/전송 방식만 지원 |
| 미지원 (UNSUPPORTED) | 미지원 |

## 표준/제조사 프로토콜

| 프로토콜 | 전송 | 구분 | 구현 상태 | 검증 내용 | 공식 문서 | 라이선스 |
|---|---|---|---|---|---|---|
| Modbus TCP | TCP | STANDARD | **SIMULATOR_VERIFIED** | FC01/02/03/04/05/06/15/16 실제 TCP 소켓 송수신, 시뮬레이터 검증 완료. 실제 제조사 장비 검증은 미실시. | [MODBUS Application Protocol Specification V1.1b3 / MODBUS Me](https://www.modbus.org/specs.php) | 공개 명세(Modbus Organization), 구현 자유 |
| Modbus RTU | RTU | STANDARD | **PARTIAL** | CRC-16 프레임 생성/검증 및 RTU over TCP(통신변환기 경유) 시뮬레이터 검증 완료. 로컬 RS-485 시리얼 포트 직접 구동은 이 빌드에서 미지원(게이트웨이 시리얼 터널 필요). | [MODBUS over Serial Line Specification V1.02](https://www.modbus.org/specs.php) | 공개 명세(Modbus Organization), 구현 자유 |
| Modbus ASCII | ASCII | STANDARD | **SIMULATOR_VERIFIED** | LRC 프레임 생성/파싱 및 ASCII over TCP 소켓 시뮬레이터 검증 완료. 실제 장비 미검증. | [MODBUS over Serial Line Specification V1.02 (ASCII)](https://www.modbus.org/specs.php) | 공개 명세(Modbus Organization), 구현 자유 |
| Modbus RTU over TCP | RTU_OVER_TCP | DE_FACTO | **SIMULATOR_VERIFIED** | CRC 포함 RTU 프레임을 TCP로 전송하는 방식. 시뮬레이터 검증 완료. | [MODBUS Messaging Implementation Guide V1.0 (게이트웨이 구현 관행)](https://www.modbus.org/specs.php) | 공개 명세 기반 |
| Modbus Security (TLS) | TCP | STANDARD | **DOC_VERIFIED** | 문서만 확인. TLS 상호인증 드라이버는 미구현. | [MODBUS/TCP Security Protocol Specification](https://www.modbus.org/specs.php) | 공개 명세 |
| BACnet/IP | UDP | STANDARD | **DOC_VERIFIED** | 문서/표준 확인. BACnet 스택 미구현. | [ASHRAE 135 / BACnet Protocol Specification](https://www.bacnet.org/Specs/) | ASHRAE 표준 문서(유료), 공개 개요 자료 |
| BACnet MS/TP | SERIAL | STANDARD | **UNSUPPORTED** | 미지원. | [ASHRAE 135 Addendum (MS/TP)](https://www.bacnet.org/Specs/) | ASHRAE 표준 문서(유료) |
| BACnet/SC | TCP | STANDARD | **UNSUPPORTED** | 미지원. | [ASHRAE 135-2020 Annex AB (BACnet/SC)](https://www.bacnet.org/Specs/) | ASHRAE 표준 문서(유료) |
| OPC UA | TCP | STANDARD | **IN_DEVELOPMENT** | 노드 모델/보안 정책 조사 단계. 바이너리 스택 미통합. | [OPC 10000 series / OPC UA Reference](https://reference.opcfoundation.org/) | OPC Foundation 공개 레퍼런스 |
| OPC DA | DCOM | DE_FACTO | **UNSUPPORTED** | Windows DCOM 기반 레거시. 미지원. | [OPC DA 2.05a Specification](https://reference.opcfoundation.org/) | OPC Foundation |
| MQTT 3.1.1/5.0 | TCP | STANDARD | **IN_DEVELOPMENT** | 브로커 연동 설계만 완료. 실제 브로커 통신 미검증. | [MQTT Version 5.0 (OASIS Standard)](https://mqtt.org/mqtt-specification/) | OASIS 공개 표준 |
| Sparkplug B | TCP | STANDARD | **DOC_VERIFIED** | 문서 확인. MQTT 기반 페이로드 구현 미착수. | [Eclipse Sparkplug Specification V3.0](https://sparkplug.eclipse.org/specification/) | Eclipse Foundation (EPL-2.0) |
| SNMP v2c/v3 | UDP | STANDARD | **DOC_VERIFIED** | 문서 확인. 미구현. | [RFC 3411-3418 (SNMPv3)](https://www.rfc-editor.org/rfc/rfc3411) | IETF RFC (공개) |
| DLMS/COSEM (IEC 62056) | TCP | STANDARD | **DOC_VERIFIED** | 문서 확인. HDLC/TCP 래퍼 및 OBIS 모델 미구현. | [DLMS UA Green Book / Blue Book](https://www.dlms.com/) | DLMS UA (회원 문서 일부 제한) |
| M-Bus / Wireless M-Bus | SERIAL | STANDARD | **DOC_VERIFIED** | 문서 확인. 미구현. | [M-Bus Specification EN 13757](https://m-bus.com/documentation) | 공개 개요 문서 |
| IEC 61850 MMS | TCP | STANDARD | **DOC_VERIFIED** | 문서 확인. MMS 스택 미구현. | [IEC 61850-8-1](https://webstore.iec.ch/publication/5976) | IEC 표준(유료) |
| IEC 61850 GOOSE | ETHERNET | STANDARD | **UNSUPPORTED** | 미지원 (L2 이더넷 캡처 필요). | [IEC 61850-8-1 (GOOSE)](https://webstore.iec.ch/publication/5976) | IEC 표준(유료) |
| IEC 60870-5-104 | TCP | STANDARD | **DOC_VERIFIED** | 문서 확인. 미구현. | [IEC 60870-5-104](https://webstore.iec.ch/publication/3741) | IEC 표준(일부 공개) |
| IEC 60870-5-101 | SERIAL | STANDARD | **UNSUPPORTED** | 미지원. | [IEC 60870-5-101](https://webstore.iec.ch/publication/3734) | IEC 표준(유료) |
| DNP3 | TCP | STANDARD | **DOC_VERIFIED** | 문서 확인. 미구현. | [IEEE 1815-2012 DNP3](https://www.dnp.org/) | IEEE 표준 + DNP Users Group |
| KNX | UDP | STANDARD | **UNSUPPORTED** | 미지원. | [KNX Standard / KNXnet/IP](https://www.knx.org/knx-en/for-professionals/benefits/knx-standard/) | KNX Association |
| DALI-2 | SERIAL | STANDARD | **UNSUPPORTED** | 미지원. | [IEC 62386](https://www.dii.org/dali-2/) | DiiA / IEC |
| LonWorks | SERIAL | STANDARD | **UNSUPPORTED** | 미지원. | [ANSI/CEA-709.1](https://www.lonmark.org/) | LonMark |
| REST API | HTTP | DE_FACTO | **PARTIAL** | EUMBMS 자체 API는 실제 구현·검증됨. 제3자 REST 장치 수집 어댑터는 미구현. | [REST 아키텍처 스타일](https://restfulapi.net/) | 공개 |
| WebSocket | TCP | STANDARD | **PARTIAL** | 관제 실시간 스트림(SSE)은 구현. 장치 WebSocket 어댑터 미구현. | [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455) | IETF RFC |
| TCP Socket (Generic ASCII/Binary) | TCP | DE_FACTO | **SIMULATOR_VERIFIED** | 사용자 정의 프레임 편집기로 TCP 송수신·체크섬·파싱 검증 완료. | [RFC 793 TCP](https://www.rfc-editor.org/rfc/rfc793) | IETF RFC |
| UDP Socket | UDP | DE_FACTO | **DOC_VERIFIED** | 프레임 편집기는 UDP 전송을 아직 지원하지 않는다. | [RFC 768 UDP](https://www.rfc-editor.org/rfc/rfc768) | IETF RFC |
| Serial ASCII/Binary | SERIAL | DE_FACTO | **PARTIAL** | RS-485 직접 구동은 미지원이며, 시리얼-이더넷 변환기 경유 RTU/ASCII 통신을 지원한다. | [RS-232/RS-485 공개 구현 관행](https://www.rfc-editor.org/rfc/rfc854) | 공개 |
| Siemens S7 Communication | TCP | VENDOR | **DOC_VERIFIED** | 프로토콜 구조만 조사. 실제 드라이버 미개발. S7-1200/1500은 PUT/GET 활성화 및 보호 설정에 따라 접근이 제한된다. | [S7 protocol (S7-300/400/1200/1500) — 공식 개방 문서 없음, TPKT/COTP/](https://support.industry.siemens.com/) | 제조사 비공개(공개 분석 자료 존재) |
| Mitsubishi MC Protocol / SLMP | TCP | VENDOR | **DOC_VERIFIED** | 3E/4E 프레임 문서 확인. 드라이버 미개발. | [MELSEC Communication Protocol Reference Manual (공개)](https://www.mitsubishielectric.com/fa/) | 제조사 공개 매뉴얼 |
| LS ELECTRIC XGT FEnet | TCP | VENDOR | **DOC_VERIFIED** | XGB/XGK/XGI/XGR 공개 매뉴얼 확인. 드라이버 미개발. | [XGT FEnet 통신 매뉴얼 (공개)](https://www.ls-electric.com/) | 제조사 공개 매뉴얼 |
| Omron FINS/TCP, FINS/UDP | TCP | VENDOR | **DOC_VERIFIED** | 문서 확인. 드라이버 미개발. | [CS/CJ/CP Series FINS Command Reference (공개)](https://industrial.omron.eu/) | 제조사 공개 매뉴얼 |
| Rockwell EtherNet/IP (CIP) | TCP | STANDARD | **DOC_VERIFIED** | 문서 확인. CIP 스택 미구현. | [ODVA EtherNet/IP Specification / CIP](https://www.odva.org/technology-standards/key-technologies/ethernet-ip/) | ODVA (일부 공개) |
| Beckhoff ADS | TCP | VENDOR | **DOC_VERIFIED** | 문서 확인. 드라이버 미개발. | [TwinCAT ADS Communication (공개 Infosys)](https://infosys.beckhoff.com/) | 제조사 공개 문서 |
| Delta DVP/AS/AH (Modbus) | TCP | VENDOR | **SIMULATOR_VERIFIED** | 표준 Modbus TCP 드라이버로 통신 가능. Delta 실장비 검증은 미실시. | [Delta PLC Modbus Communication Manual](https://www.deltaww.com/) | 제조사 공개 매뉴얼 |
| ABB AC500 (Modbus/OPC UA) | TCP | VENDOR | **SIMULATOR_VERIFIED** | 표준 Modbus TCP 드라이버 사용. ABB 실장비 검증 미실시. | [ABB AC500 Modbus Communication](https://new.abb.com/plc) | 제조사 공개 매뉴얼 |
| WAGO PFC (Modbus/BACnet/OPC UA) | TCP | VENDOR | **SIMULATOR_VERIFIED** | 표준 Modbus TCP 드라이버 사용. WAGO 실장비 검증 미실시. | [WAGO 750-8xx Modbus/TCP Manual](https://www.wago.com/) | 제조사 공개 매뉴얼 |
| Schneider Modicon (Modbus) | TCP | VENDOR | **SIMULATOR_VERIFIED** | 표준 Modbus TCP 드라이버 사용. Schneider 실장비 검증 미실시. | [Modicon M340/BMX Modbus Communication Manual](https://www.se.com/ww/en/product-range/537-modicon-m340/) | 제조사 공개 매뉴얼 |

## 제조사 / 모델 카탈로그

| 제조사 | 국가 | 모델 | 구분 | 지원 프로토콜(후보) | 공식 사이트 |
|---|---|---|---|---|---|
| Schneider Electric (슈나이더 일렉트릭) | FR | Modicon M340 | PLC | modbus-tcp, modbus-rtu | [https://www.se.com/](https://www.se.com/) |
| Schneider Electric (슈나이더 일렉트릭) | FR | Modicon M580 | PLC | modbus-tcp, opcua | [https://www.se.com/](https://www.se.com/) |
| Schneider Electric (슈나이더 일렉트릭) | FR | PM8000 Power Meter | METER | modbus-tcp, modbus-rtu | [https://www.se.com/](https://www.se.com/) |
| Siemens (지멘스) | DE | S7-1200 | PLC | s7comm, modbus-tcp | [https://support.industry.siemens.com/](https://support.industry.siemens.com/) |
| Siemens (지멘스) | DE | S7-1500 | PLC | s7comm, opcua | [https://support.industry.siemens.com/](https://support.industry.siemens.com/) |
| Siemens (지멘스) | DE | SENTRON PAC3200 | METER | modbus-tcp | [https://support.industry.siemens.com/](https://support.industry.siemens.com/) |
| Mitsubishi Electric (미쓰비시전기) | JP | MELSEC iQ-R | PLC | mitsubishi-mc | [https://www.mitsubishielectric.com/fa/](https://www.mitsubishielectric.com/fa/) |
| Mitsubishi Electric (미쓰비시전기) | JP | MELSEC Q | PLC | mitsubishi-mc | [https://www.mitsubishielectric.com/fa/](https://www.mitsubishielectric.com/fa/) |
| LS ELECTRIC (LS일렉트릭) | KR | XGI-CPUU | PLC | ls-xgt-fenet, modbus-tcp | [https://www.ls-electric.com/](https://www.ls-electric.com/) |
| LS ELECTRIC (LS일렉트릭) | KR | XGB-XBC | PLC | ls-xgt-fenet, modbus-rtu | [https://www.ls-electric.com/](https://www.ls-electric.com/) |
| LS ELECTRIC (LS일렉트릭) | KR | Accura 2350 | METER | modbus-tcp, modbus-rtu | [https://www.ls-electric.com/](https://www.ls-electric.com/) |
| Omron (오므론) | JP | NX102 | PLC | omron-fins, ethernetip | [https://industrial.omron.eu/](https://industrial.omron.eu/) |
| Omron (오므론) | JP | CP1L | PLC | omron-fins, modbus-rtu | [https://industrial.omron.eu/](https://industrial.omron.eu/) |
| Rockwell Automation (록웰 오토메이션) | US | ControlLogix 5580 | PLC | rockwell-ethernetip | [https://www.rockwellautomation.com/](https://www.rockwellautomation.com/) |
| Rockwell Automation (록웰 오토메이션) | US | CompactLogix 5380 | PLC | rockwell-ethernetip | [https://www.rockwellautomation.com/](https://www.rockwellautomation.com/) |
| Beckhoff (벡호프) | DE | CX5140 | PLC | beckhoff-ads, modbus-tcp | [https://www.beckhoff.com/](https://www.beckhoff.com/) |
| Delta Electronics (델타전자) | TW | DVP-ES2 | PLC | delta-modbus | [https://www.deltaww.com/](https://www.deltaww.com/) |
| Delta Electronics (델타전자) | TW | AS228T | PLC | delta-modbus | [https://www.deltaww.com/](https://www.deltaww.com/) |
| ABB (ABB) | CH | AC500-eCo | PLC | abb-ac500, modbus-tcp | [https://new.abb.com/](https://new.abb.com/) |
| WAGO (바고) | DE | PFC200 | PLC | wago-pfc, modbus-tcp | [https://www.wago.com/](https://www.wago.com/) |
| Moxa (목사) | TW | NPort 5650 | GATEWAY | modbus-rtu-over-tcp, tcp-socket | [https://www.moxa.com/](https://www.moxa.com/) |
| EUM (자체) (이음) | KR | EUM Edge Gateway | GATEWAY | modbus-tcp, modbus-rtu-over-tcp, tcp-socket | [https://github.com/sangjindl9-lab/emuvmsv1](https://github.com/sangjindl9-lab/emuvmsv1) |

## 실장비 검증 현황

- 실장비 검증(FIELD_VERIFIED) 항목: **0건**
- 시뮬레이터 검증: Modbus TCP, Modbus ASCII, Modbus RTU over TCP, TCP 사용자 정의 프레임
- Delta / ABB / WAGO / Schneider 장비는 표준 Modbus TCP 드라이버로 통신 가능성이 있으나 **실장비 검증은 미실시**입니다.

## 해석 시 주의

1. “시뮬레이터 검증”은 프레임·소켓·응답 파싱이 실제로 동작함을 의미하며, 제조사 장비의 주소 맵·펌웨어 차이까지 검증한 것이 아닙니다.
2. 제조사별 주소/기능 코드는 매뉴얼 업로드(방식 ②) 또는 수동 태그 등록으로 확인해야 합니다.
3. 제조사 전용 프로토콜(S7, MC, XGT FEnet, FINS, EtherNet/IP, ADS 등)은 별도 드라이버 개발과 현장 검증이 필요합니다.
4. 라이선스가 제한된 표준 문서(IEC, ASHRAE 등)는 재배포하지 않으며, 링크와 구현 상태만 제공합니다.
