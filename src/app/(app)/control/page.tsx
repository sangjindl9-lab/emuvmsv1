"use client";

import { useState } from "react";
import { api, formatDate, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, Empty, Field, Modal, Spinner, Stat } from "@/components/ui";

type Asset = { id: string; name: string; code: string; assetType: string; status: string; breakerState: string; remoteControlEnabled: boolean; controlReady: boolean; site: { name: string }; interlocks: Record<string, unknown> | null };
type Command = { id: string; command: string; status: string; reason: string | null; createdAt: string; errorMessage: string | null; finalState: string | null; asset: { name: string; assetType: string; breakerState: string; status: string }; approvals: { decision: string; approver: { name: string } | null }[]; requestedBy: { name: string } | null; requiredApprovals: number };

const ALLOWED: Record<string, string[]> = {
  BREAKER: ["OPEN", "CLOSE"], VCB: ["OPEN", "CLOSE"], ACB: ["OPEN", "CLOSE"], MCCB: ["OPEN", "CLOSE"],
  ATS: ["OPEN", "CLOSE", "START", "STOP"], GENERATOR: ["START", "STOP"], UPS: ["START", "STOP"],
  PV_INVERTER: ["START", "STOP", "SETPOINT"], ESS: ["START", "STOP", "SETPOINT"], EV_CHARGER: ["START", "STOP", "SETPOINT"],
};

const COMMAND_LABEL: Record<string, string> = { OPEN: "개방(OPEN)", CLOSE: "투입(CLOSE)", START: "기동(START)", STOP: "정지(STOP)", SETPOINT: "설정값 변경", LOAD_SHED: "부하차단" };

