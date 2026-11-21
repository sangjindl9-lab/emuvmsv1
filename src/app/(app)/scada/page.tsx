"use client";

import { useState } from "react";
import { api, formatDate, formatNumber, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, Empty, Spinner, Stat } from "@/components/ui";

type LiveTag = {
  id: string;
  name: string;
  key: string;
  standardKey: string | null;
  unit: string | null;
  lastValue: number | null;
  lastValueText: string | null;
  quality: string;
  lastReadAt: string | null;
  device: { id: string; name: string; quality: string };
};

type Asset = { id: string; name: string; code: string; assetType: string; status: string; breakerState: string; site: { name: string }; remoteControlEnabled: boolean };

function TrendChart({ points, unit }: { points: { ts: string; value: number | null }[]; unit: string }) {
  const values = points.map((point) => point.value ?? 0);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const width = 900;
  const height = 160;
  const step = width / Math.max(1, points.length - 1);
  const path = values
    .map((value, index) => `${index === 0 ? "M" : "L"} ${(index * step).toFixed(1)} ${(height - ((value - min) / range) * (height - 20) - 10).toFixed(1)}`)
    .join(" ");
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] text-[var(--eum-muted)]">
        <span>{new Date(points[0].ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
        <span>최대 {formatNumber(max, 2)} {unit} · 최소 {formatNumber(min, 2)} {unit}</span>
        <span>{new Date(points[points.length - 1].ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line key={ratio} x1={0} y1={height * ratio} x2={width} y2={height * ratio} stroke="#152b3d" strokeWidth={1} />
        ))}
        <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill="url(#trendFill)" opacity={0.25} />
        <path d={path} fill="none" stroke="#23c3e6" strokeWidth={2} />
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#23c3e6" />
            <stop offset="100%" stopColor="#0a1723" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export default function ScadaPage() {
  const { data, error, loading, reload } = useApi<{ items: LiveTag[]; at: string }>("live", { pollMs: 5000 });
  const assets = useApi<{ items: Asset[] }>("assets", { pollMs: 15000 });
  const collector = useApi<{ lastRun: { at: string; report: { devices: number; okDevices: number; tags: number; errors: { device: string; error: string }[] } } | null; readingsLast15m: number; devicesByQuality: { quality: string; count: number }[] }>("collector/status", { pollMs: 15000 });
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setMessage(null);
    try {
      const report = await api<{ devices: number; okDevices: number; tags: number; goodTags: number; errors: { device: string; error: string }[] }>("collector/run", { method: "POST" });
      setMessage(`수집 완료: 장치 ${report.okDevices}/${report.devices} 정상, 태그 ${report.tags}건(정상 ${report.goodTags})${report.errors.length ? `, 오류 ${report.errors.length}건` : ""}`);
      await reload();
      await collector.reload();
    } catch (err) {
      setMessage(`수집 실패: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const tags = data?.items ?? [];
  const trendTag = tags.find((tag) => tag.standardKey === "ACTIVE_POWER") ?? tags.find((tag) => tag.unit === "kW") ?? tags[0];
  const trends = useApi<{ series: Record<string, { ts: string; value: number | null }[]> }>(
    trendTag ? `trends?tagIds=${trendTag.id}&hours=1` : null,
    { pollMs: 15000, deps: [trendTag?.id] },
  );
  const trendPoints = (trendTag ? trends.data?.series?.[trendTag.id] ?? [] : []).filter((point) => point.value !== null);
  const groups = tags.reduce<Record<string, LiveTag[]>>((acc, tag) => {
    (acc[tag.device?.name ?? "미지정"] ??= []).push(tag);
    return acc;
  }, {});
  const qualityCounts = tags.reduce<Record<string, number>>((acc, tag) => {
    acc[tag.quality] = (acc[tag.quality] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[19px] font-extrabold tracking-wide">전력 통합 관제</h1>
          <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">수배전반·변압기·차단기·발전기·UPS·태양광·ESS 계측값을 5초 주기로 확인합니다.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { void reload(); void assets.reload(); }}>새로고침</Button>
          <Button variant="primary" onClick={() => void run()} disabled={running}>{running ? "수집 중…" : "지금 수집 실행"}</Button>
        </div>
      </div>
      {message ? <Alert kind="info">{message}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="태그" value={tags.length} />
        <Stat label="정상" value={qualityCounts.GOOD ?? 0} tone="good" />
        <Stat label="불확실" value={qualityCounts.UNCERTAIN ?? 0} tone="warn" />
        <Stat label="통신불량" value={(qualityCounts.BAD ?? 0) + (qualityCounts.STALE ?? 0)} tone="bad" />
        <Stat label="15분 수집" value={formatNumber(collector.data?.readingsLast15m ?? 0, 0)} />
        <Stat label="설비" value={assets.data?.items.length ?? 0} hint={`원격제어 ${assets.data?.items.filter((a) => a.remoteControlEnabled).length ?? 0}`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        <Card title="설비 상태" className="xl:col-span-1">
          {assets.loading ? <Spinner /> : (assets.data?.items.length ?? 0) === 0 ? <Empty>등록된 전력설비가 없습니다.</Empty> : (
            <div className="max-h-[420px] space-y-1 overflow-auto">
              {assets.data!.items.map((asset) => (
                <div key={asset.id} className="rounded border border-[var(--eum-line)] bg-[#0a1723] px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11.5px]">{asset.name}</span>
                    <Badge value={asset.status === "NORMAL" ? "NORMAL" : asset.status === "TRIP" ? "TRIP" : "WARN"} label={asset.status} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9.5px] text-[var(--eum-muted)]">
                    <span>{asset.assetType}</span>
                    <span>차단기 {asset.breakerState}{asset.remoteControlEnabled ? " · 원격" : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="실시간 계측" className="xl:col-span-3" actions={<span className="text-[10px] text-[var(--eum-muted)]">{data ? formatDate(data.at) : ""}</span>}>
          {loading && !data ? <Spinner /> : tags.length === 0 ? <Empty>수집된 태그가 없습니다. 장치 등록 후 상단의 ‘지금 수집 실행’을 눌러주세요.</Empty> : (
            <div className="max-h-[520px] space-y-3 overflow-auto">
              {Object.entries(groups).map(([deviceName, deviceTags]) => (
                <div key={deviceName}>
                  <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-[var(--eum-accent)]">
                    <span>{deviceName}</span>
                    <Badge value={deviceTags[0]?.device.quality} />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                    {deviceTags.map((tag) => (
                      <div key={tag.id} className="rounded border border-[var(--eum-line)] bg-[#0a1723] px-2 py-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate text-[10px] text-[var(--eum-muted)]">{tag.name}</span>
                          <Badge value={tag.quality} />
                        </div>
                        <div className="mt-0.5 text-[15px] font-bold">
                          {tag.lastValue !== null ? formatNumber(tag.lastValue, 2) : tag.lastValueText ?? "-"}
                          <span className="ml-1 text-[9.5px] font-normal text-[var(--eum-muted)]">{tag.unit}</span>
                        </div>
                        <div className="text-[9px] text-[var(--eum-muted)]">{formatDate(tag.lastReadAt)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title={`실시간 트렌드${trendTag ? ` — ${trendTag.name}` : ""}`} actions={<span className="text-[10px] text-[var(--eum-muted)]">최근 1시간 · {trendPoints.length}점</span>}>
        {trendPoints.length < 2 ? (
          <Empty>트렌드 데이터가 부족합니다. 수집을 실행하면 시계열이 쌓입니다.</Empty>
        ) : (
          <TrendChart points={trendPoints} unit={trendTag?.unit ?? ""} />
        )}
      </Card>

      <Card title="수집 엔진 상태">
        <div className="grid gap-3 text-[11.5px] sm:grid-cols-3">
          <div>마지막 수집: <span className="text-[var(--eum-accent)]">{collector.data?.lastRun ? formatDate(collector.data.lastRun.at) : "없음"}</span></div>
          <div>최근 15분 읽기: {formatNumber(collector.data?.readingsLast15m ?? 0, 0)}건</div>
          <div>장치 품질: {(collector.data?.devicesByQuality ?? []).map((q) => `${q.quality} ${q.count}`).join(" · ") || "-"}</div>
        </div>
        {collector.data?.lastRun?.report?.errors?.length ? (
          <div className="mt-2 text-[11px] text-[#ffb0a8]">오류: {collector.data.lastRun.report.errors.slice(0, 5).map((e) => `${e.device}(${e.error})`).join(", ")}</div>
        ) : null}
        <p className="mt-2 text-[10.5px] text-[var(--eum-muted)]">서버 내장 수집기는 데모/검증용입니다. 운영에서는 현장 Edge Gateway가 수집·버퍼링 후 중앙 서버로 전송합니다.</p>
      </Card>
    </div>
  );
}
