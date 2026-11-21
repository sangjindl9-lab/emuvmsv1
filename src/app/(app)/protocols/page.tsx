"use client";

import { useEffect, useMemo, useState } from "react";
import { api, formatDate, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, Empty, Field, Modal, Spinner } from "@/components/ui";

type CatalogEntry = { key: string; name: string; family: string; transport: string; standard: string; docsUrl: string; docTitle: string; license: string; status: string; verifiedNote: string; features: string[] };
type Document = { id: string; title: string; docType: string; status: string; createdAt: string; manufacturer: { name: string } | null; analysis: { registers?: unknown[]; confidence?: number; warnings?: string[] } | null };
type Profile = { id: string; name: string; protocolKey: string; transport: string; source: string; reviewStatus: string; confidence: number | null; notes: string | null; registerMap: unknown; document: { title: string } | null; manufacturer: { name: string } | null };
type Driver = { id: string; key: string; name: string; protocolFamily: string; transport: string; status: string; versions: { id: string; version: string; status: string; createdAt: string }[] };
type Manufacturer = { id: string; name: string; models: { id: string; name: string; category: string; protocols: string[] }[] };

const TABS = [
  { key: "catalog", label: "프로토콜 카탈로그" },
  { key: "way1", label: "자동등록 ① 기존 프로토콜" },
  { key: "way2", label: "자동등록 ② 매뉴얼 업로드" },
  { key: "way3", label: "자동등록 ③ 사용자 정의 프레임" },
  { key: "drivers", label: "드라이버 버전" },
  { key: "compat", label: "호환성 검증표" },
];