export default function ControlPage() {
  const assets = useApi<{ items: Asset[]; counts: { total: number; remoteEnabled: number; controlReady: number; trip: number } }>("control/assets");
  const commands = useApi<{ items: Command[] }>("control/commands", { pollMs: 10000 });
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [command, setCommand] = useState("OPEN");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ kind: "info" | "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Command | null>(null);

  const request = async () => {
    if (!selectedAsset) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ command: { id: string; status: string } }>("control/commands", {
        method: "POST",
        body: { assetId: selectedAsset.id, command, reason, idempotencyKey: `web_${Date.now()}_${selectedAsset.id.slice(-4)}`, requiredApprovals: 2 },
      });
      setMessage({ kind: "success", text: `제어 요청이 접수되었습니다(상태 ${result.command.status}). 승인자 2명의 승인이 필요합니다.` });
      setSelectedAsset(null);
      setReason("");
      await commands.reload();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: string, body?: unknown) => {
    setMessage(null);
    try {
      const result = await api<{ status?: string }>(`control/commands/${id}/${action}`, { method: "POST", body: body ?? {} });
      setMessage({ kind: "success", text: `${action} 완료${result?.status ? ` (상태: ${result.status})` : ""}` });
      await commands.reload();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-extrabold tracking-wide">원격제어</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">권한 → 이중 승인 → Local/Remote → 인터록 → 전송 → 피드백 → 최종 상태 → 감사로그 순서로만 실행됩니다. 통신 실패 시 자동 재전송하지 않습니다.</p>
      </div>
      {message ? <Alert kind={message.kind}>{message.text}</Alert> : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="전체 설비" value={assets.data?.counts.total ?? 0} />
        <Stat label="원격 허용" value={assets.data?.counts.remoteEnabled ?? 0} tone="accent" />
        <Stat label="제어 준비 완료" value={assets.data?.counts.controlReady ?? 0} tone="good" />
        <Stat label="트립 설비" value={assets.data?.counts.trip ?? 0} tone={(assets.data?.counts.trip ?? 0) > 0 ? "bad" : "default"} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="제어 대상 설비" className="xl:col-span-1">
          {assets.loading ? <Spinner /> : (assets.data?.items.length ?? 0) === 0 ? <Empty>등록된 설비가 없습니다. 전력설비 자산을 먼저 등록하세요.</Empty> : (
            <div className="max-h-[52vh] space-y-1 overflow-auto">
              {assets.data!.items.map((asset) => (
                <button key={asset.id} className="block w-full rounded border border-[var(--eum-line)] bg-[#0a1723] px-2 py-1.5 text-left hover:border-[var(--eum-accent)]" onClick={() => { setSelectedAsset(asset); setCommand(ALLOWED[asset.assetType]?.[0] ?? "OPEN"); }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11.5px]">{asset.name}</span>
                    <Badge value={asset.controlReady ? "APPROVED" : asset.remoteControlEnabled ? "PENDING_REVIEW" : "UNSUPPORTED"} label={asset.controlReady ? "준비" : asset.remoteControlEnabled ? "매핑필요" : "원격불가"} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[9.5px] text-[var(--eum-muted)]"><span>{asset.assetType} · {asset.site.name}</span><span>{asset.breakerState}</span></div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card title="제어 명령 이력" className="xl:col-span-2">
          {commands.loading ? <Spinner /> : (commands.data?.items.length ?? 0) === 0 ? <Empty>제어 이력이 없습니다.</Empty> : (
            <div className="eum-scroll max-h-[52vh]">
              <table className="eum-table">
                <thead><tr><th>요청</th><th>설비</th><th>명령</th><th>상태</th><th>승인</th><th>최종</th><th>동작</th></tr></thead>
                <tbody>
                  {commands.data!.items.map((item) => {
                    const approvals = item.approvals.filter((a) => a.decision === "APPROVED").length;
                    return (
                      <tr key={item.id}>
                        <td className="text-[10px]">{formatDate(item.createdAt)}<div className="text-[var(--eum-muted)]">{item.requestedBy?.name ?? "-"}</div></td>
                        <td className="text-[11px]">{item.asset.name}<div className="text-[9.5px] text-[var(--eum-muted)]">{item.asset.assetType} · {item.asset.breakerState}</div></td>
                        <td className="text-[11px]">{COMMAND_LABEL[item.command] ?? item.command}</td>
                        <td><Badge value={item.status} /></td>
                        <td className="text-[10.5px]">{approvals}/{item.requiredApprovals}</td>
                        <td className="text-[10px]">{item.finalState ?? "-"}</td>
                        <td>
                          <div className="flex flex-col gap-1">
                            <button className="text-left text-[10.5px] text-[var(--eum-accent)]" onClick={() => setDetail(item)}>상세</button>
                            {["REQUESTED", "APPROVED"].includes(item.status) ? <button className="text-left text-[10.5px] text-[#f0c966]" onClick={() => void act(item.id, "approve", { decision: "APPROVED" })}>승인</button> : null}
                            {item.status === "APPROVED" ? <button className="text-left text-[10.5px] text-[#5fe09a]" onClick={() => void act(item.id, "execute")}>실행</button> : null}
                            {["REQUESTED", "APPROVED"].includes(item.status) ? <button className="text-left text-[10.5px] text-[#ff9d93]" onClick={() => void act(item.id, "cancel")}>취소</button> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {selectedAsset ? (
        <Modal title={`제어 요청 — ${selectedAsset.name}`} onClose={() => setSelectedAsset(null)}>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-[11.5px]">
              <div>설비 유형: <b>{selectedAsset.assetType}</b></div>
              <div>현재 차단기: <b>{selectedAsset.breakerState}</b></div>
              <div>원격 허용: <b>{selectedAsset.remoteControlEnabled ? "예" : "아니오"}</b></div>
              <div>제어 매핑: <b>{selectedAsset.controlReady ? "준비됨" : "없음"}</b></div>
            </div>
            {!selectedAsset.controlReady ? <Alert kind="warn">제어 태그 매핑이 없어 실행 단계에서 차단됩니다. PATCH assets/:id 의 interlocks.control.tagId 를 설정하세요.</Alert> : null}
            <Field label="명령">
              <select className="eum-input" value={command} onChange={(e) => setCommand(e.target.value)}>
                {(ALLOWED[selectedAsset.assetType] ?? []).map((cmd) => <option key={cmd} value={cmd}>{COMMAND_LABEL[cmd] ?? cmd}</option>)}
              </select>
            </Field>
            <Field label="사유"><textarea className="eum-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="정기 점검을 위한 차단기 개방" /></Field>
            <Alert kind="warn">요청자 본인은 승인할 수 없습니다. 다른 승인자 계정으로 승인 2회 후 실행하세요.</Alert>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setSelectedAsset(null)}>취소</Button>
              <Button variant="primary" onClick={() => void request()} disabled={busy || !selectedAsset.remoteControlEnabled}>제어 요청</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {detail ? (
        <Modal title={`제어 상세 — ${detail.asset.name}`} onClose={() => setDetail(null)} wide>
          <div className="space-y-2 text-[11.5px]">
            <div className="grid grid-cols-2 gap-2">
              <div>명령: <b>{detail.command}</b></div>
              <div>상태: <Badge value={detail.status} /></div>
              <div>요청자: {detail.requestedBy?.name ?? "-"}</div>
              <div>요청시각: {formatDate(detail.createdAt)}</div>
              <div>최종상태: {detail.finalState ?? "-"}</div>
              <div>오류: {detail.errorMessage ?? "-"}</div>
            </div>
            <div>사유: {detail.reason ?? "-"}</div>
            <div>
              <div className="mb-1 font-semibold">승인 ({detail.approvals.length}/{detail.requiredApprovals})</div>
              {detail.approvals.length === 0 ? <div className="text-[var(--eum-muted)]">승인 없음</div> : detail.approvals.map((a, index) => <div key={index}>{a.approver?.name ?? "-"} — {a.decision}</div>)}
            </div>
            <div className="rounded border border-[var(--eum-line)] bg-[#0a1723] p-2 text-[10.5px] text-[var(--eum-muted)]">
              실행 전 확인: Local/Remote 상태, 설비 트립 여부, 인터록 조건, 명령 중복 여부. 피드백 미확인 시 UNCERTAIN으로 종료되고 현장 확인 알람이 발생합니다.
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
