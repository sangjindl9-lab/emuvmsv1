"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { ResourceManager } from "@/components/ResourceManager";
import { Alert, Badge } from "@/components/ui";

const PROTOCOL_OPTIONS = [
  { value: "modbus-tcp", label: "Modbus TCP" },
  { value: "modbus-rtu-over-tcp", label: "Modbus RTU over TCP (변환기)" },
  { value: "modbus-rtu", label: "Modbus RTU (시리얼)" },
  { value: "modbus-ascii", label: "Modbus ASCII" },
  { value: "s7comm", label: "Siemens S7 (문서 확인)" },
  { value: "mitsubishi-mc", label: "Mitsubishi MC/SLMP (문서 확인)" },
  { value: "ls-xgt-fenet", label: "LS ELECTRIC XGT FEnet (문서 확인)" },
  { value: "omron-fins", label: "Omron FINS (문서 확인)" },
  { value: "rockwell-ethernetip", label: "Rockwell EtherNet/IP (문서 확인)" },
  { value: "bacnet-ip", label: "BACnet/IP (문서 확인)" },
  { value: "opcua", label: "OPC UA (개발 중)" },
];

export default function DevicesPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const action = async (path: string, label: string) => {
    setMessage(null);
    setError(null);
    try {
      const result = await api<Record<string, unknown>>(path, { method: "POST" });
      setMessage(`${label}: ${JSON.stringify(result).slice(0, 400)}`);
    } catch (err) {
      setError(`${label} 실패: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-extrabold tracking-wide">PLC / RTU 관리</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">제조사·모델·프로토콜·통신 파라미터를 등록하고 실제 연결 시험과 데이터 수집을 실행합니다.</p>
      </div>
      {message ? <Alert kind="success">{message}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}
      <ResourceManager
        title="장치 목록"
        endpoint="devices"
        createLabel="장치 등록"
        exportPath="devices/export"
        searchPlaceholder="장치명·제조사·프로토콜 검색"
        columns={[
          { key: "name", label: "장치명" },
          { key: "deviceType", label: "구분", render: (row) => <Badge value="UNKNOWN" label={String(row.deviceType)} /> },
          { key: "protocolKey", label: "프로토콜", render: (row) => <span className="font-mono text-[11px]">{String(row.protocolKey)}</span> },
          { key: "endpoint", label: "통신", render: (row) => `${row.host ?? "-"}:${row.port ?? "-"} / ID ${row.slaveId ?? "-"}` },
          { key: "tags", label: "태그", render: (row) => String((row._count as { tags?: number })?.tags ?? 0) },
          { key: "quality", label: "품질", render: (row) => <Badge value={String(row.quality)} /> },
          { key: "site", label: "사업장", render: (row) => String((row.site as { name?: string })?.name ?? "-") },
          { key: "actions", label: "통신", render: (row) => (
            <div className="flex gap-2">
              <button className="text-[11px] text-[var(--eum-accent)] hover:underline" onClick={() => void action(`devices/${String(row.id)}/test`, "연결 시험")}>시험</button>
              <button className="text-[11px] text-[#7fd6ef] hover:underline" onClick={() => void action(`devices/${String(row.id)}/read`, "즉시 수집")}>수집</button>
            </div>
          )},
        ]}
        fields={[
          { key: "siteId", label: "사업장", type: "select", required: true, optionsFrom: { endpoint: "sites", valueKey: "id", labelKey: "name" } },
          { key: "name", label: "장치명", required: true, placeholder: "101동 지하 변전실 PLC" },
          { key: "deviceType", label: "구분", type: "select", options: [
            { value: "PLC", label: "PLC" },
            { value: "RTU", label: "RTU" },
            { value: "METER", label: "전력량계" },
            { value: "PROTECTION_RELAY", label: "보호계전기" },
            { value: "UPS", label: "UPS" },
            { value: "GENERATOR", label: "발전기" },
            { value: "INVERTER", label: "태양광 인버터" },
            { value: "ESS", label: "ESS" },
            { value: "EV_CHARGER", label: "EV 충전기" },
          ], defaultValue: "PLC" },
          { key: "protocolKey", label: "프로토콜", type: "select", required: true, options: PROTOCOL_OPTIONS, defaultValue: "modbus-tcp" },
          { key: "manufacturerId", label: "제조사", type: "select", optionsFrom: { endpoint: "manufacturers", valueKey: "id", labelKey: "name" } },
          { key: "gatewayId", label: "게이트웨이/변환기", type: "select", optionsFrom: { endpoint: "gateways", valueKey: "id", labelKey: "name" } },
          { key: "host", label: "IP / 호스트", placeholder: "192.168.0.10" },
          { key: "port", label: "포트", type: "number", defaultValue: 502 },
          { key: "slaveId", label: "Slave ID / 국번", type: "number", defaultValue: 1 },
          { key: "pollingMs", label: "폴링 주기(ms)", type: "number", defaultValue: 1000 },
          { key: "timeoutMs", label: "타임아웃(ms)", type: "number", defaultValue: 1000 },
          { key: "retryCount", label: "재시도", type: "number", defaultValue: 2 },
          { key: "serialNumber", label: "시리얼번호" },
          { key: "firmware", label: "펌웨어" },
          { key: "description", label: "설명", type: "textarea" },
          { key: "applyTemplate", label: "표준 태그 템플릿 자동 생성", type: "checkbox", defaultValue: true, help: "전압·전류·전력·역률·주파수·전력량 등 15개 표준 태그를 생성합니다. 주소는 임시값이므로 장비 매뉴얼에 맞게 수정하세요." },
        ]}
        deleteEndpoint={(row) => `devices/${String(row.id)}`}
      />
    </div>
  );
}
