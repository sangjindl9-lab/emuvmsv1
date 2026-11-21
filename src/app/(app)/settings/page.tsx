"use client";

import { useEffect, useState } from "react";
import { api, formatDate, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, Field, Spinner } from "@/components/ui";

type Settings = {
  tenant: { id: string; name: string; code: string; businessNo: string | null; address: string | null; phone: string | null; plan: string };
  counts: { sites: number; devices: number; tags: number; readings: number };
  license: { licenseKey: string; edition: string; expiresAt: string | null; maxDevices: number; maxTags: number; status: string } | null;
  collector: { intervalMs: number; enabled: boolean };
  version: string;
};

export default function SettingsPage() {
  const { data, error, loading, reload } = useApi<Settings>("settings");
  const [form, setForm] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [collector, setCollector] = useState<{ lastRun: unknown; readingsLast15m: number; devicesByQuality: { quality: string; count: number }[] } | null>(null);

  useEffect(() => {
    if (data?.tenant) {
      setForm({ name: data.tenant.name, address: data.tenant.address ?? "", phone: data.tenant.phone ?? "" });
    }
  }, [data]);

  const save = async () => {
    try {
      await api("settings", { method: "PATCH", body: form });
      setMessage("저장되었습니다.");
      await reload();
    } catch (err) { setMessage((err as Error).message); }
  };

  const checkCollector = async () => {
    try {
      setCollector(await api("collector/status"));
    } catch (err) { setMessage((err as Error).message); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-extrabold tracking-wide">시스템 설정</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">고객사 정보·라이선스·수집 엔진 상태와 운영 설정을 확인합니다.</p>
      </div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      {loading ? <Spinner /> : data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="고객사 정보">
            <div className="space-y-2">
              <Field label="고객사명"><input className="eum-input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="주소"><input className="eum-input" value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
              <Field label="대표 연락처"><input className="eum-input" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-2 text-[11.5px] text-[var(--eum-muted)]">
                <div>코드: <b className="text-[var(--eum-text)]">{data.tenant.code}</b></div>
                <div>플랜: <b className="text-[var(--eum-text)]">{data.tenant.plan}</b></div>
                <div>사업장: {data.counts.sites}</div>
                <div>장치: {data.counts.devices}</div>
                <div>태그: {data.counts.tags.toLocaleString()}</div>
                <div>시계열: {data.counts.readings.toLocaleString()}</div>
              </div>
              {message ? <Alert kind="info">{message}</Alert> : null}
              <Button variant="primary" onClick={() => void save()}>저장</Button>
            </div>
          </Card>
          <Card title="라이선스">
            {!data.license ? <div className="text-[11.5px] text-[var(--eum-muted)]">활성 라이선스가 없습니다. 라이선스 관리에서 발급하세요.</div> : (
              <div className="space-y-1 text-[11.5px]">
                <div className="flex justify-between"><span>에디션</span><b>{data.license.edition}</b></div>
                <div className="flex justify-between"><span>키</span><span className="font-mono text-[10px]">{data.license.licenseKey}</span></div>
                <div className="flex justify-between"><span>만료</span><span>{data.license.expiresAt ? formatDate(data.license.expiresAt) : "무기한"}</span></div>
                <div className="flex justify-between"><span>최대 장치</span><span>{data.license.maxDevices}</span></div>
                <div className="flex justify-between"><span>최대 태그</span><span>{data.license.maxTags}</span></div>
                <div className="flex justify-between"><span>상태</span><Badge value={data.license.status === "ACTIVE" ? "APPROVED" : "UNKNOWN"} label={data.license.status} /></div>
              </div>
            )}
          </Card>
          <Card title="수집 엔진">
            <div className="space-y-2 text-[11.5px]">
              <div className="flex justify-between"><span>서버 내장 수집기</span><Badge value={data.collector.enabled ? "GOOD" : "UNKNOWN"} label={data.collector.enabled ? "사용" : "사용 안 함"} /></div>
              <div className="flex justify-between"><span>주기</span><span>{data.collector.intervalMs}ms</span></div>
              <div className="flex justify-between"><span>앱 버전</span><span>EUMBMS {data.version}</span></div>
              <Button onClick={() => void checkCollector()}>상태 확인</Button>
              {collector ? (
                <div className="rounded border border-[var(--eum-line)] p-2 text-[10.5px]">
                  <div>최근 15분 수집: {collector.readingsLast15m}건</div>
                  <div>장치 품질: {collector.devicesByQuality.map((q) => `${q.quality} ${q.count}`).join(" · ")}</div>
                </div>
              ) : null}
              <p className="text-[10px] leading-relaxed text-[var(--eum-muted)]">운영 환경에서는 <code>ENABLE_COLLECTOR=1</code> 대신 현장 Edge Gateway를 사용하는 것을 권장합니다. 서버 내장 수집기는 점검·데모용입니다.</p>
            </div>
          </Card>
          <Card title="운영 정보">
            <div className="space-y-1 text-[11px] leading-relaxed text-[var(--eum-muted)]">
              <p>· 데이터베이스: PostgreSQL 18 (TimescaleDB 선택 적용)</p>
              <p>· 백업: <code>scripts/backup.sh</code> / 복구: <code>scripts/restore.sh</code></p>
              <p>· 설치: <code>scripts/install-linux.sh</code>, <code>scripts/install-windows.ps1</code></p>
              <p>· API 문서: <code>docs/API.md</code> · 운영자 매뉴얼: <code>docs/OPERATOR-MANUAL.md</code></p>
              <p>· 실장비 검증표: <code>docs/COMPATIBILITY.md</code> (실측과 문서 확인 구분)</p>
              <p>· 알려진 제한사항: <code>docs/LIMITATIONS.md</code></p>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
