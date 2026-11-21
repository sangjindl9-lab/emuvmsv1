"use client";

import { formatNumber, useApi } from "@/lib/client";
import { Alert, Badge, Card, Empty, Spinner, Stat } from "@/components/ui";

type Analysis = {
  series: { month: string; usage: number }[];
  totalUsage: number;
  average: number;
  yearOverYear: number | null;
  anomalies: { month: string; usage: number; average: number; ratio: number }[];
  carbonKg: number;
  live: { currentPowerKw: number; peakKw: number; powerFactor: number | null; tags: number };
  lastMonthBill: { total: number; energyCharge: number; vat: number; carbonKg: number; assumptions: string[] } | null;
  tariff: { name: string; version: number } | null;
};

export default function EnergyPage() {
  const { data, error, loading } = useApi<Analysis>("energy/analysis?months=12");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-extrabold tracking-wide">에너지 분석</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">월별 사용량·피크·역률·탄소배출량과 전년 대비, 이상 사용량을 분석합니다. 모든 수치는 검침 원본 기반 추정치입니다.</p>
      </div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      {loading && !data ? <Spinner /> : data ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="12개월 사용량" value={formatNumber(data.totalUsage, 0)} unit="kWh" tone="accent" />
            <Stat label="월 평균" value={formatNumber(data.average, 0)} unit="kWh" />
            <Stat label="전년 대비" value={data.yearOverYear === null ? "-" : `${(data.yearOverYear * 100).toFixed(1)}%`} tone={data.yearOverYear !== null && data.yearOverYear > 0 ? "warn" : "good"} />
            <Stat label="실시간 부하" value={formatNumber(data.live.currentPowerKw, 1)} unit="kW" />
            <Stat label="최대수요" value={formatNumber(data.live.peakKw, 1)} unit="kW" tone="warn" />
            <Stat label="탄소배출 추정" value={formatNumber(data.carbonKg, 0)} unit="kgCO₂" />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="월별 사용량" className="xl:col-span-2">
              {data.series.length === 0 ? <Empty>검침 데이터가 부족합니다. 원격검침에서 누적 전력량을 수집하세요.</Empty> : <BarChart series={data.series} />}
            </Card>
            <Card title="분석 요약">
              <div className="space-y-2 text-[11.5px]">
                <div className="flex justify-between"><span className="text-[var(--eum-muted)]">적용 요금표</span><span>{data.tariff ? `${data.tariff.name} v${data.tariff.version}` : "없음"}</span></div>
                <div className="flex justify-between"><span className="text-[var(--eum-muted)]">전력 태그</span><span>{data.live.tags}개</span></div>
                <div className="flex justify-between"><span className="text-[var(--eum-muted)]">역률</span><span>{data.live.powerFactor === null ? "-" : `${data.live.powerFactor}%`} {data.live.powerFactor !== null && data.live.powerFactor < 90 ? <Badge value="WARNING" label="저하" /> : null}</span></div>
                {data.lastMonthBill ? (
                  <div className="rounded border border-[var(--eum-line)] bg-[#0a1723] p-2">
                    <div className="mb-1 font-semibold">최근 월 요금 추정</div>
                    <div className="text-[18px] font-bold text-[var(--eum-accent)]">{formatNumber(data.lastMonthBill.total, 0)}원</div>
                    <div className="text-[10px] text-[var(--eum-muted)]">전력량요금 {formatNumber(data.lastMonthBill.energyCharge, 0)}원 · 부가세 {formatNumber(data.lastMonthBill.vat, 0)}원</div>
                  </div>
                ) : null}
                <div>
                  <div className="mb-1 font-semibold text-[#f0c966]">이상 사용량</div>
                  {data.anomalies.length === 0 ? <div className="text-[10.5px] text-[var(--eum-muted)]">탐지된 이상 사용량이 없습니다.</div> : (
                    <ul className="space-y-1">
                      {data.anomalies.map((anomaly) => (
                        <li key={anomaly.month} className="flex justify-between text-[10.5px]"><span>{anomaly.month}</span><span className={anomaly.ratio > 1 ? "text-[#ff9d93]" : "text-[#7fd6ef]"}>{formatNumber(anomaly.usage, 0)}kWh ({anomaly.ratio}x)</span></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function BarChart({ series }: { series: { month: string; usage: number }[] }) {
  const width = 760;
  const height = 280;
  const padding = { left: 55, bottom: 30, top: 15, right: 15 };
  const max = Math.max(...series.map((s) => s.usage), 1);
  const barWidth = Math.max(8, (width - padding.left - padding.right) / series.length - 8);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = padding.top + (height - padding.top - padding.bottom) * (1 - ratio);
        return (
          <g key={ratio}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#1a3348" />
            <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#7f9bb3">{formatNumber(max * ratio, 0)}</text>
          </g>
        );
      })}
      {series.map((item, index) => {
        const barHeight = ((height - padding.top - padding.bottom) * item.usage) / max;
        const x = padding.left + index * ((width - padding.left - padding.right) / series.length) + 4;
        const y = height - padding.bottom - barHeight;
        return (
          <g key={item.month}>
            <rect x={x} y={y} width={barWidth} height={barHeight} fill="url(#barGrad)" rx={2} />
            <text x={x + barWidth / 2} y={height - padding.bottom + 12} textAnchor="middle" fontSize={8.5} fill="#7f9bb3">{item.month.slice(2)}</text>
            <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" fontSize={8.5} fill="#bcd6e6">{formatNumber(item.usage, 0)}</text>
          </g>
        );
      })}
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#23c3e6" />
          <stop offset="100%" stopColor="#0d5b78" />
        </linearGradient>
      </defs>
    </svg>
  );
}
