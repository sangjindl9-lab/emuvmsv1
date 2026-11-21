"use client";

import { useState } from "react";
import { api, download, formatDate, useApi } from "@/lib/client";
import { ResourceManager } from "@/components/ResourceManager";
import { Alert, Badge, Button, Card, Empty, Spinner, Stat } from "@/components/ui";

type AlarmEvent = { id: string; severity: string; code: string; title: string; message: string | null; status: string; occurredAt: string; repeatCount: number; site: { name: string }; device: { name: string } | null; tag: { name: string; unit: string | null } | null; assignedTo: { name: string } | null; resolvedAt: string | null };

export default function AlarmsPage() {
  const [tab, setTab] = useState<"events" | "rules">("events");
  const [statusFilter, setStatusFilter] = useState("ACTIVE,ACK,ASSIGNED");
  const events = useApi<{ items: AlarmEvent[] }>(`alarm-events?status=${statusFilter}&limit=300`, { pollMs: 15000, deps: [statusFilter] });
  const summary = useApi<{ active: number; total30d: number; bySeverity: Record<string, number>; topCodes: { code: string; count: number }[]; avgResolutionMinutes: number | null }>("alarms/summary", { pollMs: 30000 });
  const [message, setMessage] = useState<string | null>(null);

  const act = async (id: string, action: "ack" | "resolve") => {
    setMessage(null);
    try {
      await api(`alarm-events/${id}/${action}`, { method: "POST", body: action === "resolve" ? { resolution: "운영자 조치 완료" } : { assignToMe: true } });
      await events.reload();
      await summary.reload();
    } catch (err) { setMessage((err as Error).message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[19px] font-extrabold tracking-wide">알람·장애관리</h1>
          <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">정전·과전압·과전류·역률저하·차단기 트립·통신장애·검침누락을 등급별로 관리하고 조치 이력을 남깁니다.</p>
        </div>
        <Button onClick={() => void download("reports/export", { type: "alarms", format: "csv" }, "알람이력.csv")}>알람 이력 CSV</Button>
      </div>
      {message ? <Alert kind="error">{message}</Alert> : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="활성 알람" value={summary.data?.active ?? 0} tone={(summary.data?.active ?? 0) > 0 ? "bad" : "good"} />
        <Stat label="30일 발생" value={summary.data?.total30d ?? 0} />
        <Stat label="치명/중대" value={(summary.data?.bySeverity.CRITICAL ?? 0) + (summary.data?.bySeverity.MAJOR ?? 0)} tone="warn" />
        <Stat label="평균 복구(분)" value={summary.data?.avgResolutionMinutes ?? "-"} />
      </div>
      <div className="flex gap-1 border-b border-[var(--eum-line)] pb-1">
        <button className={`rounded-t px-3 py-1.5 text-[11.5px] ${tab === "events" ? "bg-[#10293b] font-bold text-[var(--eum-accent)]" : "text-[var(--eum-muted)]"}`} onClick={() => setTab("events")}>알람 이벤트</button>
        <button className={`rounded-t px-3 py-1.5 text-[11.5px] ${tab === "rules" ? "bg-[#10293b] font-bold text-[var(--eum-accent)]" : "text-[var(--eum-muted)]"}`} onClick={() => setTab("rules")}>알람 규칙</button>
      </div>
      {tab === "events" ? (
        <Card title="알람 이벤트" actions={
          <select className="eum-input max-w-[200px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ACTIVE,ACK,ASSIGNED">활성 전체</option>
            <option value="ACTIVE">발생</option>
            <option value="ACK">확인</option>
            <option value="ASSIGNED">담당 배정</option>
            <option value="RESOLVED">복구</option>
            <option value="">전체</option>
          </select>
        }>
          {events.loading ? <Spinner /> : (events.data?.items.length ?? 0) === 0 ? <Empty>조건에 맞는 알람이 없습니다.</Empty> : (
            <div className="eum-scroll max-h-[62vh]">
              <table className="eum-table">
                <thead><tr><th>발생</th><th>등급</th><th>알람</th><th>대상</th><th>상태</th><th>횟수</th><th>담당</th><th>조치</th></tr></thead>
                <tbody>
                  {events.data!.items.map((event) => (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap text-[10.5px]">{formatDate(event.occurredAt)}</td>
                      <td><Badge value={event.severity} /></td>
                      <td><div className="text-[11.5px] font-semibold">{event.title}</div><div className="text-[10px] text-[var(--eum-muted)]">{event.message}</div></td>
                      <td className="text-[10.5px]">{event.site.name}<div className="text-[var(--eum-muted)]">{event.device?.name ?? event.tag?.name ?? "-"}</div></td>
                      <td><Badge value={event.status} /></td>
                      <td>{event.repeatCount}</td>
                      <td className="text-[10.5px]">{event.assignedTo?.name ?? "-"}</td>
                      <td>
                        <div className="flex gap-2">
                          {["ACTIVE", "ACK", "ASSIGNED"].includes(event.status) ? <button className="text-[10.5px] text-[var(--eum-accent)]" onClick={() => void act(event.id, "ack")}>확인</button> : null}
                          {event.status !== "RESOLVED" ? <button className="text-[10.5px] text-[#5fe09a]" onClick={() => void act(event.id, "resolve")}>복구</button> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <ResourceManager
          title="알람 규칙"
          endpoint="alarm-rules"
          createLabel="규칙 등록"
          columns={[
            { key: "name", label: "규칙명" },
            { key: "targetType", label: "대상" },
            { key: "condition", label: "조건" },
            { key: "threshold", label: "임계값" },
            { key: "severity", label: "등급", render: (row) => <Badge value={String(row.severity)} /> },
            { key: "enabled", label: "사용", render: (row) => <Badge value={row.enabled ? "GOOD" : "UNKNOWN"} label={row.enabled ? "사용" : "중지"} /> },
            { key: "channels", label: "통보", render: (row) => Array.isArray(row.channels) ? (row.channels as string[]).join(", ") : "-" },
          ]}
          fields={[
            { key: "name", label: "규칙명", required: true },
            { key: "siteId", label: "사업장", type: "select", optionsFrom: { endpoint: "sites", valueKey: "id", labelKey: "name" } },
            { key: "targetType", label: "대상 유형", type: "select", options: [{ value: "TAG", label: "태그" }, { value: "DEVICE", label: "장치" }, { value: "ASSET", label: "설비" }], defaultValue: "TAG" },
            { key: "targetId", label: "대상 ID", help: "태그 ID는 태그 관리에서 확인" },
            { key: "condition", label: "조건", type: "select", options: [{ value: "GT", label: "초과" }, { value: "LT", label: "미만" }, { value: "OUT_OF_RANGE", label: "범위 밖" }, { value: "EQ", label: "같음" }, { value: "NE", label: "다름" }, { value: "COMM_FAIL", label: "통신장애" }], defaultValue: "GT" },
            { key: "threshold", label: "임계값", type: "number" },
            { key: "threshold2", label: "임계값2", type: "number" },
            { key: "severity", label: "등급", type: "select", options: [{ value: "INFO", label: "정보" }, { value: "WARNING", label: "경고" }, { value: "MAJOR", label: "중대" }, { value: "CRITICAL", label: "치명" }], defaultValue: "WARNING" },
            { key: "enabled", label: "사용", type: "checkbox", defaultValue: true },
          ]}
          updateEndpoint={(row) => `alarm-rules/${String(row.id)}`}
        />
      )}
    </div>
  );
}
