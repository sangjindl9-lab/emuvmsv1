import { audit, HttpError, requirePermission } from "@/lib/auth";
import prisma from "@/lib/db";
import { bool, num, optNum, str, type RouteDef } from "@/server/api";

export const routes: RouteDef[] = [
  {
    method: "GET",
    pattern: "alarm-rules",
    handler: async ({ session, query }) => {
      const siteId = query.get("siteId") ?? undefined;
      const items = await prisma.alarmRule.findMany({
        where: { tenantId: session.tid, ...(siteId ? { siteId } : {}) },
        orderBy: { createdAt: "desc" },
        take: 1000,
      });
      return { items, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "alarm-rules",
    handler: async ({ session, body, req }) => {
      await requirePermission("alarm.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const rule = await prisma.alarmRule.create({
        data: {
          tenantId: session.tid,
          siteId: str(data, "siteId", false) || null,
          name: str(data, "name"),
          targetType: str(data, "targetType", false) || "TAG",
          targetId: str(data, "targetId", false) || null,
          condition: str(data, "condition", false) || "GT",
          threshold: optNum(data, "threshold"),
          threshold2: optNum(data, "threshold2"),
          durationSec: num(data, "durationSec", 0),
          severity: str(data, "severity", false) || "WARNING",
          channels: Array.isArray(data.channels) ? (data.channels as string[]) : ["INAPP"],
          enabled: data.enabled === undefined ? true : bool(data, "enabled"),
        },
      });
      await audit(session, "ALARM_RULE_CREATE", "alarm_rule", rule.id, null, { name: rule.name, condition: rule.condition }, req);
      return rule;
    },
  },
  {
    method: "PATCH",
    pattern: "alarm-rules/:id",
    handler: async ({ session, body, path }) => {
      await requirePermission("alarm.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const rule = await prisma.alarmRule.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!rule) throw new HttpError(404, "알람 규칙을 찾을 수 없습니다.");
      return prisma.alarmRule.update({
        where: { id: rule.id },
        data: {
          name: data.name !== undefined ? str(data, "name") : undefined,
          condition: data.condition !== undefined ? str(data, "condition") : undefined,
          threshold: data.threshold !== undefined ? optNum(data, "threshold") : undefined,
          threshold2: data.threshold2 !== undefined ? optNum(data, "threshold2") : undefined,
          severity: data.severity !== undefined ? str(data, "severity") : undefined,
          enabled: data.enabled !== undefined ? bool(data, "enabled") : undefined,
          channels: data.channels !== undefined ? (data.channels as string[]) : undefined,
        },
      });
    },
  },
  {
    method: "GET",
    pattern: "alarm-events",
    handler: async ({ session, query }) => {
      const status = query.get("status")?.split(",").filter(Boolean);
      const severity = query.get("severity")?.split(",").filter(Boolean);
      const siteId = query.get("siteId") ?? undefined;
      const limit = Math.min(Number(query.get("limit") ?? 200), 2000);
      const items = await prisma.alarmEvent.findMany({
        where: {
          tenantId: session.tid,
          ...(status && status.length ? { status: { in: status } } : {}),
          ...(severity && severity.length ? { severity: { in: severity } } : {}),
          ...(siteId ? { siteId } : {}),
        },
        include: {
          site: { select: { name: true } },
          device: { select: { name: true } },
          tag: { select: { name: true, unit: true } },
          assignedTo: { select: { name: true } },
        },
        orderBy: { occurredAt: "desc" },
        take: limit,
      });
      const counts = await prisma.alarmEvent.groupBy({
        by: ["status", "severity"],
        where: { tenantId: session.tid },
        _count: { _all: true },
      });
      return { items, counts };
    },
  },
  {
    method: "POST",
    pattern: "alarm-events/:id/ack",
    handler: async ({ session, path, body, req }) => {
      await requirePermission("alarm.manage");
      const event = await prisma.alarmEvent.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!event) throw new HttpError(404, "알람을 찾을 수 없습니다.");
      const data = (body ?? {}) as Record<string, unknown>;
      const updated = await prisma.alarmEvent.update({
        where: { id: event.id },
        data: {
          status: data.assignToMe ? "ASSIGNED" : "ACK",
          acknowledgedAt: new Date(),
          acknowledgedById: session.uid,
          assignedToId: data.assignToMe ? session.uid : event.assignedToId,
        },
      });
      await audit(session, "ALARM_ACK", "alarm_event", event.id, { status: event.status }, { status: updated.status }, req);
      return updated;
    },
  },
  {
    method: "POST",
    pattern: "alarm-events/:id/resolve",
    handler: async ({ session, path, body, req }) => {
      await requirePermission("alarm.manage");
      const event = await prisma.alarmEvent.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!event) throw new HttpError(404, "알람을 찾을 수 없습니다.");
      const data = (body ?? {}) as Record<string, unknown>;
      const updated = await prisma.alarmEvent.update({
        where: { id: event.id },
        data: { status: "RESOLVED", resolvedAt: new Date(), resolution: str(data, "resolution", false) || "운영자 조치 완료" },
      });
      await audit(session, "ALARM_RESOLVE", "alarm_event", event.id, { status: event.status }, { status: updated.status }, req);
      return updated;
    },
  },
  {
    method: "GET",
    pattern: "alarms/summary",
    handler: async ({ session }) => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const events = await prisma.alarmEvent.findMany({
        where: { tenantId: session.tid, occurredAt: { gte: since } },
        select: { severity: true, status: true, code: true, occurredAt: true, resolvedAt: true },
      });
      const active = events.filter((e) => ["ACTIVE", "ACK", "ASSIGNED"].includes(e.status));
      const bySeverity = active.reduce<Record<string, number>>((acc, e) => {
        acc[e.severity] = (acc[e.severity] ?? 0) + 1;
        return acc;
      }, {});
      const repeat = events.reduce<Record<string, number>>((acc, e) => {
        acc[e.code] = (acc[e.code] ?? 0) + 1;
        return acc;
      }, {});
      const resolved = events.filter((e) => e.resolvedAt);
      const avgMinutes = resolved.length
        ? resolved.reduce((sum, e) => sum + (e.resolvedAt!.getTime() - e.occurredAt.getTime()), 0) / resolved.length / 60000
        : null;
      return {
        total30d: events.length,
        active: active.length,
        bySeverity,
        topCodes: Object.entries(repeat).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([code, count]) => ({ code, count })),
        avgResolutionMinutes: avgMinutes ? Number(avgMinutes.toFixed(1)) : null,
      };
    },
  },
];
