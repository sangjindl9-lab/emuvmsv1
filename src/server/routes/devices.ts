import { createHash, randomBytes } from "node:crypto";
import { audit, HttpError, requirePermission } from "@/lib/auth";
import prisma from "@/lib/db";
import { toCsv, parseCsv } from "@/lib/csv";
import { collectDevice } from "@/modules/telemetry/collector";
import { getDriver, toTagSpec } from "@/modules/protocol/drivers";
import { ruleDataForTag } from "@/modules/alarms/engine";
import { assert, bool, num, optNum, str, type RouteDef } from "@/server/api";

function newToken(): { token: string; hash: string } {
  const token = `eum_${randomBytes(24).toString("base64url")}`;
  return { token, hash: createHash("sha256").update(token).digest("hex") };
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
  // ── 게이트웨이 / 통신변환기
  {
    method: "GET",
    pattern: "gateways",
    handler: async ({ session, query }) => {
      const siteId = query.get("siteId") ?? undefined;
      const items = await prisma.gateway.findMany({
        where: { tenantId: session.tid, ...(siteId ? { siteId } : {}) },
        include: { site: true, _count: { select: { devices: true, serialBuses: true } } },
        orderBy: { createdAt: "asc" },
      });
      return { items, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "gateways",
    handler: async ({ session, body, req }) => {
      await requirePermission("device.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const siteId = str(data, "siteId");
      const site = await prisma.site.findFirst({ where: { id: siteId, tenantId: session.tid } });
      assert(site, "사업장을 찾을 수 없습니다.", 404);
      const { token, hash } = newToken();
      const gateway = await prisma.gateway.create({
        data: {
          tenantId: session.tid,
          siteId,
          name: str(data, "name"),
          serial: str(data, "serial", false) || `GW-${randomBytes(4).toString("hex").toUpperCase()}`,
          kind: str(data, "kind", false) || "EDGE",
          mode: str(data, "mode", false) || "TCP_CLIENT",
          convertsProtocol: bool(data, "convertsProtocol", false),
          host: str(data, "host", false) || null,
          port: optNum(data, "port"),
          firmware: str(data, "firmware", false) || null,
          tokenHash: hash,
        },
      });
      await audit(session, "GATEWAY_CREATE", "gateway", gateway.id, null, { name: gateway.name, mode: gateway.mode }, req);
      return { gateway, enrollToken: token, note: "이 토큰은 다시 표시되지 않습니다. 현장 게이트웨이에 안전하게 보관하세요." };
    },
  },
  {
    method: "PATCH",
    pattern: "gateways/:id",
    handler: async ({ session, body, path }) => {
      await requirePermission("device.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const gateway = await prisma.gateway.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!gateway) throw new HttpError(404, "게이트웨이를 찾을 수 없습니다.");
      return prisma.gateway.update({
        where: { id: gateway.id },
        data: {
          name: data.name !== undefined ? str(data, "name") : undefined,
          host: data.host !== undefined ? String(data.host) : undefined,
          port: data.port !== undefined ? optNum(data, "port") : undefined,
          mode: data.mode !== undefined ? str(data, "mode") : undefined,
          convertsProtocol: data.convertsProtocol !== undefined ? bool(data, "convertsProtocol") : undefined,
          status: data.status !== undefined ? str(data, "status") : undefined,
        },
      });
    },
  },
  // ── 시리얼 버스
  {
    method: "GET",
    pattern: "serial-buses",
    handler: async ({ session, query }) => {
      const gatewayId = query.get("gatewayId") ?? undefined;
      const items = await prisma.serialBus.findMany({
        where: { tenantId: session.tid, ...(gatewayId ? { gatewayId } : {}) },
        include: { gateway: true, _count: { select: { devices: true } } },
      });
      return { items, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "serial-buses",
    handler: async ({ session, body }) => {
      await requirePermission("device.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const gatewayId = str(data, "gatewayId");
      const gateway = await prisma.gateway.findFirst({ where: { id: gatewayId, tenantId: session.tid } });
      assert(gateway, "게이트웨이를 찾을 수 없습니다.", 404);
      return prisma.serialBus.create({
        data: {
          tenantId: session.tid,
          gatewayId,
          name: str(data, "name"),
          port: str(data, "port", false) || null,
          baudRate: num(data, "baudRate", 9600),
          parity: str(data, "parity", false) || "N",
          dataBits: num(data, "dataBits", 8),
          stopBits: num(data, "stopBits", 1),
          mode: str(data, "mode", false) || "RTU",
          pollGapMs: num(data, "pollGapMs", 50),
        },
      });
    },
  },
  // ── 장치
  {
    method: "GET",
    pattern: "devices",
    handler: async ({ session, query }) => {
      const siteId = query.get("siteId") ?? undefined;
      const buildingId = query.get("buildingId") ?? undefined;
      const q = query.get("q")?.trim();
      const items = await prisma.device.findMany({
        where: {
          tenantId: session.tid,
          ...(siteId ? { siteId } : {}),
          ...(buildingId ? { buildingId } : {}),
          ...(q ? { OR: [{ name: { contains: q } }, { deviceType: { contains: q } }, { serialNumber: { contains: q } }] } : {}),
        },
        include: {
          site: true,
          gateway: true,
          manufacturer: true,
          model: true,
          _count: { select: { tags: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 2000,
      });
      return { items, count: items.length };
    },
  },
  {
    method: "GET",
    pattern: "devices/export",
    handler: async ({ session, query }) => {
      const siteId = query.get("siteId") ?? undefined;
      const devices = await prisma.device.findMany({
        where: { tenantId: session.tid, ...(siteId ? { siteId } : {}) },
        include: { site: true, gateway: true },
      });
      const csv = toCsv(
        devices.map((d) => ({
          name: d.name,
          siteCode: d.site.code,
          deviceType: d.deviceType,
          protocolKey: d.protocolKey,
          host: d.host ?? "",
          port: d.port ?? "",
          slaveId: d.slaveId ?? "",
          gatewaySerial: d.gateway?.serial ?? "",
          serialNumber: d.serialNumber ?? "",
          firmware: d.firmware ?? "",
          pollingMs: d.pollingMs,
          timeoutMs: d.timeoutMs,
          retryCount: d.retryCount,
          enabled: d.enabled,
        })),
      );
      return csvResponse(csv, "eumbms-devices.csv");
    },
  },
  {
    method: "POST",
    pattern: "devices/import",
    handler: async ({ session, body, req }) => {
      await requirePermission("device.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const csv = str(data, "csv");
      const rows = parseCsv(csv);
      const sites = await prisma.site.findMany({ where: { tenantId: session.tid } });
      const created: string[] = [];
      const errors: { row: number; error: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const site = sites.find((s) => s.code === row.siteCode);
          if (!site) throw new Error(`사업장 코드 없음: ${row.siteCode}`);
          if (!row.name || !row.protocolKey) throw new Error("name/protocolKey 필수");
          const gateway = row.gatewaySerial
            ? await prisma.gateway.findFirst({ where: { tenantId: session.tid, serial: row.gatewaySerial } })
            : null;
          const device = await prisma.device.create({
            data: {
              tenantId: session.tid,
              siteId: site.id,
              gatewayId: gateway?.id,
              name: row.name,
              deviceType: row.deviceType || "PLC",
              protocolKey: row.protocolKey,
              host: row.host || null,
              port: row.port ? Number(row.port) : null,
              slaveId: row.slaveId ? Number(row.slaveId) : null,
              serialNumber: row.serialNumber || null,
              firmware: row.firmware || null,
              pollingMs: row.pollingMs ? Number(row.pollingMs) : 1000,
              timeoutMs: row.timeoutMs ? Number(row.timeoutMs) : 1000,
              retryCount: row.retryCount ? Number(row.retryCount) : 2,
            },
          });
          created.push(device.id);
        } catch (error) {
          errors.push({ row: i + 2, error: (error as Error).message });
        }
      }
      await audit(session, "DEVICE_IMPORT", "device", null, null, { created: created.length, errors: errors.length }, req);
      return { created: created.length, errors };
    },
  },
  {
    method: "POST",
    pattern: "devices",
    handler: async ({ session, body, req }) => {
      await requirePermission("device.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const siteId = str(data, "siteId");
      const site = await prisma.site.findFirst({ where: { id: siteId, tenantId: session.tid } });
      assert(site, "사업장을 찾을 수 없습니다.", 404);
      const device = await prisma.device.create({
        data: {
          tenantId: session.tid,
          siteId,
          buildingId: str(data, "buildingId", false) || null,
          floorId: str(data, "floorId", false) || null,
          unitId: str(data, "unitId", false) || null,
          gatewayId: str(data, "gatewayId", false) || null,
          serialBusId: str(data, "serialBusId", false) || null,
          profileId: str(data, "profileId", false) || null,
          manufacturerId: str(data, "manufacturerId", false) || null,
          modelId: str(data, "modelId", false) || null,
          name: str(data, "name"),
          deviceType: str(data, "deviceType", false) || "PLC",
          serialNumber: str(data, "serialNumber", false) || null,
          firmware: str(data, "firmware", false) || null,
          protocolKey: str(data, "protocolKey"),
          host: str(data, "host", false) || null,
          port: optNum(data, "port"),
          slaveId: optNum(data, "slaveId"),
          stationNo: optNum(data, "stationNo"),
          rack: optNum(data, "rack"),
          slot: optNum(data, "slot"),
          pollingMs: num(data, "pollingMs", 1000),
          timeoutMs: num(data, "timeoutMs", 1000),
          retryCount: num(data, "retryCount", 2),
          description: str(data, "description", false) || null,
        },
      });
      await audit(session, "DEVICE_CREATE", "device", device.id, null, { name: device.name, protocol: device.protocolKey }, req);
      if (bool(data, "applyTemplate", false)) {
        const { STANDARD_TAG_TEMPLATES } = await import("@/modules/protocol/catalog");
        for (let i = 0; i < STANDARD_TAG_TEMPLATES.length; i++) {
          const t = STANDARD_TAG_TEMPLATES[i];
          const tag = await prisma.deviceTag.create({
            data: {
              tenantId: session.tid,
              siteId,
              deviceId: device.id,
              key: t.standardKey,
              name: t.name,
              address: i * 2,
              functionCode: t.functionCode,
              dataType: t.dataType,
              unit: t.unit,
              standardKey: t.standardKey,
            },
          });
          const rules = ruleDataForTag({ tenantId: session.tid, siteId, id: tag.id, name: tag.name, alarmHigh: null, alarmLow: null });
          if (rules.length) await prisma.alarmRule.createMany({ data: rules });
        }
      }
      return device;
    },
  },
  {
    method: "GET",
    pattern: "devices/:id",
    handler: async ({ session, path }) => {
      const device = await prisma.device.findFirst({
        where: { id: path[1], tenantId: session.tid },
        include: { site: true, gateway: true, serialBus: true, profile: true, manufacturer: true, model: true, tags: { orderBy: { address: "asc" } } },
      });
      if (!device) throw new HttpError(404, "장치를 찾을 수 없습니다.");
      return device;
    },
  },
  {
    method: "PATCH",
    pattern: "devices/:id",
    handler: async ({ session, body, path, req }) => {
      await requirePermission("device.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const device = await prisma.device.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!device) throw new HttpError(404, "장치를 찾을 수 없습니다.");
      const updated = await prisma.device.update({
        where: { id: device.id },
        data: {
          name: data.name !== undefined ? str(data, "name") : undefined,
          host: data.host !== undefined ? String(data.host) : undefined,
          port: data.port !== undefined ? optNum(data, "port") : undefined,
          slaveId: data.slaveId !== undefined ? optNum(data, "slaveId") : undefined,
          pollingMs: data.pollingMs !== undefined ? num(data, "pollingMs") : undefined,
          timeoutMs: data.timeoutMs !== undefined ? num(data, "timeoutMs") : undefined,
          retryCount: data.retryCount !== undefined ? num(data, "retryCount") : undefined,
          enabled: data.enabled !== undefined ? bool(data, "enabled") : undefined,
          description: data.description !== undefined ? String(data.description) : undefined,
          gatewayId: data.gatewayId !== undefined ? (String(data.gatewayId) || null) : undefined,
          serialBusId: data.serialBusId !== undefined ? (String(data.serialBusId) || null) : undefined,
        },
      });
      await audit(session, "DEVICE_UPDATE", "device", device.id, device, updated, req);
      return updated;
    },
  },
  {
    method: "DELETE",
    pattern: "devices/:id",
    handler: async ({ session, path }) => {
      await requirePermission("device.manage");
      const device = await prisma.device.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!device) throw new HttpError(404, "장치를 찾을 수 없습니다.");
      return prisma.device.update({ where: { id: device.id }, data: { enabled: false } });
    },
  },
  {
    method: "POST",
    pattern: "devices/:id/test",
    handler: async ({ session, path }) => {
      const device = await prisma.device.findFirst({ where: { id: path[1], tenantId: session.tid }, include: { tags: { take: 3 } } });
      if (!device) throw new HttpError(404, "장치를 찾을 수 없습니다.");
      if (!device.host || !device.port) throw new HttpError(400, "IP/포트를 먼저 입력하세요.");
      const driver = getDriver(
        {
          id: device.id,
          protocolKey: device.protocolKey,
          host: device.host,
          port: device.port,
          unitId: device.slaveId ?? 1,
          timeoutMs: device.timeoutMs,
          retries: 0,
        },
        false,
      );
      try {
        const result = await driver.testConnection();
        if (device.tags.length > 0) {
          result.sample = await driver.readTags(device.tags.map(toTagSpec));
        }
        await prisma.deviceConnection.create({
          data: {
            tenantId: session.tid,
            deviceId: device.id,
            transport: device.protocolKey,
            host: device.host,
            port: device.port,
            status: result.ok ? "CONNECTED" : "ERROR",
            lastError: result.ok ? null : result.detail,
            connectedAt: new Date(),
            stats: { rttMs: result.rttMs },
          },
        });
        return result;
      } finally {
        driver.close();
      }
    },
  },
  {
    method: "POST",
    pattern: "devices/:id/read",
    handler: async ({ session, path }) => {
      const device = await prisma.device.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!device) throw new HttpError(404, "장치를 찾을 수 없습니다.");
      return collectDevice(device.id);
    },
  },
  {
    method: "POST",
    pattern: "devices/:id/clone",
    handler: async ({ session, body, path }) => {
      await requirePermission("device.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const source = await prisma.device.findFirst({
        where: { id: path[1], tenantId: session.tid },
        include: { tags: true },
      });
      if (!source) throw new HttpError(404, "장치를 찾을 수 없습니다.");
      const clone = await prisma.device.create({
        data: {
          tenantId: session.tid,
          siteId: source.siteId,
          buildingId: source.buildingId,
          gatewayId: source.gatewayId,
          serialBusId: source.serialBusId,
          profileId: source.profileId,
          manufacturerId: source.manufacturerId,
          modelId: source.modelId,
          name: str(data, "name", false) || `${source.name} (복제)`,
          deviceType: source.deviceType,
          protocolKey: source.protocolKey,
          host: source.host,
          port: source.port,
          slaveId: optNum(data, "slaveId") ?? source.slaveId,
          pollingMs: source.pollingMs,
          timeoutMs: source.timeoutMs,
          retryCount: source.retryCount,
          description: source.description,
        },
      });
      if (bool(data, "copyTags", true)) {
        for (const tag of source.tags) {
          await prisma.deviceTag.create({
            data: {
              tenantId: session.tid,
              siteId: tag.siteId,
              deviceId: clone.id,
              key: tag.key,
              name: tag.name,
              address: tag.address,
              functionCode: tag.functionCode,
              dataType: tag.dataType,
              unit: tag.unit,
              scale: tag.scale,
              offset: tag.offset,
              byteOrder: tag.byteOrder,
              wordOrder: tag.wordOrder,
              pollingMs: tag.pollingMs,
              writable: tag.writable,
              standardKey: tag.standardKey,
              alarmHigh: tag.alarmHigh,
              alarmLow: tag.alarmLow,
            },
          });
        }
      }
      return clone;
    },
  },
  {
    method: "GET",
    pattern: "device-connections",
    handler: async ({ session, query }) => {
      const deviceId = query.get("deviceId") ?? undefined;
      const items = await prisma.deviceConnection.findMany({
        where: { tenantId: session.tid, ...(deviceId ? { deviceId } : {}) },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return { items, count: items.length };
    },
  },
  // ── 태그/레지스터
  {
    method: "GET",
    pattern: "tags",
    handler: async ({ session, query }) => {
      const deviceId = query.get("deviceId") ?? undefined;
      const siteId = query.get("siteId") ?? undefined;
      const q = query.get("q")?.trim();
      const items = await prisma.deviceTag.findMany({
        where: {
          tenantId: session.tid,
          ...(deviceId ? { deviceId } : {}),
          ...(siteId ? { siteId } : {}),
          ...(q ? { OR: [{ name: { contains: q } }, { key: { contains: q } }] } : {}),
        },
        include: { device: { select: { id: true, name: true, protocolKey: true, quality: true } } },
        orderBy: [{ deviceId: "asc" }, { address: "asc" }],
        take: 5000,
      });
      return { items, count: items.length };
    },
  },
  {
    method: "GET",
    pattern: "tags/templates",
    handler: async () => {
      const { STANDARD_TAG_TEMPLATES } = await import("@/modules/protocol/catalog");
      return { items: STANDARD_TAG_TEMPLATES };
    },
  },
  {
    method: "GET",
    pattern: "tags/export",
    handler: async ({ session, query }) => {
      const siteId = query.get("siteId") ?? undefined;
      const tags = await prisma.deviceTag.findMany({
        where: { tenantId: session.tid, ...(siteId ? { siteId } : {}) },
        include: { device: true },
        orderBy: [{ deviceId: "asc" }, { address: "asc" }],
      });
      const csv = toCsv(
        tags.map((t) => ({
          deviceName: t.device.name,
          key: t.key,
          name: t.name,
          address: t.address,
          functionCode: t.functionCode,
          dataType: t.dataType,
          unit: t.unit ?? "",
          scale: t.scale,
          offset: t.offset,
          byteOrder: t.byteOrder,
          wordOrder: t.wordOrder,
          pollingMs: t.pollingMs,
          writable: t.writable,
          alarmHigh: t.alarmHigh ?? "",
          alarmLow: t.alarmLow ?? "",
          standardKey: t.standardKey ?? "",
        })),
      );
      return csvResponse(csv, "eumbms-tags.csv");
    },
  },
  {
    method: "POST",
    pattern: "tags/import",
    handler: async ({ session, body, req }) => {
      await requirePermission("tag.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const rows = parseCsv(str(data, "csv"));
      const devices = await prisma.device.findMany({ where: { tenantId: session.tid } });
      let created = 0;
      const errors: { row: number; error: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const device = devices.find((d) => d.name === row.deviceName);
          if (!device) throw new Error(`장치 없음: ${row.deviceName}`);
          await prisma.deviceTag.create({
            data: {
              tenantId: session.tid,
              siteId: device.siteId,
              deviceId: device.id,
              key: row.key || `TAG_${i + 1}`,
              name: row.name || row.key,
              address: Number(row.address ?? 0),
              functionCode: Number(row.functionCode ?? 3),
              dataType: row.dataType || "UINT16",
              unit: row.unit || null,
              scale: row.scale ? Number(row.scale) : 1,
              offset: row.offset ? Number(row.offset) : 0,
              byteOrder: row.byteOrder || "AB",
              wordOrder: row.wordOrder || "ABCD",
              pollingMs: row.pollingMs ? Number(row.pollingMs) : 1000,
              writable: row.writable === "true",
              alarmHigh: row.alarmHigh ? Number(row.alarmHigh) : null,
              alarmLow: row.alarmLow ? Number(row.alarmLow) : null,
              standardKey: row.standardKey || null,
            },
          });
          created += 1;
        } catch (error) {
          errors.push({ row: i + 2, error: (error as Error).message });
        }
      }
      await audit(session, "TAG_IMPORT", "device_tag", null, null, { created, errors: errors.length }, req);
      return { created, errors };
    },
  },
  {
    method: "POST",
    pattern: "tags",
    handler: async ({ session, body, req }) => {
      await requirePermission("tag.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const deviceId = str(data, "deviceId");
      const device = await prisma.device.findFirst({ where: { id: deviceId, tenantId: session.tid } });
      assert(device, "장치를 찾을 수 없습니다.", 404);
      const tag = await prisma.deviceTag.create({
        data: {
          tenantId: session.tid,
          siteId: device.siteId,
          deviceId,
          key: str(data, "key"),
          name: str(data, "name"),
          address: num(data, "address"),
          functionCode: num(data, "functionCode", 3),
          dataType: str(data, "dataType", false) || "UINT16",
          unit: str(data, "unit", false) || null,
          scale: num(data, "scale", 1),
          offset: num(data, "offset", 0),
          byteOrder: str(data, "byteOrder", false) || "AB",
          wordOrder: str(data, "wordOrder", false) || "ABCD",
          pollingMs: num(data, "pollingMs", 1000),
          writable: bool(data, "writable", false),
          minValue: optNum(data, "minValue"),
          maxValue: optNum(data, "maxValue"),
          alarmHigh: optNum(data, "alarmHigh"),
          alarmLow: optNum(data, "alarmLow"),
          standardKey: str(data, "standardKey", false) || null,
          description: str(data, "description", false) || null,
        },
      });
      if (bool(data, "createAlarmRules", true)) {
        const rules = ruleDataForTag({ tenantId: session.tid, siteId: device.siteId, id: tag.id, name: tag.name, alarmHigh: tag.alarmHigh, alarmLow: tag.alarmLow });
        if (rules.length) await prisma.alarmRule.createMany({ data: rules });
      }
      await audit(session, "TAG_CREATE", "device_tag", tag.id, null, { key: tag.key, address: tag.address }, req);
      return tag;
    },
  },
  {
    method: "PATCH",
    pattern: "tags/:id",
    handler: async ({ session, body, path }) => {
      await requirePermission("tag.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const tag = await prisma.deviceTag.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!tag) throw new HttpError(404, "태그를 찾을 수 없습니다.");
      return prisma.deviceTag.update({
        where: { id: tag.id },
        data: {
          name: data.name !== undefined ? str(data, "name") : undefined,
          address: data.address !== undefined ? num(data, "address") : undefined,
          functionCode: data.functionCode !== undefined ? num(data, "functionCode") : undefined,
          dataType: data.dataType !== undefined ? str(data, "dataType") : undefined,
          unit: data.unit !== undefined ? String(data.unit) : undefined,
          scale: data.scale !== undefined ? num(data, "scale") : undefined,
          offset: data.offset !== undefined ? num(data, "offset") : undefined,
          byteOrder: data.byteOrder !== undefined ? str(data, "byteOrder") : undefined,
          wordOrder: data.wordOrder !== undefined ? str(data, "wordOrder") : undefined,
          alarmHigh: data.alarmHigh !== undefined ? optNum(data, "alarmHigh") : undefined,
          alarmLow: data.alarmLow !== undefined ? optNum(data, "alarmLow") : undefined,
          writable: data.writable !== undefined ? bool(data, "writable") : undefined,
          enabled: data.enabled !== undefined ? bool(data, "enabled") : undefined,
        },
      });
    },
  },
  {
    method: "DELETE",
    pattern: "tags/:id",
    handler: async ({ session, path }) => {
      await requirePermission("tag.manage");
      const tag = await prisma.deviceTag.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!tag) throw new HttpError(404, "태그를 찾을 수 없습니다.");
      return prisma.deviceTag.update({ where: { id: tag.id }, data: { enabled: false } });
    },
  },
];
