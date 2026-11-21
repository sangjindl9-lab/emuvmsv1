import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();

const REQUIRED_TABLES = [
  "tenants", "users", "roles", "sites", "buildings", "floors", "units", "manufacturers", "device_models",
  "protocol_documents", "protocol_drivers", "driver_versions", "device_profiles", "gateways", "devices",
  "device_connections", "serial_buses", "device_tags", "tag_mappings", "tag_readings", "meter_readings",
  "meter_adjustments", "tariff_versions", "electrical_assets", "diagrams", "diagram_elements", "alarm_rules",
  "alarm_events", "control_commands", "control_approvals", "control_feedback", "audit_logs", "licenses",
];

describe("PostgreSQL 스키마 / 시드", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("마스터 프롬프트 14절의 33개 테이블이 모두 존재한다", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const present = new Set(rows.map((row) => row.table_name));
    const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
    expect(missing, `누락 테이블: ${missing.join(", ")}`).toEqual([]);
    expect(REQUIRED_TABLES.length).toBe(33);
  });

  it("시드 데이터가 테넌트·장치·태그·자산·요금표를 만든다", async () => {
    const tenant = await prisma.tenant.findUnique({ where: { code: "EUM" } });
    expect(tenant).not.toBeNull();
    const counts = await Promise.all([
      prisma.device.count({ where: { tenantId: tenant!.id } }),
      prisma.deviceTag.count({ where: { tenantId: tenant!.id } }),
      prisma.electricalAsset.count({ where: { tenantId: tenant!.id } }),
      prisma.tariffVersion.count({ where: { tenantId: tenant!.id, status: "ACTIVE" } }),
      prisma.license.count({ where: { tenantId: tenant!.id, status: "ACTIVE" } }),
    ]);
    expect(counts[0]).toBeGreaterThanOrEqual(2);
    expect(counts[1]).toBeGreaterThanOrEqual(10);
    expect(counts[2]).toBeGreaterThanOrEqual(6);
    expect(counts[3]).toBe(1);
    expect(counts[4]).toBe(1);
  });

  it("모든 장치·태그는 tenant_id / site_id 로 격리된다", async () => {
    const devices = await prisma.device.findMany({ select: { tenantId: true, siteId: true } });
    expect(devices.every((d) => Boolean(d.tenantId) && Boolean(d.siteId))).toBe(true);
    const tags = await prisma.deviceTag.findMany({ select: { tenantId: true, siteId: true } });
    expect(tags.every((t) => Boolean(t.tenantId) && Boolean(t.siteId))).toBe(true);
  });
});
