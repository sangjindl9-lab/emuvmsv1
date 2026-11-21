import { audit, hashPassword, HttpError, requirePermission } from "@/lib/auth";
import prisma from "@/lib/db";
import { ROLE_DEFINITIONS } from "@/lib/rbac";
import { assert, bool, num, optNum, str, type RouteDef } from "@/server/api";

export const routes: RouteDef[] = [
  // ── 사업장
  {
    method: "GET",
    pattern: "sites",
    handler: async ({ session }) => {
      const sites = await prisma.site.findMany({
        where: { tenantId: session.tid },
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { buildings: true, devices: true, gateways: true, assets: true } } },
      });
      return { items: sites, count: sites.length };
    },
  },
  {
    method: "POST",
    pattern: "sites",
    handler: async ({ session, body, req }) => {
      await requirePermission("site.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const site = await prisma.site.create({
        data: {
          tenantId: session.tid,
          code: str(data, "code"),
          name: str(data, "name"),
          address: str(data, "address", false) || null,
          contractPowerKw: optNum(data, "contractPowerKw"),
          timezone: str(data, "timezone", false) || "Asia/Seoul",
        },
      });
      await audit(session, "SITE_CREATE", "site", site.id, null, site, req);
      return site;
    },
  },
  {
    method: "PATCH",
    pattern: "sites/:id",
    handler: async ({ session, body, path, req }) => {
      await requirePermission("site.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const site = await prisma.site.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!site) throw new HttpError(404, "사업장을 찾을 수 없습니다.");
      const updated = await prisma.site.update({
        where: { id: site.id },
        data: {
          name: data.name !== undefined ? str(data, "name") : undefined,
          address: data.address !== undefined ? String(data.address) : undefined,
          contractPowerKw: data.contractPowerKw !== undefined ? optNum(data, "contractPowerKw") : undefined,
          status: data.status !== undefined ? str(data, "status") : undefined,
        },
      });
      await audit(session, "SITE_UPDATE", "site", site.id, site, updated, req);
      return updated;
    },
  },
  // ── 건물
  {
    method: "GET",
    pattern: "buildings",
    handler: async ({ session, query }) => {
      const siteId = query.get("siteId") ?? undefined;
      const items = await prisma.building.findMany({
        where: { tenantId: session.tid, ...(siteId ? { siteId } : {}) },
        include: { site: true, _count: { select: { units: true, devices: true } } },
        orderBy: { createdAt: "asc" },
      });
      return { items, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "buildings",
    handler: async ({ session, body, req }) => {
      await requirePermission("site.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const siteId = str(data, "siteId");
      const site = await prisma.site.findFirst({ where: { id: siteId, tenantId: session.tid } });
      assert(site, "사업장을 찾을 수 없습니다.", 404);
      const building = await prisma.building.create({
        data: {
          tenantId: session.tid,
          siteId,
          code: str(data, "code"),
          name: str(data, "name"),
          purpose: str(data, "purpose", false) || "APARTMENT",
          floorsCount: num(data, "floorsCount", 0),
          areaM2: optNum(data, "areaM2"),
        },
      });
      await audit(session, "BUILDING_CREATE", "building", building.id, null, building, req);
      return building;
    },
  },
  // ── 층
  {
    method: "GET",
    pattern: "floors",
    handler: async ({ session, query }) => {
      const buildingId = query.get("buildingId") ?? undefined;
      const items = await prisma.floor.findMany({
        where: { tenantId: session.tid, ...(buildingId ? { buildingId } : {}) },
        orderBy: { level: "asc" },
      });
      return { items, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "floors",
    handler: async ({ session, body }) => {
      await requirePermission("site.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const buildingId = str(data, "buildingId");
      const building = await prisma.building.findFirst({ where: { id: buildingId, tenantId: session.tid } });
      assert(building, "건물을 찾을 수 없습니다.", 404);
      return prisma.floor.create({
        data: {
          tenantId: session.tid,
          buildingId,
          level: num(data, "level"),
          name: str(data, "name", false) || `${num(data, "level")}층`,
        },
      });
    },
  },
  // ── 호실/세대
  {
    method: "GET",
    pattern: "units",
    handler: async ({ session, query }) => {
      const buildingId = query.get("buildingId") ?? undefined;
      const q = query.get("q")?.trim();
      const items = await prisma.unit.findMany({
        where: {
          tenantId: session.tid,
          ...(buildingId ? { buildingId } : {}),
          ...(q ? { OR: [{ ho: { contains: q } }, { dong: { contains: q } }, { name: { contains: q } }] } : {}),
        },
        include: { building: true, floor: true, _count: { select: { devices: true, readings: true } } },
        orderBy: [{ dong: "asc" }, { ho: "asc" }],
        take: 1000,
      });
      return { items, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "units",
    handler: async ({ session, body }) => {
      await requirePermission("site.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const buildingId = str(data, "buildingId");
      const building = await prisma.building.findFirst({ where: { id: buildingId, tenantId: session.tid } });
      assert(building, "건물을 찾을 수 없습니다.", 404);
      const dong = str(data, "dong", false) || null;
      const ho = str(data, "ho");
      return prisma.unit.create({
        data: {
          tenantId: session.tid,
          buildingId,
          floorId: str(data, "floorId", false) || null,
          dong,
          ho,
          name: str(data, "name", false) || `${dong ?? ""}${ho}`,
          areaM2: optNum(data, "areaM2"),
          occupancy: str(data, "occupancy", false) || "OCCUPIED",
        },
      });
    },
  },
  {
    method: "PATCH",
    pattern: "units/:id",
    handler: async ({ session, body, path }) => {
      await requirePermission("site.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const unit = await prisma.unit.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!unit) throw new HttpError(404, "호실을 찾을 수 없습니다.");
      return prisma.unit.update({
        where: { id: unit.id },
        data: {
          occupancy: data.occupancy !== undefined ? str(data, "occupancy") : undefined,
          residentName: data.residentName !== undefined ? String(data.residentName) : undefined,
        },
      });
    },
  },
  // ── 사용자/권한
  {
    method: "GET",
    pattern: "users",
    handler: async ({ session }) => {
      await requirePermission("user.manage");
      const items = await prisma.user.findMany({
        where: { tenantId: session.tid },
        include: { role: true },
        orderBy: { createdAt: "asc" },
      });
      return {
        items: items.map((u) => ({ id: u.id, email: u.email, name: u.name, phone: u.phone, status: u.status, role: u.role?.code, roleName: u.role?.name, lastLoginAt: u.lastLoginAt })),
        roles: Object.entries(ROLE_DEFINITIONS).map(([code, def]) => ({ code, name: def.name, permissions: def.permissions })),
      };
    },
  },
  {
    method: "POST",
    pattern: "users",
    handler: async ({ session, body, req }) => {
      await requirePermission("user.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const email = str(data, "email").toLowerCase();
      const password = str(data, "password");
      assert(password.length >= 8, "비밀번호는 8자 이상이어야 합니다.");
      const roleCode = str(data, "role");
      assert(ROLE_DEFINITIONS[roleCode as keyof typeof ROLE_DEFINITIONS], "알 수 없는 역할입니다.");
      const role = await prisma.role.upsert({
        where: { tenantId_code: { tenantId: session.tid, code: roleCode } },
        update: {},
        create: {
          tenantId: session.tid,
          code: roleCode,
          name: ROLE_DEFINITIONS[roleCode as keyof typeof ROLE_DEFINITIONS].name,
          permissions: ROLE_DEFINITIONS[roleCode as keyof typeof ROLE_DEFINITIONS].permissions,
          isSystem: true,
        },
      });
      const exists = await prisma.user.findFirst({ where: { tenantId: session.tid, email } });
      if (exists) throw new HttpError(409, "이미 등록된 이메일입니다.");
      const user = await prisma.user.create({
        data: {
          tenantId: session.tid,
          email,
          name: str(data, "name"),
          phone: str(data, "phone", false) || null,
          passwordHash: hashPassword(password),
          roleId: role.id,
          status: "ACTIVE",
        },
      });
      await audit(session, "USER_CREATE", "user", user.id, null, { email, role: roleCode }, req);
      return { id: user.id, email: user.email, name: user.name, role: roleCode };
    },
  },
  {
    method: "PATCH",
    pattern: "users/:id",
    handler: async ({ session, body, path, req }) => {
      await requirePermission("user.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const user = await prisma.user.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!user) throw new HttpError(404, "사용자를 찾을 수 없습니다.");
      let roleId: string | undefined;
      if (data.role) {
        const roleCode = str(data, "role");
        assert(ROLE_DEFINITIONS[roleCode as keyof typeof ROLE_DEFINITIONS], "알 수 없는 역할입니다.");
        const role = await prisma.role.upsert({
          where: { tenantId_code: { tenantId: session.tid, code: roleCode } },
          update: {},
          create: {
            tenantId: session.tid,
            code: roleCode,
            name: ROLE_DEFINITIONS[roleCode as keyof typeof ROLE_DEFINITIONS].name,
            permissions: ROLE_DEFINITIONS[roleCode as keyof typeof ROLE_DEFINITIONS].permissions,
            isSystem: true,
          },
        });
        roleId = role.id;
      }
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: data.name !== undefined ? str(data, "name") : undefined,
          phone: data.phone !== undefined ? String(data.phone) : undefined,
          status: data.status !== undefined ? str(data, "status") : undefined,
          roleId,
          ...(data.password ? { passwordHash: hashPassword(str(data, "password")) } : {}),
        },
      });
      await audit(session, "USER_UPDATE", "user", user.id, { status: user.status }, { status: updated.status, roleId }, req);
      return { id: updated.id, email: updated.email, name: updated.name, status: updated.status };
    },
  },
  {
    method: "GET",
    pattern: "settings",
    handler: async ({ session }) => {
      const tenant = await prisma.tenant.findUnique({ where: { id: session.tid } });
      const counts = await Promise.all([
        prisma.site.count({ where: { tenantId: session.tid } }),
        prisma.device.count({ where: { tenantId: session.tid } }),
        prisma.deviceTag.count({ where: { tenantId: session.tid } }),
        prisma.tagReading.count({ where: { tenantId: session.tid } }),
      ]);
      const license = await prisma.license.findFirst({ where: { tenantId: session.tid, status: "ACTIVE" }, orderBy: { issuedAt: "desc" } });
      return {
        tenant,
        counts: { sites: counts[0], devices: counts[1], tags: counts[2], readings: counts[3] },
        license,
        collector: {
          intervalMs: Number(process.env.COLLECTOR_INTERVAL_MS ?? 0),
          enabled: process.env.ENABLE_COLLECTOR === "1",
        },
        version: "2.0.0",
      };
    },
  },
  {
    method: "PATCH",
    pattern: "settings",
    handler: async ({ session, body }) => {
      await requirePermission("system.admin");
      const data = (body ?? {}) as Record<string, unknown>;
      return prisma.tenant.update({
        where: { id: session.tid },
        data: {
          name: data.name !== undefined ? str(data, "name") : undefined,
          address: data.address !== undefined ? String(data.address) : undefined,
          phone: data.phone !== undefined ? String(data.phone) : undefined,
        },
      });
    },
  },
];
