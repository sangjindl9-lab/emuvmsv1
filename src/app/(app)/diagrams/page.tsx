"use client";

import Link from "next/link";
import { useState } from "react";
import { api, formatDate, useApi } from "@/lib/client";
import { Alert, Button, Card, Empty, Field, Spinner } from "@/components/ui";

type Diagram = { id: string; name: string; description: string | null; version: number; updatedAt: string; site: { name: string }; _count: { elements: number } };

export default function DiagramsPage() {
  const { data, error, loading, reload } = useApi<{ items: Diagram[] }>("diagrams");
  const sites = useApi<{ items: { id: string; name: string }[] }>("sites");
  const [form, setForm] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const create = async () => {
    setMessage(null);
    try {
      const diagram = await api<{ id: string }>("diagrams", { method: "POST", body: { siteId: form.siteId, name: form.name, description: form.description } });
      setMessage("도면이 생성되었습니다. 목록에서 열어 편집하세요.");
      setForm({});
      await reload();
      if (diagram.id) window.location.href = `/diagrams/${diagram.id}`;
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-extrabold tracking-wide">단선결선도</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">SVG 기반 단선결선도에 전력설비 심벌을 배치하고 태그·자산을 연결하면 실시간 계측값과 차단기 상태가 표시됩니다.</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="새 도면">
          <div className="space-y-2">
            <Field label="사업장 *"><select className="eum-input" value={form.siteId ?? ""} onChange={(e) => setForm({ ...form, siteId: e.target.value })}><option value="">선택</option>{(sites.data?.items ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="도면명 *"><input className="eum-input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="101동 수변전 계통도" /></Field>
            <Field label="설명"><input className="eum-input" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            {message ? <Alert kind="info">{message}</Alert> : null}
            <Button variant="primary" onClick={() => void create()} disabled={!form.siteId || !form.name}>도면 생성</Button>
          </div>
        </Card>
        <Card title="도면 목록" className="xl:col-span-2">
          {error ? <Alert kind="error">{error}</Alert> : null}
          {loading ? <Spinner /> : (data?.items.length ?? 0) === 0 ? <Empty>도면이 없습니다.</Empty> : (
            <table className="eum-table">
              <thead><tr><th>도면명</th><th>사업장</th><th>요소</th><th>버전</th><th>수정</th></tr></thead>
              <tbody>
                {data!.items.map((diagram) => (
                  <tr key={diagram.id}>
                    <td><Link className="text-[var(--eum-accent)] hover:underline" href={`/diagrams/${diagram.id}`}>{diagram.name}</Link><div className="text-[10px] text-[var(--eum-muted)]">{diagram.description}</div></td>
                    <td>{diagram.site.name}</td>
                    <td>{diagram._count.elements}</td>
                    <td>v{diagram.version}</td>
                    <td className="text-[10.5px]">{formatDate(diagram.updatedAt)}</td>
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
