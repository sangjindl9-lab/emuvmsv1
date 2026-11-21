import { createHash } from "node:crypto";
import { audit, HttpError, requirePermission } from "@/lib/auth";
import prisma from "@/lib/db";
import { PROTOCOL_CATALOG } from "@/modules/protocol/catalog";
import { analyzeDocument } from "@/modules/protocol/manual/analyze";
import { extractDocument } from "@/modules/protocol/manual/extract";
import { defaultFrameTemplate, previewFrame, testCustomFrame, type FrameTemplate } from "@/modules/protocol/custom-frame";
import { ModbusTcpClient, type ModbusTransport } from "@/modules/protocol/modbus/client";
import { assert, bool, num, optNum, str, type RouteDef } from "@/server/api";

export const routes: RouteDef[] = [
  {
    method: "GET",
    pattern: "protocols/catalog",
    handler: async ({ session }) => {
      const drivers = await prisma.protocolDriver.findMany({
        where: { tenantId: session.tid },
        include: { versions: { orderBy: { createdAt: "desc" } }, manufacturer: true },
      });
      return {
        catalog: PROTOCOL_CATALOG,
        drivers,
        checkedAt: "2026-11-22",
        note: "FIELD_VERIFIED는 실장비 통신 증빙이 있는 경우에만 표시합니다. 현재 빌드에는 실장비 검증 항목이 없습니다.",
      };
    },
  },
  {
    method: "GET",
    pattern: "manufacturers",
    handler: async () => {
      const items = await prisma.manufacturer.findMany({ include: { models: true }, orderBy: { name: "asc" } });
      return { items, count: items.length };
    },
  },
  {
    method: "GET",
    pattern: "protocols/drivers",
    handler: async ({ session }) => {
      const items = await prisma.protocolDriver.findMany({
        where: { tenantId: session.tid },
        include: { versions: { orderBy: { createdAt: "desc" } }, manufacturer: true },
        orderBy: { createdAt: "asc" },
      });
      return { items, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "protocols/drivers",
    handler: async ({ session, body, req }) => {
      await requirePermission("protocol.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const driver = await prisma.protocolDriver.create({
        data: {
          tenantId: session.tid,
          key: str(data, "key"),
          name: str(data, "name"),
          protocolFamily: str(data, "protocolFamily", false) || "VENDOR",
          transport: str(data, "transport", false) || "TCP",
          status: "IN_DEVELOPMENT",
          description: str(data, "description", false) || null,
          docsUrl: str(data, "docsUrl", false) || null,
          manufacturerId: str(data, "manufacturerId", false) || null,
        },
      });
      const version = await prisma.driverVersion.create({
        data: {
          tenantId: session.tid,
          driverId: driver.id,
          version: str(data, "version", false) || "0.1.0",
          changelog: "초기 등록",
          status: "DRAFT",
          config: (data.config ?? {}) as object,
          createdById: session.uid,
        },
      });
      await audit(session, "DRIVER_CREATE", "protocol_driver", driver.id, null, { key: driver.key, version: version.version }, req);
      return { driver, version };
    },
  },
  {
    method: "POST",
    pattern: "protocols/drivers/:id/versions",
    handler: async ({ session, body, path, req }) => {
      await requirePermission("protocol.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const driver = await prisma.protocolDriver.findFirst({ where: { id: path[2], tenantId: session.tid } });
      if (!driver) throw new HttpError(404, "드라이버를 찾을 수 없습니다.");
      const version = await prisma.driverVersion.create({
        data: {
          tenantId: session.tid,
          driverId: driver.id,
          version: str(data, "version"),
          changelog: str(data, "changelog", false) || null,
          config: (data.config ?? {}) as object,
          status: "VALIDATED",
          createdById: session.uid,
        },
      });
      await audit(session, "DRIVER_VERSION_CREATE", "driver_version", version.id, null, { version: version.version }, req);
      return version;
    },
  },
  {
    method: "POST",
    pattern: "protocols/drivers/:id/rollback",
    handler: async ({ session, body, path, req }) => {
      await requirePermission("protocol.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const driver = await prisma.protocolDriver.findFirst({ where: { id: path[2], tenantId: session.tid } });
      if (!driver) throw new HttpError(404, "드라이버를 찾을 수 없습니다.");
      const target = await prisma.driverVersion.findFirst({ where: { id: str(data, "versionId"), driverId: driver.id, tenantId: session.tid } });
      if (!target) throw new HttpError(404, "버전을 찾을 수 없습니다.");
      await prisma.driverVersion.updateMany({ where: { driverId: driver.id, status: "ACTIVE" }, data: { status: "ROLLED_BACK" } });
      const restored = await prisma.driverVersion.update({ where: { id: target.id }, data: { status: "ACTIVE" } });
      await prisma.protocolDriver.update({ where: { id: driver.id }, data: { status: "PARTIAL" } });
      await audit(session, "DRIVER_ROLLBACK", "driver_version", target.id, null, { version: target.version }, req);
      return restored;
    },
  },
  {
    method: "POST",
    pattern: "protocols/test-connection",
    handler: async ({ session, body }) => {
      const data = (body ?? {}) as Record<string, unknown>;
      const host = str(data, "host");
      const port = num(data, "port");
      const protocolKey = str(data, "protocolKey", false) || "modbus-tcp";
      const transport: ModbusTransport =
        protocolKey === "modbus-rtu" || protocolKey === "modbus-rtu-over-tcp" ? "MODBUS_RTU_OVER_TCP" : protocolKey === "modbus-ascii" ? "MODBUS_ASCII_OVER_TCP" : "MODBUS_TCP";
      const client = new ModbusTcpClient({ host, port, unitId: num(data, "unitId", 1), transport, timeoutMs: num(data, "timeoutMs", 1500), retries: 0 });
      try {
        await client.connect();
        const registers = await client.readHoldingRegisters(num(data, "address", 0), 1);
        return { ok: true, detail: `연결 성공, Holding[${num(data, "address", 0)}]=${registers[0]}`, tenant: session.tid };
      } catch (error) {
        return { ok: false, detail: (error as Error).message };
      } finally {
        client.close();
      }
    },
  },
  // ── 자동등록 방식 1: 카탈로그 프로파일 생성
  {
    method: "POST",
    pattern: "protocols/profiles/from-catalog",
    handler: async ({ session, body, req }) => {
      await requirePermission("protocol.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const manufacturerName = str(data, "manufacturer");
      const modelName = str(data, "model", false) || null;
      const protocolKey = str(data, "protocolKey");
      const manufacturer = await prisma.manufacturer.findFirst({ where: { name: manufacturerName } });
      const model = modelName && manufacturer
        ? await prisma.deviceModel.findFirst({ where: { manufacturerId: manufacturer.id, name: modelName } })
        : null;
      const driver = await prisma.protocolDriver.findFirst({ where: { tenantId: session.tid, key: protocolKey } });
      const profile = await prisma.deviceProfile.create({
        data: {
          tenantId: session.tid,
          manufacturerId: manufacturer?.id,
          modelId: model?.id,
          driverId: driver?.id,
          name: `${manufacturerName} ${modelName ?? ""} 프로파일`.trim(),
          protocolKey,
          transport: str(data, "transport", false) || "TCP",
          settings: { host: data.host ?? null, port: data.port ?? null, slaveId: data.slaveId ?? 1, timeoutMs: data.timeoutMs ?? 1500, retry: data.retry ?? 2 },
          registerMap: (data.registerMap ?? []) as object,
          source: "CATALOG",
          reviewStatus: "APPROVED",
          createdById: session.uid,
        },
      });
      await audit(session, "PROFILE_FROM_CATALOG", "device_profile", profile.id, null, { protocolKey, manufacturerName }, req);
      return profile;
    },
  },
  // ── 방식 2: 매뉴얼 업로드 → 분석 → 승인 대기 초안
  {
    method: "GET",
    pattern: "protocols/documents",
    handler: async ({ session }) => {
      const items = await prisma.protocolDocument.findMany({
        where: { tenantId: session.tid },
        include: { manufacturer: true, profiles: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return { items, count: items.length };
    },
  },
  {
    method: "POST",
    pattern: "protocols/documents/upload",
    handler: async ({ session, req }) => {
      await requirePermission("protocol.manage");
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "file 필드가 필요합니다.");
      if (file.size > 40 * 1024 * 1024) throw new HttpError(413, "파일은 40MB 이하만 업로드할 수 있습니다.");
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileName = file.name || "document";
      let extracted;
      try {
        extracted = extractDocument(fileName, buffer);
      } catch (error) {
        throw new HttpError(422, `문서 텍스트 추출 실패: ${(error as Error).message}`);
      }
      const analysis = analyzeDocument({ fileName, text: extracted.text, tables: extracted.tables });
      const manufacturer = analysis.manufacturerGuess
        ? await prisma.manufacturer.findFirst({ where: { name: analysis.manufacturerGuess } })
        : null;
      const doc = await prisma.protocolDocument.create({
        data: {
          tenantId: session.tid,
          manufacturerId: manufacturer?.id,
          title: fileName,
          docType: extracted.docType,
          version: str({ v: form.get("version") ?? "" }, "v", false) || null,
          url: String(form.get("url") ?? "") || null,
          license: String(form.get("license") ?? "UNKNOWN"),
          accessType: String(form.get("accessType") ?? "PUBLIC"),
          fileName,
          fileHash: createHash("sha256").update(buffer).digest("hex"),
          extractedText: extracted.text.slice(0, 200000),
          analysis: { ...analysis, notes: [...extracted.notes, ...analysis.notes] } as object,
          status: "DRAFTED",
          uploadedById: session.uid,
        },
      });
      const profile = await prisma.deviceProfile.create({
        data: {
          tenantId: session.tid,
          manufacturerId: manufacturer?.id,
          name: `${analysis.manufacturerGuess ?? "미확인"} ${analysis.modelGuess ?? ""} (매뉴얼 초안)`.trim(),
          protocolKey: analysis.protocolGuess ?? "unknown",
          transport: analysis.transportGuess,
          settings: { source: "MANUAL_UPLOAD", fileName, docType: extracted.docType },
          registerMap: analysis.registers as unknown as object,
          source: "MANUAL_UPLOAD",
          documentId: doc.id,
          reviewStatus: "PENDING_REVIEW",
          confidence: analysis.confidence,
          notes: analysis.warnings.join("\n"),
          createdById: session.uid,
        },
      });
      await audit(session, "DOCUMENT_UPLOAD", "protocol_document", doc.id, null, { fileName, registers: analysis.registers.length, confidence: analysis.confidence }, req);
      return {
        document: { id: doc.id, title: doc.title, docType: doc.docType, status: doc.status },
        profile: { id: profile.id, reviewStatus: profile.reviewStatus, confidence: profile.confidence },
        analysis,
        extraction: { pages: extracted.pages, notes: extracted.notes, textPreview: extracted.text.slice(0, 2000) },
      };
    },
  },
  {
    method: "GET",
    pattern: "protocols/profiles",
    handler: async ({ session, query }) => {
      const status = query.get("reviewStatus") ?? undefined;
      const items = await prisma.deviceProfile.findMany({
        where: { tenantId: session.tid, ...(status ? { reviewStatus: status } : {}) },
        include: { manufacturer: true, document: { select: { id: true, title: true, docType: true } }, devices: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      });
      return { items, count: items.length };
    },
  },
  {
    method: "GET",
    pattern: "protocols/profiles/:id",
    handler: async ({ session, path }) => {
      const profile = await prisma.deviceProfile.findFirst({
        where: { id: path[2], tenantId: session.tid },
        include: { manufacturer: true, document: true, driver: true, driverVersion: true },
      });
      if (!profile) throw new HttpError(404, "프로파일을 찾을 수 없습니다.");
      return profile;
    },
  },
  {
    method: "PATCH",
    pattern: "protocols/profiles/:id",
    handler: async ({ session, body, path }) => {
      await requirePermission("protocol.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const profile = await prisma.deviceProfile.findFirst({ where: { id: path[2], tenantId: session.tid } });
      if (!profile) throw new HttpError(404, "프로파일을 찾을 수 없습니다.");
      return prisma.deviceProfile.update({
        where: { id: profile.id },
        data: {
          name: data.name !== undefined ? str(data, "name") : undefined,
          protocolKey: data.protocolKey !== undefined ? str(data, "protocolKey") : undefined,
          transport: data.transport !== undefined ? str(data, "transport") : undefined,
          registerMap: data.registerMap !== undefined ? (data.registerMap as object) : undefined,
          settings: data.settings !== undefined ? (data.settings as object) : undefined,
          reviewStatus: data.reviewStatus !== undefined ? str(data, "reviewStatus") : undefined,
          notes: data.notes !== undefined ? String(data.notes) : undefined,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: "protocols/profiles/:id/review",
    handler: async ({ session, body, path, req }) => {
      await requirePermission("protocol.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const profile = await prisma.deviceProfile.findFirst({ where: { id: path[2], tenantId: session.tid } });
      if (!profile) throw new HttpError(404, "프로파일을 찾을 수 없습니다.");
      const approve = bool(data, "approve", false);
      const status = approve ? "APPROVED" : "REJECTED";
      const updated = await prisma.deviceProfile.update({
        where: { id: profile.id },
        data: { reviewStatus: status, notes: data.note ? String(data.note) : profile.notes },
      });
      if (profile.documentId) {
        await prisma.protocolDocument.update({
          where: { id: profile.documentId },
          data: { status: approve ? "APPROVED" : "REJECTED" },
        });
      }
      await audit(session, approve ? "PROFILE_APPROVE" : "PROFILE_REJECT", "device_profile", profile.id, { reviewStatus: profile.reviewStatus }, { reviewStatus: status, note: data.note }, req);
      return updated;
    },
  },
  {
    method: "POST",
    pattern: "protocols/profiles/:id/instantiate",
    handler: async ({ session, body, path, req }) => {
      await requirePermission("device.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const profile = await prisma.deviceProfile.findFirst({ where: { id: path[2], tenantId: session.tid } });
      if (!profile) throw new HttpError(404, "프로파일을 찾을 수 없습니다.");
      if (profile.reviewStatus !== "APPROVED") throw new HttpError(409, "승인된 프로파일만 장치로 등록할 수 있습니다.");
      const siteId = str(data, "siteId");
      const site = await prisma.site.findFirst({ where: { id: siteId, tenantId: session.tid } });
      assert(site, "사업장을 찾을 수 없습니다.", 404);
      const settings = (profile.settings ?? {}) as Record<string, unknown>;
      const device = await prisma.device.create({
        data: {
          tenantId: session.tid,
          siteId,
          profileId: profile.id,
          manufacturerId: profile.manufacturerId,
          modelId: profile.modelId,
          name: str(data, "name", false) || profile.name,
          deviceType: str(data, "deviceType", false) || "PLC",
          protocolKey: profile.protocolKey,
          host: str(data, "host", false) || (typeof settings.host === "string" ? settings.host : null),
          port: optNum(data, "port") ?? (typeof settings.port === "number" ? settings.port : null),
          slaveId: optNum(data, "slaveId") ?? (typeof settings.slaveId === "number" ? settings.slaveId : 1),
        },
      });
      const registers = Array.isArray(profile.registerMap) ? (profile.registerMap as Record<string, unknown>[]) : [];
      for (const [index, reg] of registers.entries()) {
        await prisma.deviceTag.create({
          data: {
            tenantId: session.tid,
            siteId,
            deviceId: device.id,
            key: String(reg.name ?? reg.key ?? `TAG_${index + 1}`).replace(/[^A-Za-z0-9_가-힣]/g, "_").slice(0, 60),
            name: String(reg.name ?? `태그 ${index + 1}`),
            address: Number(reg.address ?? 0),
            functionCode: Number(reg.functionCode ?? 3),
            dataType: String(reg.dataType ?? "UINT16"),
            unit: reg.unit ? String(reg.unit) : null,
            scale: reg.scale !== undefined ? Number(reg.scale) : 1,
          },
        });
      }
      await audit(session, "PROFILE_INSTANTIATE", "device", device.id, null, { profileId: profile.id, tags: registers.length }, req);
      return { device, tagsCreated: registers.length };
    },
  },
  // ── 방식 3: 사용자 정의 프레임
  {
    method: "GET",
    pattern: "protocols/frame/default",
    handler: async () => ({ template: defaultFrameTemplate() }),
  },
  {
    method: "POST",
    pattern: "protocols/frame/preview",
    handler: async ({ body }) => {
      const data = (body ?? {}) as Record<string, unknown>;
      const template = (data.template ?? defaultFrameTemplate()) as FrameTemplate;
      return {
        requestHex: previewFrame(template, {
          slaveId: num(data, "slaveId", 1),
          address: num(data, "address", 0),
          count: num(data, "count", 1),
        }),
      };
    },
  },
  {
    method: "POST",
    pattern: "protocols/frame/test",
    handler: async ({ session, body, req }) => {
      await requirePermission("protocol.manage");
      const data = (body ?? {}) as Record<string, unknown>;
      const template = (data.template ?? defaultFrameTemplate()) as FrameTemplate;
      const result = await testCustomFrame({
        host: str(data, "host"),
        port: num(data, "port"),
        template: { ...template, timeoutMs: num(data, "timeoutMs", template.timeoutMs ?? 1500) },
        variables: { slaveId: num(data, "slaveId", 1), address: num(data, "address", 0), count: num(data, "count", 1) },
      });
      await audit(session, "FRAME_TEST", "custom_frame", null, null, { request: result.requestHex, value: result.value }, req);
      return result;
    },
  },
  {
    method: "GET",
    pattern: "protocols/compatibility",
    handler: async ({ session }) => {
      const drivers = await prisma.protocolDriver.findMany({ where: { tenantId: session.tid } });
      const rows = PROTOCOL_CATALOG.map((entry) => ({
        protocol: entry.name,
        key: entry.key,
        family: entry.family,
        transport: entry.transport,
        docsUrl: entry.docsUrl,
        docTitle: entry.docTitle,
        license: entry.license,
        implementation: entry.status,
        verifiedNote: entry.verifiedNote,
        customDriver: drivers.find((d) => d.key === entry.key)?.status ?? null,
        lastChecked: "2026-11-22",
      }));
      const statusCounts = rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.implementation] = (acc[row.implementation] ?? 0) + 1;
        return acc;
      }, {});
      return { rows, statusCounts, fieldVerifiedCount: statusCounts.FIELD_VERIFIED ?? 0 };
    },
  },
];
