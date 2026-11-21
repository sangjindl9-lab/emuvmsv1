"use client";

import { useState } from "react";
import { api, download, formatNumber, useApi } from "@/lib/client";
import { Alert, Button, Card, Empty } from "@/components/ui";

type ReportRow = Record<string, unknown>;

const REPORTS = [
  { type: "metering", label: "원격검침 결과", desc: "세대별 검침값·보정·방식" },
  { type: "energy", label: "에너지 사용량", desc: "월별 사용량·탄소배출 추정" },
  { type: "alarms", label: "알람·장애 이력", desc: "최근 31일 발생·복구" },
  { type: "control", label: "원격제어 이력", desc: "요청·승인·실행 결과" },
];

export default function ReportsPage() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [preview, setPreview] = useState<{ title: string; rows: ReportRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const missing = useApi<{ missingCount: number; totalUnits: number }>(`meter-readings/missing?period=${period}`, { deps: [period] });

  const run = async (type: string, format: "csv" | "json") => {
    setBusy(type + format);
    setError(null);
    try {
      if (format === "csv") {
        await download("reports/export", { type, format, period }, `EUMBMS_${type}_${period}.csv`);
      } else {
        const result = await api<{ title: string; rows: ReportRow[] }>("reports/export", { method: "POST", body: { type, format, period } });
        setPreview(result);
      }
    } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="no-print">
        <h1 className="text-[19px] font-extrabold tracking-wide">보고서</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">검침·에너지·알람·제어 이력을 CSV/JSON으로 내보내고 인쇄용으로 확인합니다.</p>
      </div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div className="no-print flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-[var(--eum-muted)]">검침 기간</span>
        <input className="eum-input max-w-[160px]" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <span className="text-[11px] text-[var(--eum-muted)]">{period} 검침 누락 {missing.data?.missingCount ?? 0} / {missing.data?.totalUnits ?? 0}세대</span>
      </div>
      <div className="no-print grid gap-3 sm:grid-cols-2">
        {REPORTS.map((report) => (
          <Card key={report.type} title={report.label}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-[var(--eum-muted)]">{report.desc}</p>
              <div className="flex gap-1">
                <Button onClick={() => void run(report.type, "json")} disabled={busy === report.type + "json"}>미리보기</Button>
                <Button onClick={() => void run(report.type, "csv")} disabled={busy === report.type + "csv"}>CSV</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {preview ? (
        <Card title={`${preview.title} (${preview.rows.length}건)`} actions={<div className="no-print flex gap-2"><Button onClick={() => window.print()}>인쇄</Button><Button onClick={() => setPreview(null)}>닫기</Button></div>}>
          {preview.rows.length === 0 ? <Empty>데이터가 없습니다.</Empty> : (
            <div className="eum-scroll max-h-[60vh]">
              <table className="eum-table">
                <thead><tr>{Object.keys(preview.rows[0]).map((key) => <th key={key}>{key}</th>)}</tr></thead>
                <tbody>{preview.rows.slice(0, 500).map((row, index) => <tr key={index}>{Object.keys(preview.rows[0]).map((key) => <td key={key}>{typeof row[key] === "number" ? formatNumber(row[key] as number, 2) : String(row[key] ?? "")}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
