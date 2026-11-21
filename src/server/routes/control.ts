import { randomUUID } from "node:crypto";
import { HttpError, requirePermission } from "@/lib/auth";
import prisma from "@/lib/db";
import { ControlEngine } from "@/modules/control/engine";
import { str, type RouteDef } from "@/server/api";

export const routes: RouteDef[] = [
  {
    method: "GET",
    pattern: "control/commands",
    handler: async ({ session, query }) => {
      const status = query.get("status")?.split(",").filter(Boolean);
      const items = await prisma.controlCommand.findMany({
        where: { tenantId: session.tid, ...(status && status.length ? { status: { in: status } } : {}) },
        include: {
          asset: { select: { id: true, name: true, assetType: true, breakerState: true, status: true } },
          approvals: { include: { approver: { select: { name: true } } } },
          requestedBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return { items, count: items.length };
    },
  },
  {
    method: "GET",
    pattern: "control/commands/:id",
    handler: async ({ session, path }) => {
      const command = await prisma.controlCommand.findFirst({
        where: { id: path[2], tenantId: session.tid },
        include: {
          asset: true,
          approvals: { include: { approver: { select: { name: true } } } },
          feedbacks: { orderBy: { ts: "asc" } },
          requestedBy: { select: { name: true } },
        },
      });
      if (!command) throw new HttpError(404, "제어 명령을 찾을 수 없습니다.");
      return command;
    },
  },
  {
    method: "POST",
    pattern: "control/commands",
    handler: async ({ session, body, req }) => {
      await requirePermission("control.request");
      const data = (body ?? {}) as Record<string, unknown>;
      const engine = new ControlEngine(session, req);
      return engine.request({
        assetId: str(data, "assetId"),
        command: str(data, "command"),
        reason: str(data, "reason", false) || undefined,
        idempotencyKey: str(data, "idempotencyKey", false) || randomUUID(),
        payload: (data.payload ?? undefined) as Record<string, unknown> | undefined,
        requiredApprovals: data.requiredApprovals ? Number(data.requiredApprovals) : 2,
      });
    },
  },
  {
    method: "POST",
    pattern: "control/commands/:id/approve",
    handler: async ({ session, body, path, req }) => {
      await requirePermission("control.approve");
      const data = (body ?? {}) as Record<string, unknown>;
      const decision = str(data, "decision", false) === "REJECTED" ? "REJECTED" : "APPROVED";
      const engine = new ControlEngine(session, req);
      return engine.approve({ commandId: path[2], decision, comment: str(data, "comment", false) || undefined });
    },
  },
  {
    method: "POST",
    pattern: "control/commands/:id/execute",
    handler: async ({ session, path, req }) => {
      await requirePermission("control.approve");
      const engine = new ControlEngine(session, req);
      return engine.execute(path[2]);
    },
  },
  {
    method: "POST",
    pattern: "control/commands/:id/cancel",
    handler: async ({ session, path, req }) => {
      const command = await prisma.controlCommand.findFirst({ where: { id: path[2], tenantId: session.tid } });
      if (!command) throw new HttpError(404, "제어 명령을 찾을 수 없습니다.");
      if (!["REQUESTED", "APPROVED", "REJECTED", "EXPIRED"].includes(command.status)) {
        throw new HttpError(409, `이미 전송 단계에 들어간 명령은 취소할 수 없습니다(상태: ${command.status}).`);
      }
      if (command.requestedById !== session.uid && !session.permissions.includes("system.admin")) {
        throw new HttpError(403, "요청자 또는 최고관리자만 취소할 수 있습니다.");
      }
      const updated = await prisma.controlCommand.update({ where: { id: command.id }, data: { status: "CANCELED", completedAt: new Date() } });
      await prisma.auditLog.create({
        data: {
          tenantId: session.tid,
          actorId: session.uid,
          actorName: session.name,
          action: "CONTROL_CANCEL",
          targetType: "control_command",
          targetId: command.id,
          before: { status: command.status },
          after: { status: "CANCELED" },
          ip: req.headers.get("x-forwarded-for"),
        },
      });
      return updated;
    },
  },
  {
    method: "GET",
    pattern: "control/assets",
    handler: async ({ session }) => {
      const assets = await prisma.electricalAsset.findMany({
        where: { tenantId: session.tid },
        include: { site: { select: { name: true } } },
        orderBy: [{ siteId: "asc" }, { code: "asc" }],
      });
      const tagIds = Array.from(new Set(assets.flatMap((a) => a.tagIds)));
      const tags = tagIds.length
        ? await prisma.deviceTag.findMany({ where: { tenantId: session.tid, id: { in: tagIds } }, select: { id: true, name: true, lastValue: true, unit: true } })
        : [];
      return {
        items: assets.map((a) => ({
          ...a,
          controlReady: Boolean(a.remoteControlEnabled && (a.interlocks as { control?: { tagId?: string } } | null)?.control?.tagId),
        })),
        tags,
        counts: {
          total: assets.length,
          remoteEnabled: assets.filter((a) => a.remoteControlEnabled).length,
          controlReady: assets.filter((a) => a.remoteControlEnabled && (a.interlocks as { control?: { tagId?: string } } | null)?.control?.tagId).length,
          trip: assets.filter((a) => a.status === "TRIP").length,
        },
      };
    },
  },
];
