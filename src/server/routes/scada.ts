import { audit, HttpError, requirePermission } from "@/lib/auth";
import prisma from "@/lib/db";
import { num, optNum, str, bool, type RouteDef } from "@/server/api";

function staleQuality(lastReadAt: Date | null, pollingMs: number, quality: string): string {
  if (!lastReadAt) return "UNKNOWN";
  if (quality === "BAD") return "BAD";
  if (Date.now() - lastReadAt.getTime() > Math.max(15000, pollingMs * 3)) return "STALE";
  return quality;
}

export const routes: RouteDef[] = [
  {
    method: "GET",
    pattern: "dashboard",
    handler: async ({ session }) => {
      const tenantId = session.tid;
      const [sites, buildings, devices, tags, activeAlarms, commands, readingsToday, gateways] = await Promise.all([
        prisma.site.findMany({ where: { tenantId, status: "ACTIVE" }, select: { id: true, name: true, code: true } }),
        prisma.building.count({ where: { tenantId } }),
        prisma.device.findMany({ where: { tenantId }, select: { id: true, quality: true, enabled: true, siteId: true } }),
        prisma.deviceTag.count({ where: { tenantId } }),
        prisma.alarmEvent.findMany({
          where: { tenantId, status: { in: ["ACTIVE", "ACK", "ASSIGNED"] } },
          orderBy: { occurredAt: "desc" },
          take: 10,
          include: { site: { select: { name: true } } },
        }),
        prisma.controlCommand.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 5 }),
        prisma.tagReading.count({ where: { tenantId, ts: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
        prisma.gateway.findMany({ where: { tenantId }, select: { id: true, name: true, status: true, lastSeenAt: true } }),
      ]);
      const powerTags = await prisma.deviceTag.findMany({
        where: { tenantId, standardKey: { in: ["ACTIVE_POWER", "VOLTAGE_L1_N", "CURRENT_L1", "POWER_FACTOR", "FREQUENCY", "ENERGY_IMPORT"] }, enabled: true },
        select: { id: true, name: true, standardKey: true, lastValue: true, unit: true, quality: true, lastReadAt: true, pollingMs: true, device: { select: { name: true, siteId: true } } },
        take: 200,
      });
      const latestMeter = await prisma.meterReading.findFirst({
        where: { tenantId, meterKind: "ELECTRICITY" },
        orderBy: { readingAt: "desc" },
      });
      const alarmCounts = await prisma.alarmEvent.groupBy({
        by: ["severity"],
        where: { tenantId, status: { in: ["ACTIVE", "ACK", "ASSIGNED"] } },
        _count: { _all: true },
      });
      return {
        counts: {
          sites: sites.length,
          buildings,
          devices: devices.length,
          devicesOnline: devices.filter((d) => d.quality === "GOOD").length,
          devicesOffline: devices.filter((d) => d.quality === "BAD").length,
          tags,
          readingsToday,
          activeAlarms: activeAlarms.length,
          gatewaysOnline: gateways.filter((g) => g.status === "ONLINE").length,
        },
        sites,
        devices: devices.map((d) => ({ ...d, quality: d.enabled ? d.quality : "DISABLED" })),
        power: powerTags.map((t) => ({
          id: t.id,
          name: t.name,
          standardKey: t.standardKey,
          value: t.lastValue,
          unit: t.unit,
          quality: staleQuality(t.lastReadAt, t.pollingMs, t.quality),
          lastReadAt: t.lastReadAt,
          device: t.device.name,
        })),
        latestMeter,
        activeAlarms,
        alarmCounts: alarmCounts.map((a) => ({ severity: a.severity, count: a._count._all })),
        recentCommands: commands,
        gateways,
      };
    },
  },
  {
    method: "GET",
    pattern: "live",
    handler: async ({ session, query }) => {
      const siteId = query.get("siteId") ?? undefined;
      const keys = query.get("standardKeys")?.split(",").filter(Boolean);
      const tags = await prisma.deviceTag.findMany({
        where: {
          tenantId: session.tid,
          enabled: true,
          ...(siteId ? { siteId } : {}),
          ...(keys && keys.length ? { standardKey: { in: keys } } : {}),
        },
        select: {
          id: true,
          name: true,
          key: true,
          standardKey: true,
          unit: true,
          lastValue: true,
          lastValueText: true,
          quality: true,
          lastReadAt: true,
          pollingMs: true,
          device: { select: { id: true, name: true, quality: true } },
        },
        take: 2000,
      });
      return {
        items: tags.map((t) => ({ ...t, quality: staleQuality(t.lastReadAt, t.pollingMs, t.quality) })),
        at: new Date().toISOString(),
      };
    },
  },
  {
    method: "GET",
    pattern: "trends",
    handler: async ({ session, query }) => {
      const tagIds = query.get("tagIds")?.split(",").filter(Boolean) ?? [];
      const hours = Math.min(Number(query.get("hours") ?? 24), 24 * 30);
      if (tagIds.length === 0) throw new HttpError(400, "tagIds가 필요합니다.");
      const since = new Date(Date.now() - hours * 3600 * 1000);
      const readings = await prisma.tagReading.findMany({
        where: { tenantId: session.tid, tagId: { in: tagIds }, ts: { gte: since } },
        orderBy: { ts: "asc" },
        take: 20000,
      });
      const series: Record<string, { ts: string; value: number | null }[]> = {};
      for (const reading of readings) {
        (series[reading.tagId] ??= []).push({ ts: reading.ts.toISOString(), value: reading.value });
      }
      return { series, hours, points: readings.length };
    },
  },
  {
    method: "GET",
    pattern: "stream",
    handler: async ({ session, query }) => {
      const tenantId = session.tid;
      const siteId = query.get("siteId") ?? undefined;
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setInterval> | null = null;
      const stream = new ReadableStream({
        async start(controller) {
          const send = async () => {
            try {
              const tags = await prisma.deviceTag.findMany({
                where: { tenantId, enabled: true, ...(siteId ? { siteId } : {}) },
                select: { id: true, name: true, standardKey: true, lastValue: true, unit: true, quality: true, lastReadAt: true, pollingMs: true },
                take: 500,
              });
              const alarms = await prisma.alarmEvent.findMany({
                where: { tenantId, status: { in: ["ACTIVE", "ACK", "ASSIGNED"] } },
                orderBy: { occurredAt: "desc" },
                take: 20,
              });
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    at: new Date().toISOString(),
                    tags: tags.map((t) => ({ ...t, quality: staleQuality(t.lastReadAt, t.pollingMs, t.quality) })),
                    alarms,
                  })}\n\n`,
                ),
              );
            } catch {
              // 스트림 중 오류는 다음 주기에 재시도한다.
            }
          };
          await send();
          timer = setInterval(send, 3000);
          setTimeout(() => {
            if (timer) clearInterval(timer);
            try {
              controller.close();
            } catch {
              // 이미 닫힘
            }
          }, 120000);
        },
        cancel() {
          if (timer) clearInterval(timer);
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      });
    },
  },
  // ── 전력설비 자산
  {
    method: "GET",
    pattern: "assets",
    handler: async ({ session, query }) => {
      const siteId = query.get("siteId") ?? undefined;
      const items = await prisma.electricalAsset.findMany({
        where: { tenantId: session.tid, ...(siteId ? { siteId } : {}) },
        include: { site: true, building: true, _count: { select: { children: true } } },
        orderBy: [{ siteId: "asc" }, { code: "asc" }],
      });
      const tagIds = Array.from(new Set(items.flatMap((a) => a.tagIds)));
      const tags = tagIds.length
        ? await prisma.deviceTag.findMany({ where: { tenantId: session.tid, id: { in: tagIds } }, select: { id: true, name: true, lastValue: true, unit: true, quality: true, standardKey: true } })
        : [];
      return { items, tags, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "assets",
    handler: async ({ session, body, req }) => {
      await requirePermission("scada.edit");
      const data = (body ?? {}) as Record<string, unknown>;
      const siteId = str(data, "siteId");
      const site = await prisma.site.findFirst({ where: { id: siteId, tenantId: session.tid } });
      if (!site) throw new HttpError(404, "사업장을 찾을 수 없습니다.");
      const asset = await prisma.electricalAsset.create({
        data: {
          tenantId: session.tid,
          siteId,
          buildingId: str(data, "buildingId", false) || null,
          parentId: str(data, "parentId", false) || null,
          code: str(data, "code"),
          name: str(data, "name"),
          assetType: str(data, "assetType"),
          ratedCapacity: str(data, "ratedCapacity", false) || null,
          voltage: str(data, "voltage", false) || null,
          phases: optNum(data, "phases"),
          location: str(data, "location", false) || null,
          remoteControlEnabled: bool(data, "remoteControlEnabled", false),
          interlocks: (data.interlocks ?? null) as object,
          tagIds: Array.isArray(data.tagIds) ? (data.tagIds as string[]) : [],
        },
      });
      await audit(session, "ASSET_CREATE", "electrical_asset", asset.id, null, { code: asset.code, type: asset.assetType }, req);
      return asset;
    },
  },
  {
    method: "PATCH",
    pattern: "assets/:id",
    handler: async ({ session, body, path, req }) => {
      await requirePermission("scada.edit");
      const data = (body ?? {}) as Record<string, unknown>;
      const asset = await prisma.electricalAsset.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!asset) throw new HttpError(404, "설비를 찾을 수 없습니다.");
      const updated = await prisma.electricalAsset.update({
        where: { id: asset.id },
        data: {
          name: data.name !== undefined ? str(data, "name") : undefined,
          status: data.status !== undefined ? str(data, "status") : undefined,
          breakerState: data.breakerState !== undefined ? str(data, "breakerState") : undefined,
          remoteControlEnabled: data.remoteControlEnabled !== undefined ? bool(data, "remoteControlEnabled") : undefined,
          interlocks: data.interlocks !== undefined ? (data.interlocks as object) : undefined,
          tagIds: data.tagIds !== undefined ? (data.tagIds as string[]) : undefined,
          location: data.location !== undefined ? String(data.location) : undefined,
        },
      });
      await audit(session, "ASSET_UPDATE", "electrical_asset", asset.id, { remoteControlEnabled: asset.remoteControlEnabled }, { remoteControlEnabled: updated.remoteControlEnabled }, req);
      return updated;
    },
  },
  // ── 단선결선도
  {
    method: "GET",
    pattern: "diagrams",
    handler: async ({ session, query }) => {
      const siteId = query.get("siteId") ?? undefined;
      const items = await prisma.diagram.findMany({
        where: { tenantId: session.tid, ...(siteId ? { siteId } : {}) },
        include: { site: true, _count: { select: { elements: true } } },
        orderBy: { updatedAt: "desc" },
      });
      return { items, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "diagrams",
    handler: async ({ session, body, req }) => {
      await requirePermission("scada.edit");
      const data = (body ?? {}) as Record<string, unknown>;
      const siteId = str(data, "siteId");
      const site = await prisma.site.findFirst({ where: { id: siteId, tenantId: session.tid } });
      if (!site) throw new HttpError(404, "사업장을 찾을 수 없습니다.");
      const diagram = await prisma.diagram.create({
        data: {
          tenantId: session.tid,
          siteId,
          name: str(data, "name"),
          description: str(data, "description", false) || null,
          backgroundUrl: str(data, "backgroundUrl", false) || null,
          canvas: (data.canvas ?? { width: 1600, height: 900 }) as object,
          createdById: session.uid,
        },
      });
      await audit(session, "DIAGRAM_CREATE", "diagram", diagram.id, null, { name: diagram.name }, req);
      return diagram;
    },
  },
  {
    method: "GET",
    pattern: "diagrams/:id",
    handler: async ({ session, path }) => {
      const diagram = await prisma.diagram.findFirst({
        where: { id: path[1], tenantId: session.tid },
        include: {
          site: true,
          elements: {
            orderBy: { zIndex: "asc" },
            include: {
              asset: { select: { id: true, name: true, status: true, breakerState: true, assetType: true } },
              tag: { select: { id: true, name: true, lastValue: true, unit: true, quality: true } },
            },
          },
        },
      });
      if (!diagram) throw new HttpError(404, "도면을 찾을 수 없습니다.");
      return diagram;
    },
  },
  {
    method: "PATCH",
    pattern: "diagrams/:id",
    handler: async ({ session, body, path }) => {
      await requirePermission("scada.edit");
      const data = (body ?? {}) as Record<string, unknown>;
      const diagram = await prisma.diagram.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!diagram) throw new HttpError(404, "도면을 찾을 수 없습니다.");
      return prisma.diagram.update({
        where: { id: diagram.id },
        data: {
          name: data.name !== undefined ? str(data, "name") : undefined,
          description: data.description !== undefined ? String(data.description) : undefined,
          backgroundUrl: data.backgroundUrl !== undefined ? String(data.backgroundUrl) : undefined,
          canvas: data.canvas !== undefined ? (data.canvas as object) : undefined,
          version: { increment: 1 },
        },
      });
    },
  },
  {
    method: "PUT",
    pattern: "diagrams/:id/elements",
    handler: async ({ session, body, path, req }) => {
      await requirePermission("scada.edit");
      const data = (body ?? {}) as Record<string, unknown>;
      const diagram = await prisma.diagram.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!diagram) throw new HttpError(404, "도면을 찾을 수 없습니다.");
      const elements = Array.isArray(data.elements) ? (data.elements as Record<string, unknown>[]) : [];
      await prisma.$transaction([
        prisma.diagramElement.deleteMany({ where: { diagramId: diagram.id } }),
        prisma.diagramElement.createMany({
          data: elements.map((el, index) => ({
            tenantId: session.tid,
            diagramId: diagram.id,
            elementKey: String(el.elementKey ?? `EL_${index + 1}`),
            symbolType: String(el.symbolType ?? "BREAKER"),
            label: el.label ? String(el.label) : null,
            x: Number(el.x ?? 0),
            y: Number(el.y ?? 0),
            width: Number(el.width ?? 80),
            height: Number(el.height ?? 60),
            rotation: Number(el.rotation ?? 0),
            assetId: el.assetId ? String(el.assetId) : null,
            tagId: el.tagId ? String(el.tagId) : null,
            props: (el.props ?? {}) as object,
            zIndex: Number(el.zIndex ?? index + 1),
          })),
        }),
        prisma.diagram.update({ where: { id: diagram.id }, data: { version: { increment: 1 } } }),
      ]);
      await audit(session, "DIAGRAM_SAVE", "diagram", diagram.id, null, { elements: elements.length }, req);
      return { ok: true, elements: elements.length, version: diagram.version + 1 };
    },
  },
  {
    method: "POST",
    pattern: "diagrams/:id/duplicate",
    handler: async ({ session, path }) => {
      await requirePermission("scada.edit");
      const diagram = await prisma.diagram.findFirst({
        where: { id: path[1], tenantId: session.tid },
        include: { elements: true },
      });
      if (!diagram) throw new HttpError(404, "도면을 찾을 수 없습니다.");
      const copy = await prisma.diagram.create({
        data: {
          tenantId: session.tid,
          siteId: diagram.siteId,
          name: `${diagram.name} (복사)`,
          description: diagram.description,
          backgroundUrl: diagram.backgroundUrl,
          canvas: (diagram.canvas ?? {}) as object,
          createdById: session.uid,
        },
      });
      for (const el of diagram.elements) {
        await prisma.diagramElement.create({
          data: {
            tenantId: el.tenantId,
            diagramId: copy.id,
            elementKey: el.elementKey,
            symbolType: el.symbolType,
            label: el.label,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            rotation: el.rotation,
            assetId: el.assetId,
            tagId: el.tagId,
            props: (el.props ?? {}) as object,
            zIndex: el.zIndex,
          },
        });
      }
      return copy;
    },
  },
];
