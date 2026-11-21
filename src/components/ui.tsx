"use client";

import { type ReactNode } from "react";

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`eum-panel ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--eum-line)] px-4 py-3">
          <h2 className="text-[13.5px] font-bold tracking-wide text-[var(--eum-text)]">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, unit, tone = "default", hint }: { label: string; value: ReactNode; unit?: string; tone?: "default" | "good" | "warn" | "bad" | "accent"; hint?: string }) {
  const colors: Record<string, string> = {
    default: "text-[var(--eum-text)]",
    good: "text-[var(--eum-good)]",
    warn: "text-[var(--eum-warn)]",
    bad: "text-[var(--eum-bad)]",
    accent: "text-[var(--eum-accent)]",
  };
  return (
    <div className="eum-panel px-4 py-3">
      <div className="text-[11px] text-[var(--eum-muted)]">{label}</div>
      <div className={`mt-1 text-[22px] font-bold leading-tight ${colors[tone]}`}>
        {value}
        {unit ? <span className="ml-1 text-[11px] font-normal text-[var(--eum-muted)]">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1 text-[10.5px] text-[var(--eum-muted)]">{hint}</div> : null}
    </div>
  );
}

const badgeColors: Record<string, string> = {
  GOOD: "bg-[#10331f] text-[#5fe09a] border-[#235c3a]",
  UNKNOWN: "bg-[#1b2430] text-[#8fa6ba] border-[#2c3d4f]",
  UNCERTAIN: "bg-[#382d10] text-[#f0c966] border-[#6b5520]",
  STALE: "bg-[#2c2438] text-[#c4a8e0] border-[#4d3a63]",
  BAD: "bg-[#3a1717] text-[#ff9d93] border-[#6e2a2a]",
  DISABLED: "bg-[#1b2430] text-[#61788c] border-[#2c3d4f]",
  ACTIVE: "bg-[#3a1717] text-[#ff9d93] border-[#6e2a2a]",
  ACK: "bg-[#382d10] text-[#f0c966] border-[#6b5520]",
  ASSIGNED: "bg-[#102b3a] text-[#7fd6ef] border-[#1f5268]",
  RESOLVED: "bg-[#10331f] text-[#5fe09a] border-[#235c3a]",
  CRITICAL: "bg-[#3a1717] text-[#ff9d93] border-[#6e2a2a]",
  MAJOR: "bg-[#3a2417] text-[#ffbb8a] border-[#6e3a20]",
  WARNING: "bg-[#382d10] text-[#f0c966] border-[#6b5520]",
  INFO: "bg-[#102b3a] text-[#7fd6ef] border-[#1f5268]",
  APPROVED: "bg-[#10331f] text-[#5fe09a] border-[#235c3a]",
  REJECTED: "bg-[#3a1717] text-[#ff9d93] border-[#6e2a2a]",
  REQUESTED: "bg-[#382d10] text-[#f0c966] border-[#6b5520]",
  SENT: "bg-[#102b3a] text-[#7fd6ef] border-[#1f5268]",
  SENDING: "bg-[#102b3a] text-[#7fd6ef] border-[#1f5268]",
  FEEDBACK_OK: "bg-[#10331f] text-[#5fe09a] border-[#235c3a]",
  FEEDBACK_FAIL: "bg-[#3a1717] text-[#ff9d93] border-[#6e2a2a]",
  UNCERTAIN_STATE: "bg-[#2c2438] text-[#c4a8e0] border-[#4d3a63]",
  SIMULATOR_VERIFIED: "bg-[#10331f] text-[#5fe09a] border-[#235c3a]",
  FIELD_VERIFIED: "bg-[#0d3b2e] text-[#8ff5cf] border-[#1b6b52]",
  DOC_VERIFIED: "bg-[#102b3a] text-[#7fd6ef] border-[#1f5268]",
  IN_DEVELOPMENT: "bg-[#382d10] text-[#f0c966] border-[#6b5520]",
  PARTIAL: "bg-[#2c2438] text-[#c4a8e0] border-[#4d3a63]",
  UNSUPPORTED: "bg-[#1b2430] text-[#61788c] border-[#2c3d4f]",
  DRAFT: "bg-[#1b2430] text-[#8fa6ba] border-[#2c3d4f]",
  PENDING_REVIEW: "bg-[#382d10] text-[#f0c966] border-[#6b5520]",
  CLOSED: "bg-[#10331f] text-[#5fe09a] border-[#235c3a]",
  OPEN: "bg-[#102b3a] text-[#7fd6ef] border-[#1f5268]",
  TRIP: "bg-[#3a1717] text-[#ff9d93] border-[#6e2a2a]",
  NORMAL: "bg-[#10331f] text-[#5fe09a] border-[#235c3a]",
};

export function Badge({ value, label }: { value: string | null | undefined; label?: string }) {
  const key = (value ?? "UNKNOWN").toUpperCase();
  const cls = badgeColors[key] ?? "bg-[#1b2430] text-[#8fa6ba] border-[#2c3d4f]";
  return <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10.5px] font-semibold ${cls}`}>{label ?? value ?? "-"}</span>;
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const cls = variant === "primary" ? "eum-btn eum-btn-primary" : variant === "danger" ? "eum-btn eum-btn-danger" : "eum-btn";
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold text-[var(--eum-muted)]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[10.5px] text-[var(--eum-muted)]">{hint}</span> : null}
    </label>
  );
}

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/65 p-4 pt-10" onClick={onClose}>
      <div className={`eum-panel w-full ${wide ? "max-w-5xl" : "max-w-2xl"}`} onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-[var(--eum-line)] px-4 py-3">
          <h3 className="text-[13.5px] font-bold">{title}</h3>
          <button className="text-[var(--eum-muted)] hover:text-white" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="max-h-[78vh] overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "success" | "warn"; children: ReactNode }) {
  const colors = {
    info: "border-[#1f5268] bg-[#0d2231] text-[#8fd8ee]",
    error: "border-[#6e2a2a] bg-[#2c1313] text-[#ffb0a8]",
    success: "border-[#235c3a] bg-[#0e2a1b] text-[#8fe8b6]",
    warn: "border-[#6b5520] bg-[#2e2610] text-[#f3d68a]",
  };
  return <div className={`rounded-md border px-3 py-2 text-[12px] ${colors[kind]}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-[12px] text-[var(--eum-muted)]">{children}</div>;
}

export function Spinner() {
  return <div className="py-8 text-center text-[12px] text-[var(--eum-muted)]">불러오는 중…</div>;
}
