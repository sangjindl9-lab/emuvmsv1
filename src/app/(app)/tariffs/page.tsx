"use client";

import { useState } from "react";
import { api, download, formatDate, formatNumber, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, Empty, Field, Modal, Spinner } from "@/components/ui";

type Tariff = { id: string; name: string; version: number; effectiveFrom: string; effectiveTo: string | null; status: string; config: Record<string, unknown>; currency: string };
type Bill = { total: number; baseCharge: number; energyCharge: number; demandCharge: number; powerFactorCharge: number; vat: number; climateCharge: number; fuelAdjustment: number; carbonKg: number; effectiveUnitPrice: number; breakdown: { label: string; kwh?: number; rate?: number; amount: number }[]; assumptions: string[] };

const DEFAULT_CONFIG = `{
  "customerType": "산업용(을)",
  "baseRatePerKw": 6500,
  "demandRatePerKw": 0,
  "energyTiers": [
    { "limit": 100, "rate": 90 },
    { "limit": 200, "rate": 140 },
    { "limit": null, "rate": 190 }
  ],
  "vatRate": 0.1,
  "climateRate": 9,
  "fuelAdjustmentRate": 5,
  "powerFactorThreshold": 90,
  "powerFactorPenaltyRate": 0.2,
  "carbonFactor": 0.4781
}`;

