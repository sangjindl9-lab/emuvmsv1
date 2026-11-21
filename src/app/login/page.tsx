"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("auth/login", { method: "POST", body: { email, password } });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#06101a] p-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-[#23c3e6] to-[#0d6f8c] text-[20px] font-black text-[#04121a]">E</div>
          <h1 className="text-[18px] font-extrabold tracking-wide">EUM BMS PRO</h1>
          <p className="mt-1 text-[11.5px] text-[var(--eum-muted)]">빌딩·아파트·산업시설 통합 전력제어 및 원격검침 플랫폼</p>
        </div>
        <div className="eum-panel p-5">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-[var(--eum-muted)]">이메일</span>
              <input className="eum-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@eumbms.local" autoComplete="username" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-[var(--eum-muted)]">비밀번호</span>
              <input className="eum-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            </label>
            {error ? <div className="rounded border border-[#6e2a2a] bg-[#2c1313] px-3 py-2 text-[11.5px] text-[#ffb0a8]">{error}</div> : null}
            <button className="eum-btn eum-btn-primary w-full justify-center py-2.5" type="submit" disabled={busy}>
              {busy ? "로그인 중…" : "로그인"}
            </button>
          </form>
          <div className="mt-4 border-t border-[var(--eum-line)] pt-3 text-[10.5px] leading-relaxed text-[var(--eum-muted)]">
            초기 관리자 계정은 시드 설치 시 생성됩니다.
            <br />운영 배포 후 반드시 비밀번호를 변경하세요.
          </div>
        </div>
      </div>
    </div>
  );
}
