import { audit, HttpError, requirePermission } from "@/lib/auth";
import prisma from "@/lib/db";
import { toCsv, parseCsv } from "@/lib/csv";
import { calculateBill, detectAnomalies, monthlyUsageSeries, type TariffConfig } from "@/modules/metering/billing";
import { num, optNum, str, type RouteDef } from "@/server/api";

async function tagEnergyValue(tenantId: string, deviceId: string): Promise<number | null> {
  const tag = await prisma.deviceTag.findFirst({
    where: { tenantId, deviceId, standardKey: { in: ["ENERGY_IMPORT", "ENERGY"] } },
  });
  return tag?.lastValue ?? null;
}

function csvResponse(csv: string, fileName: string): Response {
  return new Response("\uFEFF" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="eumbms-export.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}

export const routes: RouteDef[] = [
  {
    method: "GET",
    pattern: "meter-readings",
    handler: async ({ session, query }) => {
      const siteId = query.get("siteId") ?? undefined;
      const buildingId = query.get("buildingId") ?? undefined;
      const unitId = query.get("unitId") ?? undefined;
      const period = query.get("period") ?? undefined;
      const meterKind = query.get("meterKind") ?? undefined;
      const limit = Math.min(Number(query.get("limit") ?? 500), 5000);
      const items = await prisma.meterReading.findMany({
        where: {
          tenantId: session.tid,
          ...(siteId ? { siteId } : {}),
          ...(buildingId ? { buildingId } : {}),
          ...(unitId ? { unitId } : {}),
          ...(period ? { periodKey: period } : {}),
          ...(meterKind ? { meterKind } : {}),
        },
        include: {
          unit: { select: { id: true, dong: true, ho: true, name: true } },
          building: { select: { id: true, name: true } },
          device: { select: { id: true, name: true } },
          adjustments: true,
        },
        orderBy: { readingAt: "desc" },
        take: limit,
      });
      return { items, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "meter-readings",
    handler: async ({ session, body, req }) => {
      await requirePermission("metering.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const siteId = str(data, "siteId");
      const site = await prisma.site.findFirst({ where: { id: siteId, tenantId: session.tid } });
      if (!site) throw new HttpError(404, "사업장을 찾을 수 없습니다.");
      const readingAt = new Date(str(data, "readingAt"));
      const value = num(data, "value");
      const previous = await prisma.meterReading.findFirst({
        where: { tenantId: session.tid, deviceId: str(data, "deviceId", false) || undefined, unitId: str(data, "unitId", false) || undefined },
        orderBy: { readingAt: "desc" },
      });
      const reading = await prisma.meterReading.create({
        data: {
          tenantId: session.tid,
          siteId,
          buildingId: str(data, "buildingId", false) || null,
          unitId: str(data, "unitId", false) || null,
          deviceId: str(data, "deviceId", false) || null,
          meterKind: str(data, "meterKind", false) || "ELECTRICITY",
          readingAt,
          value,
          previousValue: previous?.value ?? null,
          source: str(data, "source", false) || "MANUAL",
          periodKey: readingAt.toISOString().slice(0, 7),
          note: str(data, "note", false) || null,
        },
      });
      await audit(session, "METER_READING_CREATE", "meter_reading", reading.id, null, { value, readingAt }, req);
      return reading;
    },
  },
  {
    method: "POST",
    pattern: "meter-readings/import",
    handler: async ({ session, body, req }) => {
      await requirePermission("metering.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const rows = parseCsv(str(data, "csv"));
      const sites = await prisma.site.findMany({ where: { tenantId: session.tid } });
      let created = 0;
      const errors: { row: number; error: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const site = sites.find((s) => s.code === row.siteCode);
          if (!site) throw new Error(`사업장 없음: ${row.siteCode}`);
          const unit = row.dong && row.ho
            ? await prisma.unit.findFirst({ where: { tenantId: session.tid, dong: row.dong, ho: row.ho } })
            : null;
          const readingAt = new Date(row.readingAt);
          if (Number.isNaN(readingAt.getTime())) throw new Error("readingAt 날짜 오류");
          await prisma.meterReading.create({
            data: {
              tenantId: session.tid,
              siteId: site.id,
              buildingId: unit?.buildingId,
              unitId: unit?.id,
              meterKind: row.meterKind || "ELECTRICITY",
              readingAt,
              value: Number(row.value),
              source: "IMPORT",
              periodKey: readingAt.toISOString().slice(0, 7),
            },
          });
          created += 1;
        } catch (error) {
          errors.push({ row: i + 2, error: (error as Error).message });
        }
      }
      await audit(session, "METER_READING_IMPORT", "meter_reading", null, null, { created, errors: errors.length }, req);
      return { created, errors };
    },
  },
  {
    method: "POST",
    pattern: "meter-readings/collect",
    handler: async ({ session, body, req }) => {
      await requirePermission("metering.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const deviceId = str(data, "deviceId");
      const device = await prisma.device.findFirst({ where: { id: deviceId, tenantId: session.tid } });
      if (!device) throw new HttpError(404, "계량기를 찾을 수 없습니다.");
      const value = await tagEnergyValue(session.tid, device.id);
      if (value === null) throw new HttpError(409, "누적 전력량 태그(ENERGY_IMPORT) 값이 없습니다. 먼저 통신 수집을 실행하세요.");
      const previous = await prisma.meterReading.findFirst({
        where: { tenantId: session.tid, deviceId: device.id },
        orderBy: { readingAt: "desc" },
      });
      if (previous && value < previous.value) {
        await prisma.meterAdjustment.create({
          data: {
            tenantId: session.tid,
            deviceId: device.id,
            kind: "ROLLOVER",
            deltaValue: value - previous.value,
            reason: "누적값 감소(계량기 롤오버/교체) 자동 감지",
            approvedById: session.uid,
          },
        });
      }
      return prisma.meterReading.create({
        data: {
          tenantId: session.tid,
          siteId: device.siteId,
          buildingId: device.buildingId,
          unitId: device.unitId,
          deviceId: device.id,
          meterKind: str(data, "meterKind", false) || "ELECTRICITY",
          readingAt: new Date(),
          value,
          previousValue: previous?.value ?? null,
          source: "AUTO",
          periodKey: new Date().toISOString().slice(0, 7),
        },
      });
    },
  },
  {
    method: "GET",
    pattern: "meter-readings/missing",
    handler: async ({ session, query }) => {
      const period = query.get("period") ?? new Date().toISOString().slice(0, 7);
      const siteId = query.get("siteId") ?? undefined;
      const units = await prisma.unit.findMany({
        where: { tenantId: session.tid, ...(siteId ? { building: { siteId } } : {}) },
        include: { readings: { where: { periodKey: period } }, building: true },
      });
      const missing = units.filter((u) => u.readings.length === 0).map((u) => ({
        unitId: u.id,
        dong: u.dong,
        ho: u.ho,
        building: u.building.name,
        occupancy: u.occupancy,
      }));
      return { period, missing, missingCount: missing.length, totalUnits: units.length };
    },
  },
  {
    method: "POST",
    pattern: "meter-adjustments",
    handler: async ({ session, body, req }) => {
      await requirePermission("metering.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const adjustment = await prisma.meterAdjustment.create({
        data: {
          tenantId: session.tid,
          meterReadingId: str(data, "meterReadingId", false) || null,
          deviceId: str(data, "deviceId", false) || null,
          unitId: str(data, "unitId", false) || null,
          kind: str(data, "kind", false) || "CORRECTION",
          deltaValue: num(data, "deltaValue"),
          reason: str(data, "reason"),
          approvedById: session.uid,
        },
      });
      await audit(session, "METER_ADJUST", "meter_adjustment", adjustment.id, null, { delta: adjustment.deltaValue, reason: adjustment.reason }, req);
      return adjustment;
    },
  },
  {
    method: "GET",
    pattern: "tariffs",
    handler: async ({ session }) => {
      const items = await prisma.tariffVersion.findMany({ where: { tenantId: session.tid }, orderBy: [{ name: "asc" }, { version: "desc" }] });
      return { items, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "tariffs",
    handler: async ({ session, body, req }) => {
      await requirePermission("tariff.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const name = str(data, "name");
      const last = await prisma.tariffVersion.findFirst({ where: { tenantId: session.tid, name }, orderBy: { version: "desc" } });
      const tariff = await prisma.tariffVersion.create({
        data: {
          tenantId: session.tid,
          name,
          version: (last?.version ?? 0) + 1,
          effectiveFrom: new Date(str(data, "effectiveFrom")),
          effectiveTo: data.effectiveTo ? new Date(String(data.effectiveTo)) : null,
          config: (data.config ?? { energyTiers: [{ limit: null, rate: 100 }], vatRate: 0.1 }) as object,
          status: "DRAFT",
          createdById: session.uid,
        },
      });
      await audit(session, "TARIFF_CREATE", "tariff_version", tariff.id, null, { name, version: tariff.version }, req);
      return tariff;
    },
  },
  {
    method: "POST",
    pattern: "tariffs/:id/activate",
    handler: async ({ session, path, req }) => {
      await requirePermission("tariff.manage");
      const tariff = await prisma.tariffVersion.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!tariff) throw new HttpError(404, "요금표를 찾을 수 없습니다.");
      await prisma.tariffVersion.updateMany({ where: { tenantId: session.tid, name: tariff.name, status: "ACTIVE" }, data: { status: "RETIRED" } });
      const updated = await prisma.tariffVersion.update({ where: { id: tariff.id }, data: { status: "ACTIVE" } });
      await audit(session, "TARIFF_ACTIVATE", "tariff_version", tariff.id, null, { name: tariff.name, version: tariff.version }, req);
      return updated;
    },
  },
  {
    method: "POST",
    pattern: "billing/calculate",
    handler: async ({ session, body }) => {
      const data = (body ?? {}) as Record<string, unknown>;
      let config = (data.config ?? null) as TariffConfig | null;
      if (!config && data.tariffId) {
        const tariff = await prisma.tariffVersion.findFirst({ where: { id: String(data.tariffId), tenantId: session.tid } });
        if (!tariff) throw new HttpError(404, "요금표를 찾을 수 없습니다.");
        config = tariff.config as TariffConfig;
      }
      if (!config) {
        const active = await prisma.tariffVersion.findFirst({ where: { tenantId: session.tid, status: "ACTIVE" }, orderBy: { effectiveFrom: "desc" } });
        config = (active?.config as TariffConfig) ?? { energyTiers: [{ limit: null, rate: 120 }], vatRate: 0.1 };
      }
      const usage = num(data, "usageKwh", 0);
      const breakdown = calculateBill({
        usageKwh: usage,
        peakKw: optNum(data, "peakKw") ?? 0,
        contractPowerKw: optNum(data, "contractPowerKw") ?? 0,
        powerFactor: optNum(data, "powerFactor") ?? undefined,
        usageByHour: Array.isArray(data.usageByHour) ? (data.usageByHour as number[]) : undefined,
        config,
      });
      return { usageKwh: usage, bill: breakdown, tariffConfig: config };
    },
  },
  {
    method: "GET",
    pattern: "energy/analysis",
    handler: async ({ session, query }) => {
      const months = Math.min(Number(query.get("months") ?? 12), 36);
      const siteId = query.get("siteId") ?? undefined;
      const since = new Date();
      since.setMonth(since.getMonth() - months);
      const readings = await prisma.meterReading.findMany({
        where: { tenantId: session.tid, meterKind: "ELECTRICITY", readingAt: { gte: since }, ...(siteId ? { siteId } : {}) },
        orderBy: { readingAt: "asc" },
        take: 100000,
      });
      const byDevice = new Map<string, { readingAt: Date; value: number }[]>();
      for (const reading of readings) {
        const key = reading.deviceId ?? reading.unitId ?? `${reading.siteId}-manual`;
        const list = byDevice.get(key) ?? [];
        list.push({ readingAt: reading.readingAt, value: reading.value });
        byDevice.set(key, list);
      }
      const monthly = new Map<string, number>();
      for (const list of byDevice.values()) {
        for (const row of monthlyUsageSeries(list)) {
          monthly.set(row.month, (monthly.get(row.month) ?? 0) + row.usage);
        }
      }
      const series = Array.from(monthly.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, usage]) => ({ month, usage: Number(usage.toFixed(1)) }));
      const powerTags = await prisma.deviceTag.findMany({
        where: { tenantId: session.tid, standardKey: { in: ["ACTIVE_POWER", "DEMAND_MAX", "POWER_FACTOR", "ENERGY_IMPORT"] }, ...(siteId ? { siteId } : {}) },
        select: { standardKey: true, lastValue: true, unit: true },
      });
      const peak = powerTags.filter((t) => t.standardKey === "DEMAND_MAX").reduce((max, t) => Math.max(max, t.lastValue ?? 0), 0);
      const pf = powerTags.find((t) => t.standardKey === "POWER_FACTOR")?.lastValue ?? null;
      const currentPower = powerTags.filter((t) => t.standardKey === "ACTIVE_POWER").reduce((sum, t) => sum + (t.lastValue ?? 0), 0);
      const totalUsage = series.reduce((sum, s) => sum + s.usage, 0);
      const active = await prisma.tariffVersion.findFirst({ where: { tenantId: session.tid, status: "ACTIVE" }, orderBy: { effectiveFrom: "desc" } });
      const bill = calculateBill({
        usageKwh: series.at(-1)?.usage ?? 0,
        peakKw: peak,
        contractPowerKw: 0,
        powerFactor: pf ?? undefined,
        config: (active?.config as TariffConfig) ?? { energyTiers: [{ limit: null, rate: 120 }], vatRate: 0.1 },
      });
      return {
        series,
        totalUsage: Number(totalUsage.toFixed(1)),
        average: series.length ? Number((totalUsage / series.length).toFixed(1)) : 0,
        yearOverYear: series.length >= 13 ? Number((series.at(-1)!.usage / Math.max(1, series.at(-13)!.usage) - 1).toFixed(3)) : null,
        anomalies: detectAnomalies(series),
        carbonKg: Number((totalUsage * 0.4781).toFixed(1)),
        live: { currentPowerKw: Number(currentPower.toFixed(2)), peakKw: peak, powerFactor: pf, tags: powerTags.length },
        lastMonthBill: bill,
        tariff: active ? { id: active.id, name: active.name, version: active.version } : null,
      };
    },
  },
  {
    method: "POST",
    pattern: "reports/export",
    handler: async ({ session, body }) => {
      await requirePermission("report.view");
      const data = (body ?? {}) as Record<string, unknown>;
      const type = str(data, "type", false) || "metering";
      const format = str(data, "format", false) || "csv";
      const period = str(data, "period", false) || new Date().toISOString().slice(0, 7);
      let rows: Record<string, unknown>[] = [];
      let title = "";
      if (type === "metering") {
        const readings = await prisma.meterReading.findMany({
          where: { tenantId: session.tid, periodKey: period },
          include: { unit: true, building: true, adjustments: true },
        });
        title = `원격검침_${period}`;
        rows = readings.map((r) => ({
          동: r.unit?.dong ?? "",
          호실: r.unit?.ho ?? "",
          건물: r.building?.name ?? "",
          검침시각: r.readingAt.toISOString(),
          검침값: r.value,
          보정합계: r.adjustments.reduce((s, a) => s + a.deltaValue, 0),
          방식: r.source,
        }));
      } else if (type === "energy") {
        const readings = await prisma.meterReading.findMany({
          where: { tenantId: session.tid, meterKind: "ELECTRICITY" },
          orderBy: { readingAt: "asc" },
        });
        const byDevice = new Map<string, { readingAt: Date; value: number }[]>();
        for (const reading of readings) {
          const key = reading.deviceId ?? reading.unitId ?? reading.siteId;
          (byDevice.get(key) ?? byDevice.set(key, []).get(key)!).push({ readingAt: reading.readingAt, value: reading.value });
        }
        const monthly = new Map<string, number>();
        for (const list of byDevice.values()) for (const row of monthlyUsageSeries(list)) monthly.set(row.month, (monthly.get(row.month) ?? 0) + row.usage);
        title = "에너지분석";
        rows = Array.from(monthly.entries()).sort().map(([month, usage]) => ({ 월: month, 사용량kWh: Number(usage.toFixed(1)), 탄소kg: Number((usage * 0.4781).toFixed(1)) }));
      } else if (type === "alarms") {
        const alarms = await prisma.alarmEvent.findMany({
          where: { tenantId: session.tid, occurredAt: { gte: new Date(Date.now() - 31 * 24 * 3600 * 1000) } },
          include: { site: true, device: true },
          orderBy: { occurredAt: "desc" },
        });
        title = "알람이력";
        rows = alarms.map((a) => ({
          발생시각: a.occurredAt.toISOString(),
          사업장: a.site.name,
          등급: a.severity,
          코드: a.code,
          제목: a.title,
          상태: a.status,
          발생횟수: a.repeatCount,
          복구시각: a.resolvedAt?.toISOString() ?? "",
        }));
      } else if (type === "control") {
        const commands = await prisma.controlCommand.findMany({
          where: { tenantId: session.tid },
          include: { asset: true },
          orderBy: { createdAt: "desc" },
          take: 500,
        });
        title = "제어이력";
        rows = commands.map((c) => ({
          요청시각: c.createdAt.toISOString(),
          설비: c.asset.name,
          명령: c.command,
          상태: c.status,
          요청자: c.requestedById ?? "",
          최종상태: c.finalState ?? "",
          오류: c.errorMessage ?? "",
        }));
      } else {
        throw new HttpError(400, "알 수 없는 보고서 유형입니다.");
      }
      if (format === "json") return { title, period, rows };
      const csv = toCsv(rows);
      return csvResponse(csv, `${title}.csv`);
    },
  },
];
