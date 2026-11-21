"use client";

import { useState } from "react";
import { api, download, formatDate, formatNumber, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, Empty, Field, Modal, Spinner, Stat } from "@/components/ui";

type Reading = { id: string; readingAt: string; value: number; meterKind: string; source: string; periodKey: string | null; unit: { dong: string | null; ho: string } | null; building: { name: string } | null; device: { name: string } | null; adjustments: { deltaValue: number }[] };

export default function MeteringPage() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [meterKind, setMeterKind] = useState("ELECTRICITY");
  const readings = useApi<{ items: Reading[] }>(`meter-readings?period=${period}&meterKind=${meterKind}&limit=1000`, { deps: [period, meterKind] });
  const missing = useApi<{ period: string; missing: { unitId: string; dong: string | null; ho: string; building: string; occupancy: string }[]; missingCount: number; totalUnits: number }>(`meter-readings/missing?period=${period}`, { deps: [period] });
  const devices = useApi<{ items: { id: string; name: string; deviceType: string; siteId: string }[] }>("devices");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ meterKind: "ELECTRICITY" });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = readings.data?.items ?? [];
  const total = items.reduce((sum, reading) => sum + reading.value, 0);
  const adjusted = items.reduce((sum, reading) => sum + reading.adjustments.reduce((s, a) => s + a.deltaValue, 0), 0);

  const submit = async () => {
    setError(null);
    try {
      await api("meter-readings", {
        method: "POST",
        body: {
          siteId: form.siteId,
          buildingId: form.buildingId || null,
          deviceId: form.deviceId || null,
          meterKind: form.meterKind,
          readingAt: form.readingAt,
          value: Number(form.value),
          note: form.note,
        },
      });
      setModal(false);
      setForm({ meterKind: "ELECTRICITY" });
      await readings.reload();
      await missing.reload();
    } catch (err) { setError((err as Error).message); }
  };

  const collect = async (deviceId: string) => {
    setMessage(null);
    try {
      await api("meter-readings/collect", { method: "POST", body: { deviceId } });
      setMessage("계량기 누적값을 읽어 검침을 저장했습니다.");
      await readings.reload();
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[19px] font-extrabold tracking-wide">원격검침</h1>
          <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">세대별 전력·수도·가스·열량 검침을 수집하고 누락·이상을 확인합니다. 원본과 보정 데이터를 분리 보관합니다.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void download("reports/export", { type: "metering", format: "csv", period }, `원격검침_${period}.csv`)}>CSV 내보내기</Button>
          <Button variant="primary" onClick={() => setModal(true)}>+ 수동 검침</Button>
        </div>
      </div>
      {message ? <Alert kind="success">{message}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="검침 건수" value={items.length} />
        <Stat label="검침 합계" value={formatNumber(total, 1)} unit={meterKind === "ELECTRICITY" ? "kWh" : ""} />
        <Stat label="보정 합계" value={formatNumber(adjusted, 1)} tone={adjusted !== 0 ? "warn" : "default"} />
        <Stat label={`${period} 누락`} value={missing.data?.missingCount ?? 0} tone={(missing.data?.missingCount ?? 0) > 0 ? "warn" : "good"} hint={`전체 ${missing.data?.totalUnits ?? 0}세대`} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="eum-input max-w-[150px]" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <select className="eum-input max-w-[150px]" value={meterKind} onChange={(e) => setMeterKind(e.target.value)}>
          <option value="ELECTRICITY">전력</option>
          <option value="WATER">수도</option>
          <option value="GAS">가스</option>
          <option value="HEAT">열량</option>
          <option value="HVAC">냉난방</option>
        </select>
        <Button onClick={() => { void readings.reload(); void missing.reload(); }}>새로고침</Button>
        <div className="ml-auto flex gap-1">
          {(devices.data?.items ?? []).filter((d) => d.deviceType === "METER").slice(0, 3).map((device) => (
            <Button key={device.id} onClick={() => void collect(device.id)}>지금 검침: {device.name}</Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="검침 내역" className="xl:col-span-2">
          {readings.loading ? <Spinner /> : items.length === 0 ? <Empty>{period} 검침 데이터가 없습니다.</Empty> : (
            <div className="eum-scroll max-h-[60vh]">
              <table className="eum-table">
                <thead><tr><th>검침시각</th><th>건물</th><th>동/호</th><th>계량기</th><th>값</th><th>보정</th><th>방식</th></tr></thead>
                <tbody>
                  {items.map((reading) => (
                    <tr key={reading.id}>
                      <td className="text-[10.5px]">{formatDate(reading.readingAt)}</td>
                      <td>{reading.building?.name ?? "-"}</td>
                      <td>{reading.unit ? `${reading.unit.dong ?? ""} ${reading.unit.ho}` : "-"}</td>
                      <td>{reading.device?.name ?? "-"}</td>
                      <td className="font-mono">{formatNumber(reading.value, 2)}</td>
                      <td className="font-mono">{reading.adjustments.reduce((s, a) => s + a.deltaValue, 0)}</td>
                      <td><Badge value={reading.source === "AUTO" ? "GOOD" : "UNKNOWN"} label={reading.source} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={`${period} 검침 누락 세대`}>
          {(missing.data?.missingCount ?? 0) === 0 ? <Empty>누락이 없습니다.</Empty> : (
            <div className="max-h-[60vh] space-y-1 overflow-auto">
              {missing.data!.missing.map((unit) => (
                <div key={unit.unitId} className="flex items-center justify-between rounded border border-[var(--eum-line)] px-2 py-1 text-[11px]">
                  <span>{unit.building} {unit.dong ?? ""} {unit.ho}</span>
                  <Badge value={unit.occupancy === "OCCUPIED" ? "WARNING" : "UNKNOWN"} label={unit.occupancy === "OCCUPIED" ? "입주" : "공실"} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {modal ? (
        <Modal title="수동 검침 등록" onClose={() => setModal(false)}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="사업장 *"><select className="eum-input" value={form.siteId ?? ""} onChange={(e) => setForm({ ...form, siteId: e.target.value })}><option value="">선택</option><SiteOptions /></select></Field>
            <Field label="계량기"><select className="eum-input" value={form.deviceId ?? ""} onChange={(e) => setForm({ ...form, deviceId: e.target.value })}><option value="">없음</option>{(devices.data?.items ?? []).filter((d) => d.deviceType === "METER").map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="종류"><select className="eum-input" value={form.meterKind ?? "ELECTRICITY"} onChange={(e) => setForm({ ...form, meterKind: e.target.value })}><option value="ELECTRICITY">전력</option><option value="WATER">수도</option><option value="GAS">가스</option><option value="HEAT">열량</option></select></Field>
            <Field label="검침일시 *"><input className="eum-input" type="datetime-local" value={form.readingAt ?? ""} onChange={(e) => setForm({ ...form, readingAt: e.target.value })} /></Field>
            <Field label="검침값 *"><input className="eum-input" type="number" step="0.01" value={form.value ?? ""} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>
            <Field label="비고"><input className="eum-input" value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          </div>
          {error ? <div className="mt-2"><Alert kind="error">{error}</Alert></div> : null}
          <div className="mt-3 flex justify-end"><Button variant="primary" onClick={() => void submit()} disabled={!form.siteId || !form.readingAt || !form.value}>저장</Button></div>
        </Modal>
      ) : null}
    </div>
  );
}

function SiteOptions() {
  const sites = useApi<{ items: { id: string; name: string }[] }>("sites");
  return <>{ (sites.data?.items ?? []).map((site) => <option key={site.id} value={site.id}>{site.name}</option>) }</>;
}
