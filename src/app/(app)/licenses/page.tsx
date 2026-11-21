"use client";

import { useState } from "react";
import { api, formatDate, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, Empty, Field, Spinner } from "@/components/ui";

type License = { id: string; licenseKey: string; edition: string; maxSites: number; maxDevices: number; maxTags: number; issuedAt: string; expiresAt: string | null; status: string; features: string[] };

export default function LicensesPage() {
  const { data, error, loading, reload } = useApi<{ items: License[] }>("licenses");
  const [form, setForm] = useState<Record<string, string>>({ edition: "STANDARD", maxSites: "1", maxDevices: "100", maxTags: "10000" });
  const [message, setMessage] = useState<string | null>(null);

  const issue = async () => {
    setMessage(null);
    try {
      await api("licenses", {
        method: "POST",
        body: { edition: form.edition, maxSites: Number(form.maxSites), maxDevices: Number(form.maxDevices), maxTags: Number(form.maxTags), expiresAt: form.expiresAt || null, hardwareId: form.hardwareId },
      });
      setMessage("라이선스가 발급되었습니다.");
      await reload();
    } catch (err) { setMessage((err as Error).message); }
  };

  const revoke = async (license: License) => {
    if (!confirm(`${license.licenseKey} 라이선스를 폐기하시겠습니까?`)) return;
    await api(`licenses/${license.id}/revoke`, { method: "POST" });
    await reload();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-extrabold tracking-wide">라이선스 관리</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">에디션별 사업장·장치·태그 한도를 관리합니다. 만료/폐기 시 신규 수집·제어가 제한되도록 운영 정책을 설정하세요.</p>
      </div>
      {message ? <Alert kind="info">{message}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="라이선스 발급">
          <div className="space-y-2">
            <Field label="에디션">
              <select className="eum-input" value={form.edition} onChange={(e) => setForm({ ...form, edition: e.target.value })}>
                <option value="TRIAL">TRIAL (30일)</option>
                <option value="STANDARD">STANDARD</option>
                <option value="PROFESSIONAL">PROFESSIONAL</option>
                <option value="ENTERPRISE">ENTERPRISE</option>
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="사업장"><input className="eum-input" type="number" value={form.maxSites} onChange={(e) => setForm({ ...form, maxSites: e.target.value })} /></Field>
              <Field label="장치"><input className="eum-input" type="number" value={form.maxDevices} onChange={(e) => setForm({ ...form, maxDevices: e.target.value })} /></Field>
              <Field label="태그"><input className="eum-input" type="number" value={form.maxTags} onChange={(e) => setForm({ ...form, maxTags: e.target.value })} /></Field>
            </div>
            <Field label="만료일"><input className="eum-input" type="date" value={form.expiresAt ?? ""} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field>
            <Field label="하드웨어 ID (선택)"><input className="eum-input" value={form.hardwareId ?? ""} onChange={(e) => setForm({ ...form, hardwareId: e.target.value })} /></Field>
            <Button variant="primary" onClick={() => void issue()}>발급</Button>
          </div>
        </Card>
        <Card title="발급된 라이선스" className="lg:col-span-2">
          {loading ? <Spinner /> : (data?.items.length ?? 0) === 0 ? <Empty>발급된 라이선스가 없습니다.</Empty> : (
            <table className="eum-table">
              <thead><tr><th>키</th><th>에디션</th><th>한도</th><th>발급</th><th>만료</th><th>상태</th><th>동작</th></tr></thead>
              <tbody>
                {data!.items.map((license) => (
                  <tr key={license.id}>
                    <td className="font-mono text-[10px]">{license.licenseKey}</td>
                    <td>{license.edition}</td>
                    <td className="text-[10.5px]">S{license.maxSites} / D{license.maxDevices} / T{license.maxTags}</td>
                    <td className="text-[10px]">{formatDate(license.issuedAt)}</td>
                    <td className="text-[10px]">{license.expiresAt ? formatDate(license.expiresAt) : "무기한"}</td>
                    <td><Badge value={license.status === "ACTIVE" ? "APPROVED" : "UNKNOWN"} label={license.status} /></td>
                    <td>{license.status === "ACTIVE" ? <button className="text-[10.5px] text-[#ff9d93]" onClick={() => void revoke(license)}>폐기</button> : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
