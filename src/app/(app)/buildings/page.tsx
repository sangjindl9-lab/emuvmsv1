"use client";

import { ResourceManager } from "@/components/ResourceManager";
import { Badge } from "@/components/ui";

export default function BuildingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-extrabold tracking-wide">건물·설비 관리</h1>
        <p className="mt-0.5 text-[11.5px] text-[var(--eum-muted)]">사업장 아래 건물, 층, 세대(호실)를 등록합니다. 세대는 원격검침과 관리비 연계의 기준 단위입니다.</p>
      </div>
      <ResourceManager
        title="건물"
        endpoint="buildings"
        createLabel="건물 등록"
        columns={[
          { key: "site", label: "사업장", render: (row) => String((row.site as { name?: string })?.name ?? "-") },
          { key: "code", label: "코드", width: "100px" },
          { key: "name", label: "건물명" },
          { key: "purpose", label: "용도", render: (row) => <Badge value="UNKNOWN" label={String(row.purpose ?? "-")} /> },
          { key: "floorsCount", label: "층수" },
          { key: "units", label: "세대", render: (row) => String((row._count as { units?: number })?.units ?? 0) },
        ]}
        fields={[
          { key: "siteId", label: "사업장", type: "select", required: true, optionsFrom: { endpoint: "sites", valueKey: "id", labelKey: "name" } },
          { key: "code", label: "건물 코드", required: true, placeholder: "B-101" },
          { key: "name", label: "건물명", required: true },
          { key: "purpose", label: "용도", type: "select", options: [
            { value: "APARTMENT", label: "공동주택" },
            { value: "OFFICE", label: "업무시설" },
            { value: "FACTORY", label: "공장" },
            { value: "MIXED", label: "복합" },
          ], defaultValue: "APARTMENT" },
          { key: "floorsCount", label: "지상 층수", type: "number" },
          { key: "areaM2", label: "연면적(㎡)", type: "number" },
        ]}
        deleteEndpoint={() => null}
      />
      <ResourceManager
        title="세대 / 호실"
        endpoint="units"
        createLabel="세대 등록"
        columns={[
          { key: "building", label: "건물", render: (row) => String((row.building as { name?: string })?.name ?? "-") },
          { key: "dong", label: "동" },
          { key: "ho", label: "호" },
          { key: "name", label: "표시명" },
          { key: "occupancy", label: "입주", render: (row) => <Badge value={row.occupancy === "OCCUPIED" ? "GOOD" : "UNKNOWN"} label={row.occupancy === "OCCUPIED" ? "입주" : "공실"} /> },
          { key: "areaM2", label: "면적(㎡)" },
          { key: "readings", label: "검침", render: (row) => String((row._count as { readings?: number })?.readings ?? 0) },
        ]}
        fields={[
          { key: "buildingId", label: "건물", type: "select", required: true, optionsFrom: { endpoint: "buildings", valueKey: "id", labelKey: "name" } },
          { key: "dong", label: "동", placeholder: "101" },
          { key: "ho", label: "호", required: true, placeholder: "1203" },
          { key: "name", label: "표시명" },
          { key: "areaM2", label: "전용면적(㎡)", type: "number" },
          { key: "occupancy", label: "입주 상태", type: "select", options: [{ value: "OCCUPIED", label: "입주" }, { value: "VACANT", label: "공실" }], defaultValue: "OCCUPIED" },
        ]}
        updateEndpoint={(row) => `units/${String(row.id)}`}
      />
    </div>
  );
}
