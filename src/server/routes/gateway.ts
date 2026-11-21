import { createHash } from "node:crypto";
import { HttpError } from "@/lib/auth";
import prisma from "@/lib/db";
import { evaluateTagAlarms } from "@/modules/alarms/engine";
import type { RouteDef } from "@/server/api";

async function gatewayFromRequest(req: Request) {
  const token = req.headers.get("x-gateway-token") ?? new URL(req.url).searchParams.get("token");
  if (!token) throw new HttpError(401, "게이트웨이 토큰이 필요합니다.");
  const hash = createHash("sha256").update(token).digest("hex");
  const gateway = await prisma.gateway.findFirst({ where: { tokenHash: hash } });
  if (!gateway) throw new HttpError(401, "유효하지 않은 게이트웨이 토큰입니다.");
  return gateway;
}

export const routes: RouteDef[] = [
  {
    method: "POST",
    pattern: "gateway/handshake",
    handler: async ({ req }) => {
      const gateway = await gatewayFromRequest(req);
      const site = await prisma.site.findUnique({ where: { id: gateway.siteId } });
      const devices = await prisma.device.findMany({
        where: { tenantId: gateway.tenantId, siteId: gateway.siteId, enabled: true },
        include: { tags: { where: { enabled: true } }, serialBus: true },
      });
      await prisma.gateway.update({ where: { id: gateway.id }, data: { status: "ONLINE", lastSeenAt: new Date() } });
      return {
        gateway: { id: gateway.id, name: gateway.name, serial: gateway.serial, tenantId: gateway.tenantId, siteId: gateway.siteId },
        site: site ? { id: site.id, name: site.name, code: site.code, timezone: site.timezone } : null,
        devices: devices.map((d) => ({
          id: d.id,
          name: d.name,
          protocolKey: d.protocolKey,
          host: d.host,
          port: d.port,
          slaveId: d.slaveId,
          pollingMs: d.pollingMs,
          timeoutMs: d.timeoutMs,
          retryCount: d.retryCount,
          serialBus: d.serialBus ? { port: d.serialBus.port, baudRate: d.serialBus.baudRate, parity: d.serialBus.parity, dataBits: d.serialBus.dataBits, stopBits: d.serialBus.stopBits, mode: d.serialBus.mode, pollGapMs: d.serialBus.pollGapMs } : null,
          tags: d.tags.map((t) => ({
            id: t.id,
            key: t.key,
            name: t.name,
            address: t.address,
            functionCode: t.functionCode,
            dataType: t.dataType,
            byteOrder: t.byteOrder,
            wordOrder: t.wordOrder,
            scale: t.scale,
            offset: t.offset,
          })),
        })),
        serverTime: new Date().toISOString(),
      };
    },
  },
  {
    method: "POST",
    pattern: "gateway/heartbeat",
    handler: async ({ req, body }) => {
      const gateway = await gatewayFromRequest(req);
      const data = (body ?? {}) as Record<string, unknown>;
      await prisma.gateway.update({
        where: { id: gateway.id },
        data: {
          status: "ONLINE",
          lastSeenAt: new Date(),
          bufferDepth: Number(data.bufferDepth ?? 0),
          firmware: typeof data.firmware === "string" ? data.firmware : gateway.firmware,
        },
      });
      return { ok: true, serverTime: new Date().toISOString() };
    },
  },
  {
    method: "POST",
    pattern: "gateway/ingest",
    handler: async ({ req, body }) => {
      const gateway = await gatewayFromRequest(req);
      const data = (body ?? {}) as Record<string, unknown>;
      const readings = Array.isArray(data.readings) ? (data.readings as Record<string, unknown>[]) : [];
      let stored = 0;
      const errors: string[] = [];
      for (const reading of readings) {
        try {
          const tag = await prisma.deviceTag.findFirst({
            where: { id: String(reading.tagId), tenantId: gateway.tenantId },
            include: { device: true },
          });
          if (!tag) throw new Error(`태그 없음: ${reading.tagId}`);
          const value = reading.value === null || reading.value === undefined ? null : Number(reading.value);
          const quality = typeof reading.quality === "string" ? reading.quality : value === null ? "BAD" : "GOOD";
          const ts = reading.ts ? new Date(String(reading.ts)) : new Date();
          await prisma.deviceTag.update({
            where: { id: tag.id },
            data: { lastValue: value, lastReadAt: ts, quality },
          });
          if (value !== null) {
            await prisma.tagReading.create({
              data: { tenantId: gateway.tenantId, siteId: tag.siteId, tagId: tag.id, ts, value, quality, raw: reading.raw ? (reading.raw as object) : undefined },
            });
          }
          await evaluateTagAlarms({
            tenantId: gateway.tenantId,
            siteId: tag.siteId,
            deviceId: tag.deviceId,
            tagId: tag.id,
            tagName: tag.name,
            value: { key: tag.key, value, quality: quality as "GOOD" | "BAD" | "UNCERTAIN" | "STALE", at: ts.toISOString() },
          });
          stored += 1;
        } catch (error) {
          errors.push((error as Error).message);
        }
      }
      const deviceIds = Array.from(new Set(readings.map((r) => String(r.deviceId ?? "")))).filter(Boolean);
      for (const deviceId of deviceIds) {
        await prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: new Date(), quality: "GOOD", lastError: null } }).catch(() => undefined);
      }
      await prisma.gateway.update({ where: { id: gateway.id }, data: { lastSeenAt: new Date(), status: "ONLINE", bufferDepth: 0 } });
      return { stored, errors, serverTime: new Date().toISOString() };
    },
  },
];
