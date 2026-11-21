import { authenticate, clearSessionCookie, hashPassword, HttpError, requirePermission, setSessionCookie, verifyPassword } from "@/lib/auth";
import prisma from "@/lib/db";
import { assert, str, type RouteDef } from "@/server/api";

export const routes: RouteDef[] = [
  {
    method: "POST",
    pattern: "auth/login",
    handler: async ({ body }) => {
      const data = (body ?? {}) as Record<string, unknown>;
      const email = str(data, "email").toLowerCase();
      const password = str(data, "password");
      const session = await authenticate(email, password);
      if (!session) throw new HttpError(401, "이메일 또는 비밀번호가 올바르지 않습니다.");
      await setSessionCookie({
        uid: session.uid,
        tid: session.tid,
        email: session.email,
        name: session.name,
        roleCode: session.roleCode,
        permissions: session.permissions,
      });
      const tenant = await prisma.tenant.findUnique({ where: { id: session.tid } });
      return {
        user: { id: session.uid, email: session.email, name: session.name, role: session.roleCode, permissions: session.permissions },
        tenant: tenant ? { id: tenant.id, name: tenant.name, code: tenant.code, plan: tenant.plan } : null,
      };
    },
  },
  {
    method: "POST",
    pattern: "auth/logout",
    handler: async () => {
      await clearSessionCookie();
      return { ok: true };
    },
  },
  {
    method: "GET",
    pattern: "auth/me",
    handler: async ({ session }) => {
      const user = await prisma.user.findUnique({
        where: { id: session.uid },
        include: { tenant: true, role: true },
      });
      return {
        user: user
          ? {
              id: user.id,
              email: user.email,
              name: user.name,
              phone: user.phone,
              role: user.role ? { code: user.role.code, name: user.role.name, permissions: user.role.permissions } : null,
              lastLoginAt: user.lastLoginAt,
            }
          : null,
        tenant: user?.tenant ?? null,
      };
    },
  },
  {
    method: "POST",
    pattern: "auth/change-password",
    handler: async ({ session, body }) => {
      const data = (body ?? {}) as Record<string, unknown>;
      const current = str(data, "currentPassword");
      const next = str(data, "newPassword");
      assert(next.length >= 8, "새 비밀번호는 8자 이상이어야 합니다.");
      const user = await prisma.user.findUnique({ where: { id: session.uid } });
      if (!user) throw new HttpError(404, "사용자를 찾을 수 없습니다.");
      if (!verifyPassword(current, user.passwordHash)) throw new HttpError(401, "현재 비밀번호가 올바르지 않습니다.");
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(next) } });
      return { ok: true };
    },
  },
  {
    method: "GET",
    pattern: "health",
    handler: async () => {
      const db = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`;
      return { ok: true, db: "up", time: db[0]?.now ?? null, service: "EUMBMS" };
    },
  },
  {
    method: "GET",
    pattern: "audit-logs",
    handler: async ({ session, query }) => {
      await requirePermission("audit.view");
      const limit = Math.min(Number(query.get("limit") ?? 100), 500);
      const logs = await prisma.auditLog.findMany({
        where: { tenantId: session.tid },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return { items: logs, count: logs.length };
    },
  },
];
