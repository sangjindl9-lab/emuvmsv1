"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { ResourceManager } from "@/components/ResourceManager";
import { Alert, Badge, Button, Card } from "@/components/ui";

const DATA_TYPES = ["BOOL", "INT16", "UINT16", "INT32", "UINT32", "FLOAT32", "FLOAT64", "STRING", "BITFIELD", "ENUM"];
const STANDARD_KEYS = [
  "VOLTAGE_L1_N", "VOLTAGE_L2_N", "VOLTAGE_L3_N", "CURRENT_L1", "CURRENT_L2", "CURRENT_L3",
  "ACTIVE_POWER", "REACTIVE_POWER", "APPARENT_POWER", "POWER_FACTOR", "FREQUENCY",
  "ENERGY_IMPORT", "DEMAND_MAX", "BREAKER_STATE", "TEMPERATURE",
];

export default function TagsPage() {
  const [csv, setCsv] = useState("deviceName,key,name,address,functionCode,dataType,unit,scale,alarmHigh,alarmLow\n");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importCsv = async () => {
    setResult(null);
    setError(null);
    try {
      const response = await api<{ created: number; errors: { row: number; error: string }[] }>("tags/import", { method: "POST", body: { csv } });
      setResult(`등록 ${response.created}건, 오류 ${response.errors.length}건 ${response.errors.slice(0, 3).map((e) => `(행 ${e.row}: ${e.error})`).join(" ")}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-extrabold tracking-wide">태그·레지스터 관리</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">주소·펑션코드·데이터형식·배율·바이트 순서를 정의합니다. 데이터 품질은 Good / Uncertain / Bad / Stale로 구분됩니다.</p>
      </div>
      <ResourceManager
        title="태그 / 레지스터"
        endpoint="tags"
        createLabel="태그 등록"
        exportPath="tags/export"
        searchPlaceholder="태그명·키 검색"
        columns={[
          { key: "device", label: "장치", render: (row) => String((row.device as { name?: string })?.name ?? "-") },
          { key: "name", label: "태그명" },
          { key: "key", label: "키", render: (row) => <span className="font-mono text-[10.5px]">{String(row.key)}</span> },
          { key: "address", label: "주소", render: (row) => <span className="font-mono">{Number(row.address).toLocaleString()}</span> },
          { key: "fc", label: "FC", render: (row) => `FC${String(row.functionCode).padStart(2, "0")}` },
          { key: "dataType", label: "형식" },
          { key: "lastValue", label: "현재값", render: (row) => `${row.lastValue ?? "-"} ${row.unit ?? ""}` },
          { key: "quality", label: "품질", render: (row) => <Badge value={String(row.quality)} /> },
        ]}
        fields={[
          { key: "deviceId", label: "장치", type: "select", required: true, optionsFrom: { endpoint: "devices", valueKey: "id", labelKey: "name" } },
          { key: "key", label: "Tag ID(키)", required: true, placeholder: "VOLTAGE_L1" },
          { key: "name", label: "태그명", required: true, placeholder: "수전 전압 L1" },
          { key: "address", label: "주소(0-base)", type: "number", required: true, defaultValue: 0 },
          { key: "functionCode", label: "펑션코드", type: "select", options: [
            { value: "1", label: "FC01 코일" },
            { value: "2", label: "FC02 접점" },
            { value: "3", label: "FC03 Holding" },
            { value: "4", label: "FC04 Input" },
          ], defaultValue: "3" },
          { key: "dataType", label: "데이터 형식", type: "select", options: DATA_TYPES.map((t) => ({ value: t, label: t })), defaultValue: "FLOAT32" },
          { key: "unit", label: "단위", placeholder: "V, A, kW, kWh" },
          { key: "scale", label: "배율(Scale)", type: "number", defaultValue: 1 },
          { key: "offset", label: "오프셋", type: "number", defaultValue: 0 },
          { key: "byteOrder", label: "바이트 순서", type: "select", options: [{ value: "AB", label: "AB (Big)" }, { value: "BA", label: "BA (Little)" }], defaultValue: "AB" },
          { key: "wordOrder", label: "워드 순서", type: "select", options: ["ABCD", "CDAB", "BADC", "DCBA"].map((w) => ({ value: w, label: w })), defaultValue: "ABCD" },
          { key: "standardKey", label: "표준 태그", type: "select", options: STANDARD_KEYS.map((k) => ({ value: k, label: k })) },
          { key: "pollingMs", label: "폴링(ms)", type: "number", defaultValue: 1000 },
          { key: "alarmHigh", label: "상한 알람", type: "number" },
          { key: "alarmLow", label: "하한 알람", type: "number" },
          { key: "writable", label: "쓰기 허용", type: "checkbox", defaultValue: false },
          { key: "description", label: "설명", type: "textarea" },
        ]}
        deleteEndpoint={(row) => `tags/${String(row.id)}`}
      />
      <Card title="CSV 대량 등록">
        <div className="space-y-2">
          <p className="text-[11px] text-[var(--eum-muted)]">헤더: deviceName, key, name, address, functionCode, dataType, unit, scale, byteOrder, wordOrder, pollingMs, writable, alarmHigh, alarmLow, standardKey</p>
          <textarea className="eum-input min-h-[120px] font-mono text-[11px]" value={csv} onChange={(event) => setCsv(event.target.value)} />
          {result ? <Alert kind="success">{result}</Alert> : null}
          {error ? <Alert kind="error">{error}</Alert> : null}
          <Button variant="primary" onClick={() => void importCsv()}>CSV 등록 실행</Button>
        </div>
      </Card>
    </div>
  );
}
