import { randomBytes } from "node:crypto";
import { audit, HttpError, requirePermission } from "@/lib/auth";
import prisma from "@/lib/db";
import { num, str, type RouteDef } from "@/server/api";

function licenseKey(): string {
  const raw = randomBytes(12).toString("hex").toUpperCase();
  return `EUMBMS-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

export const routes: RouteDef[] = [
  {
    method: "GET",
    pattern: "licenses",
    handler: async ({ session }) => {
      const items = await prisma.license.findMany({ where: { tenantId: session.tid }, orderBy: { issuedAt: "desc" } });
      return { items, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "licenses",
    handler: async ({ session, body, req }) => {
      await requirePermission("license.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const license = await prisma.license.create({
        data: {
          tenantId: session.tid,
          licenseKey: licenseKey(),
          edition: str(data, "edition", false) || "STANDARD",
          maxSites: num(data, "maxSites", 1),
          maxDevices: num(data, "maxDevices", 100),
          maxTags: num(data, "maxTags", 10000),
          expiresAt: data.expiresAt ? new Date(String(data.expiresAt)) : null,
          status: "ACTIVE",
          features: Array.isArray(data.features) ? (data.features as string[]) : ["SCADA", "METERING", "CONTROL"],
          hardwareId: str(data, "hardwareId", false) || null,
        },
      });
      await audit(session, "LICENSE_ISSUE", "license", license.id, null, { edition: license.edition }, req);
      return license;
    },
  },
  {
    method: "POST",
    pattern: "licenses/:id/revoke",
    handler: async ({ session, path, req }) => {
      await requirePermission("license.manage");
      const license = await prisma.license.findFirst({ where: { id: path[1], tenantId: session.tid } });
      if (!license) throw new HttpError(404, "라이선스를 찾을 수 없습니다.");
      const updated = await prisma.license.update({ where: { id: license.id }, data: { status: "REVOKED" } });
      await audit(session, "LICENSE_REVOKE", "license", license.id, { status: license.status }, { status: "REVOKED" }, req);
      return updated;
    },
  },
];
