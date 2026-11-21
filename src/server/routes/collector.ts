import { requirePermission } from "@/lib/auth";
import prisma from "@/lib/db";
import { runCollectionCycle } from "@/modules/telemetry/collector";
import type { RouteDef } from "@/server/api";

let lastRun: { at: string; report: unknown } | null = null;

export const routes: RouteDef[] = [
  {
    method: "POST",
    pattern: "collector/run",
    handler: async ({ session, query }) => {
      await requirePermission("device.manage");
      const siteId = query.get("siteId") ?? undefined;
      const report = await runCollectionCycle(session.tid, siteId);
      lastRun = { at: new Date().toISOString(), report };
      return report;
    },
  },
  {
    method: "GET",
    pattern: "collector/status",
    handler: async ({ session }) => {
      const since = new Date(Date.now() - 15 * 60 * 1000);
      const [recent, devices, lastReading] = await Promise.all([
        prisma.tagReading.count({ where: { tenantId: session.tid, ts: { gte: since } } }),
        prisma.device.groupBy({ by: ["quality"], where: { tenantId: session.tid, enabled: true }, _count: { _all: true } }),
        prisma.tagReading.findFirst({ where: { tenantId: session.tid }, orderBy: { ts: "desc" } }),
      ]);
      return {
        lastRun,
        readingsLast15m: recent,
        lastReadingAt: lastReading?.ts ?? null,
        devicesByQuality: devices.map((d) => ({ quality: d.quality, count: d._count._all })),
        scheduling: {
          inProcessCollector: process.env.ENABLE_COLLECTOR === "1",
          intervalMs: Number(process.env.COLLECTOR_INTERVAL_MS ?? 5000),
        },
      };
    },
  },
];
