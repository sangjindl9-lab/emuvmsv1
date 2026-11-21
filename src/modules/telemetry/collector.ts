import prisma from "@/lib/db";
import { getDriver, toTagSpec, type TagValue } from "@/modules/protocol/drivers";
import { evaluateDeviceCommAlarms, evaluateTagAlarms } from "@/modules/alarms/engine";

export type CollectionReport = {
  startedAt: string;
  finishedAt: string;
  devices: number;
  okDevices: number;
  failedDevices: number;
  tags: number;
  goodTags: number;
  badTags: number;
  alarmsCreated: number;
  alarmsResolved: number;
  errors: { device: string; error: string }[];
};

export async function collectDevice(deviceId: string): Promise<{
  deviceId: string;
  ok: boolean;
  values: number;
  error?: string;
}> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { tags: { where: { enabled: true } } },
  });
  if (!device || !device.enabled) return { deviceId, ok: false, values: 0, error: "장치가 없거나 비활성" };
  if (!device.host || !device.port) {
    await prisma.device.update({ where: { id: device.id }, data: { quality: "BAD", lastError: "통신 정보 없음" } });
    return { deviceId, ok: false, values: 0, error: "IP/포트 정보 없음" };
  }
  try {
    const driver = getDriver({
      id: device.id,
      protocolKey: device.protocolKey,
      host: device.host,
      port: device.port,
      unitId: device.slaveId ?? 1,
      timeoutMs: device.timeoutMs,
      retries: device.retryCount,
    });
    const results = await driver.readTags(device.tags.map(toTagSpec));
    const now = new Date();
    let good = 0;
    let bad = 0;
    for (const result of results) {
      const tag = device.tags.find((t) => t.key === result.key);
      if (!tag) continue;
      const numeric = typeof result.value === "number" ? result.value : result.value === true ? 1 : result.value === false ? 0 : null;
      const text = typeof result.value === "string" ? result.value : null;
      const quality = result.quality;
      if (quality === "GOOD") good += 1;
      else bad += 1;
      await prisma.deviceTag.update({
        where: { id: tag.id },
        data: { lastValue: numeric, lastValueText: text, lastReadAt: now, quality },
      });
      if (quality === "GOOD" && numeric !== null) {
        await prisma.tagReading.create({
          data: { tenantId: device.tenantId, siteId: device.siteId, tagId: tag.id, ts: now, value: numeric, quality, raw: result.raw ? { registers: result.raw } : undefined },
        });
      }
      await evaluateTagAlarms({
        tenantId: device.tenantId,
        siteId: device.siteId,
        deviceId: device.id,
        tagId: tag.id,
        tagName: tag.name,
        value: result as TagValue,
      });
    }
    const quality = bad === 0 ? "GOOD" : good > 0 ? "UNCERTAIN" : "BAD";
    await prisma.device.update({
      where: { id: device.id },
      data: { quality, lastSeenAt: new Date(), lastError: bad > 0 ? `${bad}개 태그 오류` : null },
    });
    await evaluateDeviceCommAlarms({
      tenantId: device.tenantId,
      siteId: device.siteId,
      deviceId: device.id,
      deviceName: device.name,
      failed: quality === "BAD",
      error: bad > 0 ? `${bad}개 태그 응답 오류` : undefined,
    });
    await prisma.deviceConnection.create({
      data: {
        tenantId: device.tenantId,
        deviceId: device.id,
        transport: device.protocolKey,
        host: device.host,
        port: device.port,
        status: quality === "BAD" ? "ERROR" : "CONNECTED",
        connectedAt: new Date(),
        stats: { good, bad, tags: results.length, rttMs: driver instanceof Object ? undefined : undefined },
      },
    });
    return { deviceId: device.id, ok: quality !== "BAD", values: results.length };
  } catch (error) {
    const message = (error as Error).message;
    await prisma.device.update({
      where: { id: device.id },
      data: { quality: "BAD", lastError: message },
    });
    await evaluateDeviceCommAlarms({
      tenantId: device.tenantId,
      siteId: device.siteId,
      deviceId: device.id,
      deviceName: device.name,
      failed: true,
      error: message,
    });
    return { deviceId, ok: false, values: 0, error: message };
  }
}

export async function runCollectionCycle(tenantId: string, siteId?: string): Promise<CollectionReport> {
  const startedAt = new Date();
  const devices = await prisma.device.findMany({
    where: { tenantId, enabled: true, ...(siteId ? { siteId } : {}) },
    select: { id: true, name: true, host: true },
  });
  let goodTags = 0;
  let badTags = 0;
  let alarmsCreated = 0;
  let alarmsResolved = 0;
  let okDevices = 0;
  const errors: { device: string; error: string }[] = [];
  for (const device of devices) {
    if (!device.host) {
      errors.push({ device: device.name, error: "IP 정보 없음" });
      continue;
    }
    const before = await prisma.alarmEvent.count({
      where: { tenantId, occurredAt: { gte: startedAt } },
    });
    const result = await collectDevice(device.id);
    const after = await prisma.alarmEvent.count({
      where: { tenantId, occurredAt: { gte: startedAt } },
    });
    alarmsCreated += after - before;
    alarmsResolved += 0;
    if (result.ok) okDevices += 1;
    else errors.push({ device: device.name, error: result.error ?? "통신 실패" });
    const latest = await prisma.tagReading.groupBy({
      by: ["quality"],
      where: { tenantId, ts: { gte: startedAt } },
      _count: { _all: true },
    });
    goodTags = latest.find((g) => g.quality === "GOOD")?._count._all ?? 0;
    badTags = latest.find((g) => g.quality === "BAD")?._count._all ?? 0;
  }
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    devices: devices.length,
    okDevices,
    failedDevices: devices.length - okDevices,
    tags: goodTags + badTags,
    goodTags,
    badTags,
    alarmsCreated,
    alarmsResolved,
    errors,
  };
}
