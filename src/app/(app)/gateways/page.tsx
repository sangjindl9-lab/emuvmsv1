"use client";

import { useState } from "react";
import { api, formatDate, useApi } from "@/lib/client";
import { ResourceManager } from "@/components/ResourceManager";
import { Alert, Badge, Button, Card, Empty, Field, Spinner } from "@/components/ui";

type Gateway = {
  id: string;
  name: string;
  serial: string;
  kind: string;
  mode: string;
  host: string | null;
  port: number | null;
  convertsProtocol: boolean;
  status: string;
  lastSeenAt: string | null;
  bufferDepth: number;
  site: { name: string };
  _count: { devices: number; serialBuses: number };
};

export default function GatewaysPage() {
  const { data, error, loading, reload } = useApi<{ items: Gateway[] }>("gateways");
  const sites = useApi<{ items: { id: string; name: string }[] }>("sites");
  const [token, setToken] = useState<{ name: string; token: string } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ kind: "EDGE", mode: "TCP_CLIENT" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const result = await api<{ gateway: Gateway; enrollToken: string }>("gateways", {
        method: "POST",
        body: {
          siteId: form.siteId,
          name: form.name,
          kind: form.kind,
          mode: form.mode,
          host: form.host || null,
          port: form.port ? Number(form.port) : null,
          convertsProtocol: form.convertsProtocol === "true",
        },
      });
      setToken({ name: result.gateway.name, token: result.enrollToken });
      setForm({ kind: "EDGE", mode: "TCP_CLIENT" });
      await reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-extrabold tracking-wide">통신변환기 관리</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">RS-232/422/485 ↔ Ethernet 변환기와 현장 Edge Gateway를 등록합니다. 하나의 변환기에 여러 PLC·계량기를 연결해도 장치별로 구분 등록합니다.</p>
      </div>
      {token ? (
        <Alert kind="success">
          <div className="space-y-1">
            <div>{token.name} 게이트웨이 등록 토큰입니다. 이 값은 다시 표시되지 않습니다.</div>
            <code className="block break-all rounded bg-black/30 px-2 py-1 font-mono text-[11px]">{token.token}</code>
            <button className="text-[11px] underline" onClick={() => void navigator.clipboard.writeText(token.token)}>복사</button>
          </div>
        </Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="게이트웨이 등록" className="xl:col-span-1">
          <div className="space-y-2">
            <Field label="사업장 *">
              <select className="eum-input" value={form.siteId ?? ""} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                <option value="">선택</option>
                {(sites.data?.items ?? []).map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
              </select>
            </Field>
            <Field label="이름 *"><input className="eum-input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="101동 지하 변전실 GW" /></Field>
            <Field label="구분">
              <select className="eum-input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="EDGE">EUM Edge Gateway (수집·버퍼링)</option>
                <option value="ETHERNET_CONVERTER">이더넷 통신변환기</option>
              </select>
            </Field>
            <Field label="동작 모드">
              <select className="eum-input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                <option value="TCP_CLIENT">TCP Client</option>
                <option value="TCP_SERVER">TCP Server</option>
                <option value="UDP">UDP</option>
                <option value="VIRTUAL_COM">Virtual COM</option>
                <option value="SERIAL_TUNNEL">Serial Tunnel</option>
                <option value="MODBUS_GATEWAY">Modbus Gateway</option>
                <option value="VENDOR">제조사 전용</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="IP"><input className="eum-input" value={form.host ?? ""} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="192.168.0.50" /></Field>
              <Field label="포트"><input className="eum-input" type="number" value={form.port ?? ""} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="502" /></Field>
            </div>
            <label className="flex items-center gap-2 text-[11.5px] text-[var(--eum-muted)]">
              <input type="checkbox" className="h-4 w-4 accent-[#23c3e6]" checked={form.convertsProtocol === "true"} onChange={(e) => setForm({ ...form, convertsProtocol: String(e.target.checked) })} />
              프로토콜 변환 장치 (Modbus RTU→TCP 등)
            </label>
            {formError ? <Alert kind="error">{formError}</Alert> : null}
            <Button variant="primary" onClick={() => void submit()} disabled={busy || !form.siteId || !form.name}>{busy ? "등록 중…" : "게이트웨이 등록"}</Button>
            <p className="text-[10.5px] leading-relaxed text-[var(--eum-muted)]">등록 후 발급되는 토큰으로 현장 에이전트를 실행합니다. 현장 PLC/RTU는 인터넷에 직접 노출하지 말고 게이트웨이를 통해 중앙 서버로 연결하세요.</p>
          </div>
        </Card>
        <Card title="등록된 게이트웨이" className="xl:col-span-2">
          {error ? <Alert kind="error">{error}</Alert> : null}
          {loading ? <Spinner /> : (data?.items.length ?? 0) === 0 ? <Empty>등록된 게이트웨이가 없습니다.</Empty> : (
            <div className="eum-scroll">
              <table className="eum-table">
                <thead><tr><th>이름</th><th>시리얼</th><th>사업장</th><th>모드</th><th>연결</th><th>장치</th><th>버퍼</th><th>마지막 접속</th><th>상태</th></tr></thead>
                <tbody>
                  {data!.items.map((gateway) => (
                    <tr key={gateway.id}>
                      <td>{gateway.name}<div className="text-[10px] text-[var(--eum-muted)]">{gateway.kind === "EDGE" ? "Edge" : "변환기"}{gateway.convertsProtocol ? " · 프로토콜 변환" : ""}</div></td>
                      <td className="font-mono text-[10.5px]">{gateway.serial}</td>
                      <td>{gateway.site.name}</td>
                      <td className="text-[10.5px]">{gateway.mode}</td>
                      <td className="text-[10.5px]">{gateway.host ?? "-"}:{gateway.port ?? "-"}</td>
                      <td>{gateway._count.devices}</td>
                      <td>{gateway.bufferDepth}</td>
                      <td className="text-[10.5px]">{formatDate(gateway.lastSeenAt)}</td>
                      <td><Badge value={gateway.status === "ONLINE" ? "GOOD" : "BAD"} label={gateway.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <ResourceManager
        title="Serial Bus (RS-485 공유)"
        endpoint="serial-buses"
        createLabel="버스 등록"
        columns={[
          { key: "name", label: "버스명" },
          { key: "gateway", label: "게이트웨이", render: (row) => String((row.gateway as { name?: string })?.name ?? "-") },
          { key: "port", label: "포트" },
          { key: "baudRate", label: "통신속도" },
          { key: "parity", label: "패리티" },
          { key: "mode", label: "모드" },
          { key: "pollGapMs", label: "요청 간격(ms)" },
          { key: "devices", label: "장치", render: (row) => String((row._count as { devices?: number })?.devices ?? 0) },
        ]}
        fields={[
          { key: "gatewayId", label: "게이트웨이", type: "select", required: true, optionsFrom: { endpoint: "gateways", valueKey: "id", labelKey: "name" } },
          { key: "name", label: "버스명", required: true, placeholder: "RS485-1" },
          { key: "port", label: "시리얼 포트", placeholder: "COM3 / /dev/ttyUSB0" },
          { key: "baudRate", label: "통신속도", type: "number", defaultValue: 9600 },
          { key: "parity", label: "패리티", type: "select", options: [{ value: "N", label: "None" }, { value: "E", label: "Even" }, { value: "O", label: "Odd" }], defaultValue: "N" },
          { key: "dataBits", label: "데이터 비트", type: "number", defaultValue: 8 },
          { key: "stopBits", label: "정지 비트", type: "number", defaultValue: 1 },
          { key: "mode", label: "프레임", type: "select", options: [{ value: "RTU", label: "RTU" }, { value: "ASCII", label: "ASCII" }], defaultValue: "RTU" },
          { key: "pollGapMs", label: "요청 간격(ms)", type: "number", defaultValue: 50, help: "동일 버스 충돌 방지를 위한 장치 간 최소 간격" },
        ]}
      />
      <Card title="현장 에이전트 실행">
        <pre className="eum-scroll rounded bg-[#06101a] p-3 font-mono text-[10.5px] leading-relaxed text-[#9ec6dd]">{`# 게이트웨이 설치 폴더에서
export EUMBMS_CENTRAL_URL=https://bms.example.com
export EUMBMS_GATEWAY_TOKEN=eum_...   # 위에서 발급된 토큰
export EUMBMS_BUFFER_DIR=./.queue
npm run gateway

# 통신 두절 시 로컬 버퍼에 저장하고, 복구되면 자동 동기화합니다.
# 게이트웨이는 중앙 서버로만 outbound 연결하며 PLC/RTU를 외부에 노출하지 않습니다.`}</pre>
      </Card>
    </div>
  );
}
