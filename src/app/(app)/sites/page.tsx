"use client";

import { ResourceManager } from "@/components/ResourceManager";
import { Badge } from "@/components/ui";

export default function SitesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-extrabold tracking-wide">사업장 관리</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">고객사 → 사업장 → 건물 → 동 → 층 → 호실 → 계량기 계층의 최상위 단위입니다. 모든 장치·태그·검침은 사업장 기준으로 격리됩니다.</p>
      </div>
      <ResourceManager
        title="사업장"
        endpoint="sites"
        createLabel="사업장 등록"
        exportPath={undefined}
        columns={[
          { key: "code", label: "코드", width: "110px", render: (row) => <span className="font-mono text-[11px]">{String(row.code)}</span> },
          { key: "name", label: "사업장명" },
          { key: "address", label: "주소" },
          { key: "contractPowerKw", label: "계약전력(kW)", render: (row) => String(row.contractPowerKw ?? "-") },
          { key: "status", label: "상태", render: (row) => <Badge value={row.status === "ACTIVE" ? "GOOD" : "UNKNOWN"} label={String(row.status)} /> },
          { key: "counts", label: "건물/장치/게이트웨이", render: (row) => {
            const counts = row._count as { buildings?: number; devices?: number; gateways?: number } | undefined;
            return `${counts?.buildings ?? 0} / ${counts?.devices ?? 0} / ${counts?.gateways ?? 0}`;
          }},
        ]}
        fields={[
          { key: "code", label: "사업장 코드", required: true, placeholder: "SITE-001" },
          { key: "name", label: "사업장명", required: true, placeholder: "원주 본사" },
          { key: "address", label: "주소", full: true },
          { key: "contractPowerKw", label: "계약전력(kW)", type: "number" },
          { key: "status", label: "상태", type: "select", options: [{ value: "ACTIVE", label: "운영" }, { value: "CLOSED", label: "종료" }], defaultValue: "ACTIVE" },
        ]}
        deleteEndpoint={() => null}
      />
    </div>
  );
}
