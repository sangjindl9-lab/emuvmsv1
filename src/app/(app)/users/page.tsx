"use client";

import { ResourceManager } from "@/components/ResourceManager";
import { Badge } from "@/components/ui";

export default function UsersPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-extrabold tracking-wide">사용자·권한관리</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">최고관리자·관리자·운전원·승인자·조회자 역할을 부여합니다. 중요 제어는 요청자와 다른 승인자가 필요합니다.</p>
      </div>
      <ResourceManager
        title="사용자"
        endpoint="users"
        createLabel="사용자 추가"
        columns={[
          { key: "name", label: "이름" },
          { key: "email", label: "이메일" },
          { key: "roleName", label: "역할", render: (row) => <Badge value="UNKNOWN" label={String(row.roleName ?? row.role ?? "-")} /> },
          { key: "phone", label: "연락처" },
          { key: "status", label: "상태", render: (row) => <Badge value={row.status === "ACTIVE" ? "GOOD" : "UNKNOWN"} label={String(row.status)} /> },
          { key: "lastLoginAt", label: "최근 로그인", render: (row) => row.lastLoginAt ? new Date(String(row.lastLoginAt)).toLocaleString("ko-KR") : "-" },
        ]}
        fields={[
          { key: "name", label: "이름", required: true },
          { key: "email", label: "이메일", required: true },
          { key: "role", label: "역할", type: "select", required: true, options: [
            { value: "SUPER_ADMIN", label: "최고관리자 (전체)" },
            { value: "ADMIN", label: "관리자" },
            { value: "OPERATOR", label: "운전원" },
            { value: "APPROVER", label: "승인자" },
            { value: "VIEWER", label: "조회자" },
          ], defaultValue: "OPERATOR" },
          { key: "phone", label: "연락처" },
          { key: "password", label: "비밀번호", type: "password", required: true, help: "8자 이상. 수정 시 비워두면 기존 비밀번호가 유지됩니다." },
          { key: "status", label: "상태", type: "select", options: [{ value: "ACTIVE", label: "활성" }, { value: "SUSPENDED", label: "정지" }], defaultValue: "ACTIVE", hiddenOnEdit: false },
        ]}
        updateEndpoint={(row) => `users/${String(row.id)}`}
      />
      <div className="eum-panel p-4 text-[11px] leading-relaxed text-[var(--eum-muted)]">
        <b className="text-[var(--eum-text)]">권한 정책</b>
        <ul className="mt-1 list-disc pl-5">
          <li>원격제어 요청: control.request (관리자·운전원)</li>
          <li>원격제어 승인·실행: control.approve (승인자·최고관리자) — 요청자 본인은 승인 불가</li>
          <li>프로토콜·드라이버 변경: protocol.manage</li>
          <li>요금표 적용: tariff.manage / 감사로그: audit.view</li>
        </ul>
      </div>
    </div>
  );
}
