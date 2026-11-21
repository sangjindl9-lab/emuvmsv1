"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

const NAV = [
  { group: "관제", items: [
    { href: "/", label: "통합 대시보드", icon: "▦" },
    { href: "/scada", label: "전력 통합 관제", icon: "⚡" },
    { href: "/diagrams", label: "단선결선도", icon: "⌁" },
    { href: "/alarms", label: "알람·장애관리", icon: "◉" },
    { href: "/control", label: "원격제어", icon: "⏻" },
  ]},
  { group: "설비·통신", items: [
    { href: "/sites", label: "사업장 관리", icon: "🏢" },
    { href: "/buildings", label: "건물·설비 관리", icon: "🏬" },
    { href: "/devices", label: "PLC/RTU 관리", icon: "🖧" },
    { href: "/gateways", label: "통신변환기 관리", icon: "⇄" },
    { href: "/protocols", label: "프로토콜 센터", icon: "📚" },
    { href: "/tags", label: "태그·레지스터 관리", icon: "🏷" },
  ]},
  { group: "검침·분석", items: [
    { href: "/metering", label: "원격검침", icon: "🔢" },
    { href: "/tariffs", label: "전기요금 관리", icon: "₩" },
    { href: "/energy", label: "에너지 분석", icon: "📈" },
    { href: "/reports", label: "보고서", icon: "🗎" },
  ]},
  { group: "시스템", items: [
    { href: "/users", label: "사용자·권한관리", icon: "👥" },
    { href: "/settings", label: "시스템 설정", icon: "⚙" },
    { href: "/licenses", label: "라이선스 관리", icon: "🔑" },
  ]},
];

export default function AppShell({
  user,
  tenant,
  children,
}: {
  user: { name: string; email: string; role: string; permissions: string[] };
  tenant: { name: string; plan: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const logout = async () => {
    await api("auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[240px] transform border-r border-[var(--eum-line)] bg-[#081420] transition-transform lg:static lg:translate-x-0 no-print ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-[var(--eum-line)] px-4">
          <span className="grid h-8 w-8 place-items-center rounded bg-gradient-to-br from-[#23c3e6] to-[#0d6f8c] text-[15px] font-black text-[#04121a]">E</span>
          <div>
            <div className="text-[13px] font-extrabold leading-tight tracking-wide">EUM BMS PRO</div>
            <div className="text-[9.5px] tracking-[0.16em] text-[var(--eum-muted)]">이음BMS · 통합 전력제어</div>
          </div>
        </div>
        <nav className="h-[calc(100vh-56px)] overflow-y-auto px-2 py-3">
          {NAV.map((group) => (
            <div key={group.group} className="mb-3">
              <div className="px-2 pb-1 text-[9.5px] font-bold tracking-[0.18em] text-[#4f6b81]">{group.group}</div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`mb-0.5 flex items-center gap-2 rounded px-2 py-2 text-[12.5px] ${
                    isActive(item.href)
                      ? "bg-[#10293b] font-semibold text-[var(--eum-accent)]"
                      : "text-[#a9c0d2] hover:bg-[#0e1e2c] hover:text-white"
                  }`}
                >
                  <span className="w-4 text-center text-[12px]">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {open ? <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} /> : null}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-[var(--eum-line)] bg-[#081420]/95 px-4 backdrop-blur no-print">
          <div className="flex items-center gap-3">
            <button className="text-[18px] text-[var(--eum-muted)] lg:hidden" onClick={() => setOpen(true)}>
              ☰
            </button>
            <div className="text-[12.5px] text-[var(--eum-muted)]">
              {tenant.name} <span className="mx-1 text-[#33506a]">/</span> <span className="text-[var(--eum-text)]">{tenant.plan}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            <span className="hidden text-[var(--eum-muted)] sm:inline">{user.name}</span>
            <span className="rounded border border-[var(--eum-line)] px-2 py-0.5 text-[10px] text-[var(--eum-accent)]">{user.role}</span>
            <button className="eum-btn px-2 py-1 text-[11px]" onClick={logout}>
              로그아웃
            </button>
          </div>
        </header>
        <main className="min-h-[calc(100vh-56px)] p-3 sm:p-4 lg:p-5">{children}</main>
      </div>
    </div>
  );
}