export default function TariffsPage() {
  const { data, error, loading, reload } = useApi<{ items: Tariff[] }>("tariffs");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ config: DEFAULT_CONFIG, effectiveFrom: new Date().toISOString().slice(0, 10) });
  const [billForm, setBillForm] = useState<Record<string, string>>({ usageKwh: "1000", peakKw: "50", contractPowerKw: "100", powerFactor: "92" });
  const [bill, setBill] = useState<Bill | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const create = async () => {
    try {
      await api("tariffs", { method: "POST", body: { name: form.name, effectiveFrom: form.effectiveFrom, config: JSON.parse(form.config) } });
      setModal(false);
      await reload();
    } catch (err) { setMessage((err as Error).message); }
  };
  const activate = async (tariff: Tariff) => {
    await api(`tariffs/${tariff.id}/activate`, { method: "POST" });
    await reload();
  };
  const calculate = async (tariff?: Tariff) => {
    try {
      const result = await api<{ bill: Bill }>("billing/calculate", {
        method: "POST",
        body: {
          usageKwh: Number(billForm.usageKwh),
          peakKw: Number(billForm.peakKw),
          contractPowerKw: Number(billForm.contractPowerKw),
          powerFactor: Number(billForm.powerFactor),
          tariffId: tariff?.id ?? (data?.items.find((t) => t.status === "ACTIVE")?.id ?? undefined),
        },
      });
      setBill(result.bill);
    } catch (err) { setMessage((err as Error).message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[19px] font-extrabold tracking-wide">전기요금 관리</h1>
          <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">계약전력·누진구간·시간대별(TOU) 단가·부가항목을 버전으로 관리하고 요금을 추정합니다. 실제 고지서와의 일치는 계약 조건 설정에 따릅니다.</p>
        </div>
        <Button variant="primary" onClick={() => setModal(true)}>+ 요금표 등록</Button>
      </div>
      {message ? <Alert kind="error">{message}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="요금표 버전" className="xl:col-span-2">
          {loading ? <Spinner /> : (data?.items.length ?? 0) === 0 ? <Empty>등록된 요금표가 없습니다.</Empty> : (
            <table className="eum-table">
              <thead><tr><th>요금표</th><th>버전</th><th>적용일</th><th>상태</th><th>동작</th></tr></thead>
              <tbody>
                {data!.items.map((tariff) => (
                  <tr key={tariff.id}>
                    <td>{tariff.name}</td>
                    <td>v{tariff.version}</td>
                    <td className="text-[10.5px]">{formatDate(tariff.effectiveFrom)} ~ {tariff.effectiveTo ? formatDate(tariff.effectiveTo) : "현재"}</td>
                    <td><Badge value={tariff.status === "ACTIVE" ? "APPROVED" : tariff.status === "DRAFT" ? "DRAFT" : "UNKNOWN"} label={tariff.status} /></td>
                    <td className="flex gap-2">
                      {tariff.status !== "ACTIVE" ? <button className="text-[10.5px] text-[#5fe09a]" onClick={() => void activate(tariff)}>적용</button> : null}
                      <button className="text-[10.5px] text-[var(--eum-accent)]" onClick={() => void calculate(tariff)}>요금 계산</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="요금 추정 계산기">
          <div className="space-y-2">
            <Field label="월 사용량(kWh)"><input className="eum-input" type="number" value={billForm.usageKwh} onChange={(e) => setBillForm({ ...billForm, usageKwh: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="최대수요(kW)"><input className="eum-input" type="number" value={billForm.peakKw} onChange={(e) => setBillForm({ ...billForm, peakKw: e.target.value })} /></Field>
              <Field label="계약전력(kW)"><input className="eum-input" type="number" value={billForm.contractPowerKw} onChange={(e) => setBillForm({ ...billForm, contractPowerKw: e.target.value })} /></Field>
              <Field label="역률(%)"><input className="eum-input" type="number" value={billForm.powerFactor} onChange={(e) => setBillForm({ ...billForm, powerFactor: e.target.value })} /></Field>
            </div>
            <Button variant="primary" onClick={() => void calculate()}>계산</Button>
            {bill ? (
              <div className="mt-2 space-y-1 text-[11px]">
                <div className="flex justify-between"><span>기본요금</span><span>{formatNumber(bill.baseCharge, 0)}원</span></div>
                <div className="flex justify-between"><span>전력량요금</span><span>{formatNumber(bill.energyCharge, 0)}원</span></div>
                <div className="flex justify-between"><span>수요요금</span><span>{formatNumber(bill.demandCharge, 0)}원</span></div>
                <div className="flex justify-between"><span>역률 페널티</span><span>{formatNumber(bill.powerFactorCharge, 0)}원</span></div>
                <div className="flex justify-between"><span>기후환경·연료비</span><span>{formatNumber(bill.climateCharge + bill.fuelAdjustment, 0)}원</span></div>
                <div className="flex justify-between"><span>부가세</span><span>{formatNumber(bill.vat, 0)}원</span></div>
                <div className="flex justify-between border-t border-[var(--eum-line)] pt-1 text-[13px] font-bold"><span>합계</span><span className="text-[var(--eum-accent)]">{formatNumber(bill.total, 0)}원</span></div>
                <div className="flex justify-between text-[10.5px] text-[var(--eum-muted)]"><span>kWh당</span><span>{formatNumber(bill.effectiveUnitPrice, 1)}원</span></div>
                <div className="flex justify-between text-[10.5px] text-[var(--eum-muted)]"><span>탄소배출 추정</span><span>{formatNumber(bill.carbonKg, 1)} kgCO₂</span></div>
                <ul className="list-disc pl-4 text-[10px] text-[var(--eum-muted)]">{bill.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
              </div>
            ) : null}
          </div>
        </Card>
      </div>
      <Card title="요금표 구성(config) 안내">
        <pre className="eum-scroll rounded bg-[#06101a] p-3 font-mono text-[10.5px] text-[#9ec6dd]">{DEFAULT_CONFIG}</pre>
        <p className="mt-2 text-[10.5px] text-[var(--eum-muted)]">energyTiers는 누진 구간, tou는 {`{"start":0,"end":8,"rate":60}`} 형태의 시간대 단가입니다. 버전을 새로 만들면 기존 운영 요금표는 자동으로 RETIRED 처리됩니다.</p>
        <Button onClick={() => void download("reports/export", { type: "energy", format: "csv" }, "에너지분석.csv")}>에너지 CSV 내보내기</Button>
      </Card>
      {modal ? (
        <Modal title="요금표 등록" onClose={() => setModal(false)}>
          <div className="space-y-2">
            <Field label="요금표 이름 *"><input className="eum-input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="산업용(을) 2026" /></Field>
            <Field label="적용 시작일 *"><input className="eum-input" type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></Field>
            <Field label="구성(JSON)"><textarea className="eum-input min-h-[240px] font-mono text-[10.5px]" value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })} /></Field>
            <div className="flex justify-end"><Button variant="primary" onClick={() => void create()} disabled={!form.name}>등록</Button></div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
