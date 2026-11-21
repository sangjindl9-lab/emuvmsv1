"use client";

import Link from "next/link";
import { api, formatDate, formatNumber, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, Empty, Spinner, Stat } from "@/components/ui";

type Dashboard = {
  counts: { sites: number; buildings: number; devices: number; devicesOnline: number; devicesOffline: number; tags: number; readingsToday: number; activeAlarms: number; gatewaysOnline: number };
  sites: { id: string; name: string; code: string }[];
  devices: { id: string; quality: string; enabled: boolean; siteId: string }[];
  power: { id: string; name: string; standardKey: string | null; value: number | null; unit: string | null; quality: string; device: string; lastReadAt: string | null }[];
  activeAlarms: { id: string; title: string; severity: string; code: string; occurredAt: string; status: string; site: { name: string } }[];
  alarmCounts: { severity: string; count: number }[];
  recentCommands: { id: string; command: string; status: string; createdAt: string }[];
  gateways: { id: string; name: string; status: string; lastSeenAt: string | null }[];
  latestMeter: { value: number; readingAt: string } | null;
};

const powerLabels: Record<string, string> = {
  ACTIVE_POWER: "유효전력",
  VOLTAGE_L1_N: "전압 L1-N",
  CURRENT_L1: "전류 L1",
  POWER_FACTOR: "역률",
  FREQUENCY: "주파수",
  ENERGY_IMPORT: "누적 전력량",
};

export default function DashboardPage() {
  const { data, error, loading, reload } = useApi<Dashboard>("dashboard", { pollMs: 10000 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[19px] font-extrabold tracking-wide">통합 대시보드</h1>
          <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">사업장·설비·통신·알람·제어 상태를 한 화면에서 확인합니다.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void reload()}>새로고침</Button>
          <Link className="eum-btn eum-btn-primary" href="/scada">
            전력 관제 열기
          </Link>
        </div>
      </div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      {loading && !data ? (
        <Spinner />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            <Stat label="사업장" value={data.counts.sites} tone="accent" />
            <Stat label="건물" value={data.counts.buildings} />
            <Stat label="장치" value={data.counts.devices} hint={`정상 ${data.counts.devicesOnline} · 장애 ${data.counts.devicesOffline}`} />
            <Stat label="태그" value={formatNumber(data.counts.tags, 0)} />
            <Stat label="24시간 수집" value={formatNumber(data.counts.readingsToday, 0)} hint="태그 읽기 건수" />
            <Stat label="활성 알람" value={data.counts.activeAlarms} tone={data.counts.activeAlarms > 0 ? "bad" : "good"} />
            <Stat label="게이트웨이" value={data.counts.gatewaysOnline} tone="good" hint="온라인" />
            <Stat label="최근 검침" value={data.latestMeter ? formatNumber(data.latestMeter.value) : "-"} unit="kWh" hint={data.latestMeter ? formatDate(data.latestMeter.readingAt) : "검침 없음"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="실시간 전력 계측" className="xl:col-span-2" actions={<span className="text-[10.5px] text-[var(--eum-muted)]">10초 자동 갱신</span>}>
              {data.power.length === 0 ? (
                <Empty>수집된 전력 태그가 없습니다. 프로토콜 센터에서 장치와 태그를 등록하고 수집을 실행하세요.</Empty>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {data.power.slice(0, 16).map((tag) => (
                    <div key={tag.id} className="rounded-md border border-[var(--eum-line)] bg-[#0a1723] px-3 py-2">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-[10.5px] text-[var(--eum-muted)]">{tag.name || powerLabels[tag.standardKey ?? ""] || tag.standardKey}</span>
                        <Badge value={tag.quality} />
                      </div>
                      <div className="mt-1 text-[19px] font-bold text-[var(--eum-accent)]">
                        {tag.value === null ? "-" : formatNumber(tag.value, 2)}
                        <span className="ml-1 text-[10px] font-normal text-[var(--eum-muted)]">{tag.unit}</span>
                      </div>
                      <div className="truncate text-[9.5px] text-[var(--eum-muted)]">{tag.device}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="활성 알람" actions={<Link className="text-[11px] text-[var(--eum-accent)] hover:underline" href="/alarms">전체</Link>}>
              {data.activeAlarms.length === 0 ? (
                <Empty>활성 알람이 없습니다.</Empty>
              ) : (
                <ul className="space-y-1.5">
                  {data.activeAlarms.map((alarm) => (
                    <li key={alarm.id} className="rounded border border-[var(--eum-line)] bg-[#0a1723] px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11.5px] font-semibold">{alarm.title}</span>
                        <Badge value={alarm.severity} />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[10px] text-[var(--eum-muted)]">
                        <span>{alarm.site?.name}</span>
                        <span>{formatDate(alarm.occurredAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="사업장 현황" actions={<Link className="text-[11px] text-[var(--eum-accent)] hover:underline" href="/sites">관리</Link>}>
              {data.sites.length === 0 ? (
                <Empty>등록된 사업장이 없습니다.</Empty>
              ) : (
                <table className="eum-table">
                  <thead>
                    <tr><th>코드</th><th>사업장</th><th>장치</th><th>상태</th></tr>
                  </thead>
                  <tbody>
                    {data.sites.map((site) => {
                      const siteDevices = data.devices.filter((d) => (d as { siteId?: string }).siteId === site.id);
                      const good = siteDevices.filter((d) => d.quality === "GOOD").length;
                      return (
                        <tr key={site.id}>
                          <td className="font-mono text-[11px]">{site.code}</td>
                          <td>{site.name}</td>
                          <td>{siteDevices.length}</td>
                          <td>{siteDevices.length === 0 ? <Badge value="UNKNOWN" label="장치 없음" /> : good === siteDevices.length ? <Badge value="GOOD" label="정상" /> : <Badge value="WARN" label={`${siteDevices.length - good}대 장애`} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="게이트웨이 / 최근 제어" actions={<Link className="text-[11px] text-[var(--eum-accent)] hover:underline" href="/control">원격제어</Link>}>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[10.5px] font-semibold text-[var(--eum-muted)]">현장 게이트웨이</div>
                  {data.gateways.length === 0 ? (
                    <div className="text-[11.5px] text-[var(--eum-muted)]">등록된 게이트웨이가 없습니다.</div>
                  ) : (
                    data.gateways.slice(0, 5).map((gateway) => (
                      <div key={gateway.id} className="flex items-center justify-between border-b border-[#14293b] py-1 text-[11.5px]">
                        <span>{gateway.name}</span>
                        <span className="flex items-center gap-2"><span className="text-[10px] text-[var(--eum-muted)]">{formatDate(gateway.lastSeenAt)}</span><Badge value={gateway.status === "ONLINE" ? "GOOD" : "BAD"} label={gateway.status} /></span>
                      </div>
                    ))
                  )}
                </div>
                <div>
                  <div className="mb-1 text-[10.5px] font-semibold text-[var(--eum-muted)]">최근 제어 명령</div>
                  {data.recentCommands.length === 0 ? (
                    <div className="text-[11.5px] text-[var(--eum-muted)]">제어 이력이 없습니다.</div>
                  ) : (
                    data.recentCommands.map((command) => (
                      <div key={command.id} className="flex items-center justify-between border-b border-[#14293b] py-1 text-[11.5px]">
                        <span className="font-mono">{command.command}</span>
                        <span className="flex items-center gap-2 text-[10px] text-[var(--eum-muted)]">{formatDate(command.createdAt)}<Badge value={command.status} /></span>
                      </div>
                    ))
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