export default function ProtocolsPage() {
  const [tab, setTab] = useState("catalog");
  const catalog = useApi<{ catalog: CatalogEntry[]; drivers: Driver[] }>("protocols/catalog");
  const manufacturers = useApi<{ items: Manufacturer[] }>("manufacturers");
  const documents = useApi<{ items: Document[] }>("protocols/documents");
  const profiles = useApi<{ items: Profile[] }>("protocols/profiles");
  const compat = useApi<{ rows: (CatalogEntry & { implementation: string; lastChecked: string; customDriver: string | null })[]; fieldVerifiedCount: number }>("protocols/compatibility");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-extrabold tracking-wide">프로토콜 센터</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">공개 문서 기반 카탈로그와 3가지 자동등록 절차를 제공합니다. 실장비 검증 전 항목은 검증 완료로 표시하지 않습니다.</p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-[var(--eum-line)] pb-1">
        {TABS.map((item) => (
          <button key={item.key} className={`rounded-t px-3 py-1.5 text-[11.5px] ${tab === item.key ? "bg-[#10293b] font-bold text-[var(--eum-accent)]" : "text-[var(--eum-muted)] hover:text-white"}`} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === "catalog" && <CatalogTab data={catalog.data} loading={catalog.loading} error={catalog.error} />}
      {tab === "way1" && <Way1 manufacturers={manufacturers.data?.items ?? []} catalog={catalog.data?.catalog ?? []} />}
      {tab === "way2" && <Way2 documents={documents.data?.items ?? []} profiles={profiles.data?.items ?? []} reload={() => { void documents.reload(); void profiles.reload(); }} />}
      {tab === "way3" && <Way3 />}
      {tab === "drivers" && <DriversTab drivers={catalog.data?.drivers ?? []} reload={catalog.reload} />}
      {tab === "compat" && <CompatTab data={compat.data} loading={compat.loading} />}
    </div>
  );
}

function CatalogTab({ data, loading, error }: { data?: { catalog: CatalogEntry[]; drivers: Driver[] } | null; loading: boolean; error: string | null }) {
  const [filter, setFilter] = useState("");
  const rows = (data?.catalog ?? []).filter((entry) => !filter || JSON.stringify(entry).toLowerCase().includes(filter.toLowerCase()));
  return (
    <Card title={`프로토콜 카탈로그 (${rows.length})`} actions={<input className="eum-input max-w-[220px]" placeholder="프로토콜·제조사 검색" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
      {error ? <Alert kind="error">{error}</Alert> : null}
      {loading ? <Spinner /> : (
        <div className="eum-scroll max-h-[65vh]">
          <table className="eum-table">
            <thead><tr><th>프로토콜</th><th>전송</th><th>구분</th><th>구현 상태</th><th>검증 내용</th><th>공개 문서</th><th>라이선스</th></tr></thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.key}>
                  <td><div className="font-semibold">{entry.name}</div><div className="text-[10px] text-[var(--eum-muted)]">{entry.family}</div></td>
                  <td className="text-[10.5px]">{entry.transport}</td>
                  <td className="text-[10.5px]">{entry.standard}</td>
                  <td><Badge value={entry.status} /></td>
                  <td className="max-w-[380px] text-[10.5px] leading-relaxed text-[var(--eum-muted)]">{entry.verifiedNote}</td>
                  <td><a className="text-[10.5px] text-[var(--eum-accent)] hover:underline" href={entry.docsUrl} target="_blank" rel="noreferrer">{entry.docTitle.slice(0, 42)}…</a></td>
                  <td className="max-w-[160px] text-[10px] text-[var(--eum-muted)]">{entry.license}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Way1({ manufacturers, catalog }: { manufacturers: Manufacturer[]; catalog: CatalogEntry[] }) {
  const [form, setForm] = useState<Record<string, string>>({ transport: "TCP", slaveId: "1", port: "502", address: "0" });
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedManufacturer = manufacturers.find((m) => m.id === form.manufacturerId);

  const test = async () => {
    setError(null);
    setResult(null);
    try {
      const response = await api<{ ok: boolean; detail: string }>("protocols/test-connection", {
        method: "POST",
        body: { host: form.host, port: Number(form.port), unitId: Number(form.slaveId), protocolKey: form.protocolKey, address: Number(form.address), timeoutMs: 2000 },
      });
      setResult(`${response.ok ? "✅ 성공" : "❌ 실패"}: ${response.detail}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const save = async () => {
    setError(null);
    try {
      await api("protocols/profiles/from-catalog", {
        method: "POST",
        body: {
          manufacturer: selectedManufacturer?.name,
          model: form.model,
          protocolKey: form.protocolKey,
          transport: form.transport,
          host: form.host,
          port: Number(form.port),
          slaveId: Number(form.slaveId),
        },
      });
      setResult("프로파일이 저장되었습니다. PLC/RTU 관리에서 장치로 등록할 수 있습니다.");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="① 기존 프로토콜 선택 → 연결 시험 → 태그 등록">
        <div className="space-y-2">
          <Field label="제조사"><select className="eum-input" value={form.manufacturerId ?? ""} onChange={(e) => setForm({ ...form, manufacturerId: e.target.value, model: "", protocolKey: "" })}><option value="">선택</option>{manufacturers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
          <Field label="모델"><select className="eum-input" value={form.model ?? ""} onChange={(e) => setForm({ ...form, model: e.target.value })}><option value="">선택</option>{(selectedManufacturer?.models ?? []).map((m) => <option key={m.id} value={m.name}>{m.name} ({m.category})</option>)}</select></Field>
          <Field label="프로토콜"><select className="eum-input" value={form.protocolKey ?? ""} onChange={(e) => setForm({ ...form, protocolKey: e.target.value })}><option value="">선택</option>{catalog.map((p) => <option key={p.key} value={p.key}>{p.name} — {p.status}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="IP / 호스트"><input className="eum-input" value={form.host ?? ""} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="127.0.0.1" /></Field>
            <Field label="포트"><input className="eum-input" type="number" value={form.port ?? ""} onChange={(e) => setForm({ ...form, port: e.target.value })} /></Field>
            <Field label="Slave ID"><input className="eum-input" type="number" value={form.slaveId ?? ""} onChange={(e) => setForm({ ...form, slaveId: e.target.value })} /></Field>
            <Field label="시험 주소"><input className="eum-input" type="number" value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          </div>
          {result ? <Alert kind="info">{result}</Alert> : null}
          {error ? <Alert kind="error">{error}</Alert> : null}
          <div className="flex gap-2">
            <Button onClick={() => void test()} disabled={!form.host || !form.port}>연결 시험</Button>
            <Button variant="primary" onClick={() => void save()} disabled={!form.manufacturerId || !form.protocolKey}>프로파일 저장</Button>
          </div>
          <p className="text-[10.5px] text-[var(--eum-muted)]">연결 시험은 실제 TCP 소켓으로 Modbus 읽기를 수행합니다. 실패하면 IP·포트·Slave ID·방화벽을 확인하세요.</p>
        </div>
      </Card>
      <Card title="선택한 프로토콜 정보">
        {form.protocolKey ? (() => {
          const entry = catalog.find((p) => p.key === form.protocolKey);
          if (!entry) return <Empty>카탈로그에 없는 프로토콜입니다.</Empty>;
          return (
            <div className="space-y-2 text-[11.5px]">
              <div className="flex items-center gap-2"><span className="font-bold">{entry.name}</span><Badge value={entry.status} /></div>
              <p className="text-[var(--eum-muted)]">{entry.verifiedNote}</p>
              <a className="block text-[10.5px] text-[var(--eum-accent)]" href={entry.docsUrl} target="_blank" rel="noreferrer">{entry.docTitle}</a>
              <div className="text-[10.5px] text-[var(--eum-muted)]">라이선스: {entry.license}</div>
              <div className="flex flex-wrap gap-1">{entry.features.map((f) => <span key={f} className="rounded border border-[var(--eum-line)] px-1.5 py-0.5 text-[10px]">{f}</span>)}</div>
            </div>
          );
        })() : <Empty>프로토콜을 선택하세요.</Empty>}
      </Card>
    </div>
  );
}

function Way2({ documents, profiles, reload }: { documents: Document[]; profiles: Profile[]; reload: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ analysis: { manufacturerGuess: string | null; modelGuess: string | null; protocolGuess: string | null; driverType: string; registers: unknown[]; confidence: number; warnings: string[]; notes: string[] }; extraction: { notes: string[]; textPreview: string; pages: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Profile | null>(null);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await api<typeof result>("protocols/documents/upload", { method: "POST", formData });
      setResult(response);
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const review = async (profile: Profile, approve: boolean) => {
    await api(`protocols/profiles/${profile.id}/review`, { method: "POST", body: { approve } });
    reload();
  };

  return (
    <div className="space-y-4">
      <Card title="② 제조사 매뉴얼 업로드 → 자동 분석 → 관리자 승인">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Field label="지원 파일" hint="PDF · DOCX · XLSX · CSV · JSON · XML · TXT · ZIP (40MB 이하)">
              <input className="eum-input" type="file" accept=".pdf,.docx,.xlsx,.csv,.json,.xml,.txt,.md,.zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            <Button variant="primary" onClick={() => void upload()} disabled={!file || busy}>{busy ? "분석 중…" : "업로드 및 분석"}</Button>
            {error ? <Alert kind="error">{error}</Alert> : null}
            <p className="text-[10.5px] leading-relaxed text-[var(--eum-muted)]">분석 결과는 초안(PENDING_REVIEW)이며, 승인 전에는 실제 수집에 사용되지 않습니다. AI/규칙 분석 결과를 검증 없이 실행 코드로 적용하지 않습니다.</p>
          </div>
          {result ? (
            <div className="space-y-1 rounded border border-[var(--eum-line)] bg-[#0a1723] p-3 text-[11px]">
              <div><b>제조사 추정:</b> {result.analysis.manufacturerGuess ?? "미확인"}</div>
              <div><b>모델 추정:</b> {result.analysis.modelGuess ?? "미확인"}</div>
              <div><b>프로토콜 추정:</b> {result.analysis.protocolGuess ?? "미확인"} <Badge value={result.analysis.driverType === "VENDOR_DRIVER_REQUIRED" ? "IN_DEVELOPMENT" : "SIMULATOR_VERIFIED"} label={result.analysis.driverType} /></div>
              <div><b>추출 레지스터:</b> {result.analysis.registers.length}개</div>
              <div><b>신뢰도:</b> {Math.round(result.analysis.confidence * 100)}%</div>
              <ul className="list-disc pl-4 text-[10.5px] text-[#f0c966]">{result.analysis.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              <details className="text-[10px] text-[var(--eum-muted)]"><summary>추출 텍스트 미리보기</summary><pre className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap">{result.extraction.textPreview}</pre></details>
            </div>
          ) : null}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="분석 문서">
          {documents.length === 0 ? <Empty>업로드된 문서가 없습니다.</Empty> : (
            <table className="eum-table"><thead><tr><th>문서</th><th>형식</th><th>상태</th><th>등록</th></tr></thead><tbody>
              {documents.map((doc) => <tr key={doc.id}><td>{doc.title}<div className="text-[10px] text-[var(--eum-muted)]">{doc.manufacturer?.name ?? "제조사 미확인"}</div></td><td>{doc.docType}</td><td><Badge value={doc.status} /></td><td className="text-[10px]">{formatDate(doc.createdAt)}</td></tr>)}
            </tbody></table>
          )}
        </Card>
        <Card title="검토 대기 프로파일">
          {profiles.length === 0 ? <Empty>프로파일이 없습니다.</Empty> : (
            <div className="max-h-[380px] space-y-1.5 overflow-auto">
              {profiles.map((profile) => (
                <div key={profile.id} className="rounded border border-[var(--eum-line)] bg-[#0a1723] px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2"><span className="text-[11.5px] font-semibold">{profile.name}</span><Badge value={profile.reviewStatus} /></div>
                  <div className="mt-0.5 text-[10px] text-[var(--eum-muted)]">{profile.protocolKey} · {profile.source} · 신뢰도 {profile.confidence !== null ? Math.round(profile.confidence * 100) + "%" : "-"} · 레지스터 {Array.isArray(profile.registerMap) ? profile.registerMap.length : 0}개</div>
                  <div className="mt-1 flex gap-2">
                    <button className="text-[10.5px] text-[var(--eum-accent)]" onClick={() => setDetail(profile)}>상세</button>
                    {profile.reviewStatus === "PENDING_REVIEW" ? (
                      <>
                        <button className="text-[10.5px] text-[#5fe09a]" onClick={() => void review(profile, true)}>승인</button>
                        <button className="text-[10.5px] text-[#ff9d93]" onClick={() => void review(profile, false)}>반려</button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      {detail ? (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          <pre className="eum-scroll max-h-[60vh] rounded bg-[#06101a] p-3 font-mono text-[10.5px]">{JSON.stringify(detail.registerMap, null, 2)}</pre>
          <div className="mt-2 text-[11px] text-[var(--eum-muted)]">{detail.notes}</div>
        </Modal>
      ) : null}
    </div>
  );
}

function Way3() {
  const [template, setTemplate] = useState<string>("");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("15020");
  const [address, setAddress] = useState("0");
  const [count, setCount] = useState("1");
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ template: unknown }>("protocols/frame/default").then((response) => setTemplate(JSON.stringify(response.template, null, 2)));
  }, []);

  const parsed = useMemo(() => {
    try { return JSON.parse(template); } catch { return null; }
  }, [template]);

  const doPreview = async () => {
    setError(null);
    setResult(null);
    try {
      const response = await api<{ requestHex: string }>("protocols/frame/preview", { method: "POST", body: { template: parsed, slaveId: 1, address: Number(address), count: Number(count) } });
      setPreview(response.requestHex);
    } catch (err) { setError((err as Error).message); }
  };

  const doTest = async () => {
    setError(null);
    setResult(null);
    try {
      const response = await api<{ requestHex: string; responseHex: string; value: number | string; rttMs: number }>("protocols/frame/test", { method: "POST", body: { template: parsed, host, port: Number(port), slaveId: 1, address: Number(address), count: Number(count) } });
      setPreview(response.requestHex);
      setResult(`응답 ${response.responseHex} → 값 ${response.value} (${response.rttMs}ms)`);
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="③ 사용자 정의 프로토콜 프레임 편집기" actions={<Button onClick={() => void doPreview()}>요청 미리보기</Button>}>
        <div className="space-y-2">
          <textarea className="eum-input min-h-[340px] font-mono text-[10.5px]" value={template} onChange={(e) => setTemplate(e.target.value)} spellCheck={false} />
          <div className="grid grid-cols-4 gap-2">
            <Field label="IP"><input className="eum-input" value={host} onChange={(e) => setHost(e.target.value)} /></Field>
            <Field label="포트"><input className="eum-input" type="number" value={port} onChange={(e) => setPort(e.target.value)} /></Field>
            <Field label="주소"><input className="eum-input" type="number" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
            <Field label="수량"><input className="eum-input" type="number" value={count} onChange={(e) => setCount(e.target.value)} /></Field>
          </div>
          {preview ? <Alert kind="info">요청 HEX: <code className="font-mono">{preview}</code></Alert> : null}
          {result ? <Alert kind="success">{result}</Alert> : null}
          {error ? <Alert kind="error">{error}</Alert> : null}
          <Button variant="primary" onClick={() => void doTest()} disabled={!parsed}>실제 TCP 송수신 시험</Button>
        </div>
      </Card>
      <Card title="프레임 정의 안내">
        <div className="space-y-2 text-[11px] leading-relaxed text-[var(--eum-muted)]">
          <p><b className="text-[var(--eum-text)]">request[]</b> 필드는 순서대로 조립됩니다. 지원: HEX, ASCII, U8, U16BE, U16LE, ADDRESS, COUNT, PAYLOAD, PAYLOAD_LENGTH, TOTAL_LENGTH, CRC16, LRC, SUM8, XOR8.</p>
          <p><b className="text-[var(--eum-text)]">response</b>는 header, valueOffset, valueLength(또는 lengthField), dataType, byteOrder, wordOrder, scale, offsetValue, transform(수식)으로 응답 값을 해석합니다.</p>
          <p>변환식은 <code>raw * 0.1</code>처럼 제한된 수식만 허용되며 임의 스크립트는 실행하지 않습니다.</p>
          <p>예: <code>{`{"request":[{"kind":"HEX","value":"AA55"},{"kind":"U8","value":1},{"kind":"U8","value":3},{"kind":"ADDRESS"},{"kind":"COUNT"},{"kind":"CRC16"}],"response":{"header":"AA55","minLength":6,"maxLength":512,"valueOffset":4,"valueLength":2,"dataType":"UINT16","byteOrder":"AB","wordOrder":"ABCD","scale":1,"offsetValue":0},"timeoutMs":1500,"retries":1}`}</code></p>
          <p className="text-[10.5px]">버전관리·롤백은 드라이버 버전 탭에서 관리합니다. 새 프레임은 먼저 시험 검증 후 운영 장치에 적용하세요.</p>
        </div>
      </Card>
    </div>
  );
}

function DriversTab({ drivers, reload }: { drivers: Driver[]; reload: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const addVersion = async (driver: Driver) => {
    const version = prompt("새 버전 번호", "1.0.0");
    if (!version) return;
    try {
      await api(`protocols/drivers/${driver.id}/versions`, { method: "POST", body: { version, changelog: "관리자 등록" } });
      reload();
    } catch (err) { setError((err as Error).message); }
  };
  const rollback = async (driver: Driver, versionId: string) => {
    try {
      await api(`protocols/drivers/${driver.id}/rollback`, { method: "POST", body: { versionId } });
      reload();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <Card title="드라이버 버전 관리">
      {error ? <Alert kind="error">{error}</Alert> : null}
      {drivers.length === 0 ? <Empty>등록된 커스텀 드라이버가 없습니다. 기본 내장 드라이버는 카탈로그에서 상태를 확인하세요.</Empty> : (
        <div className="space-y-2">
          {drivers.map((driver) => (
            <div key={driver.id} className="rounded border border-[var(--eum-line)] bg-[#0a1723] p-3">
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-semibold">{driver.name} <span className="font-mono text-[10px] text-[var(--eum-muted)]">{driver.key}</span> <Badge value={driver.status} /></div>
                <Button onClick={() => void addVersion(driver)}>+ 버전</Button>
              </div>
              <table className="eum-table mt-2">
                <thead><tr><th>버전</th><th>상태</th><th>등록</th><th>동작</th></tr></thead>
                <tbody>
                  {driver.versions.map((version) => (
                    <tr key={version.id}>
                      <td className="font-mono">{version.version}</td>
                      <td><Badge value={version.status === "ACTIVE" ? "APPROVED" : "DRAFT"} label={version.status} /></td>
                      <td className="text-[10px]">{formatDate(version.createdAt)}</td>
                      <td><button className="text-[10.5px] text-[var(--eum-accent)]" onClick={() => void rollback(driver, version.id)}>이 버전으로 롤백</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CompatTab({ data, loading }: { data?: { rows: (CatalogEntry & { implementation: string; lastChecked: string; customDriver: string | null })[]; fieldVerifiedCount: number } | null; loading: boolean }) {
  return (
    <Card title="제조사 호환성 검증표" actions={<span className="text-[10.5px] text-[var(--eum-muted)]">확인일 2026-11-22 · 실장비 검증 {data?.fieldVerifiedCount ?? 0}건</span>}>
      {loading ? <Spinner /> : (
        <div className="eum-scroll max-h-[65vh]">
          <table className="eum-table">
            <thead><tr><th>프로토콜</th><th>구현 상태</th><th>검증 근거</th><th>커스텀 드라이버</th><th>문서</th><th>확인일</th></tr></thead>
            <tbody>
              {(data?.rows ?? []).map((row) => (
                <tr key={row.key}>
                  <td>{row.name}</td>
                  <td><Badge value={row.implementation} /></td>
                  <td className="max-w-[420px] text-[10.5px] text-[var(--eum-muted)]">{row.verifiedNote}</td>
                  <td>{row.customDriver ? <Badge value={row.customDriver} /> : "-"}</td>
                  <td><a className="text-[10px] text-[var(--eum-accent)]" href={row.docsUrl} target="_blank" rel="noreferrer">문서</a></td>
                  <td className="text-[10px]">{row.lastChecked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
