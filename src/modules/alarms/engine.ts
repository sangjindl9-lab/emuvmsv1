import prisma from "@/lib/db";
import type { TagValue } from "@/modules/protocol/drivers";

/**
 * 알람 규칙 평가 엔진.
 * 동일 규칙·대상에 활성 알람이 있으면 repeatCount만 증가시키고, 정상 복귀 시 RESOLVED 처리한다.
 */
export type AlarmRuleLike = {
  id: string;
  tenantId: string;
  siteId: string | null;
  name: string;
  targetType: string;
  targetId: string | null;
  condition: string;
  threshold: number | null;
  threshold2: number | null;
  durationSec: number;
  severity: string;
  enabled: boolean;
};

export function isTriggered(rule: AlarmRuleLike, value: number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  switch (rule.condition) {
    case "GT":
      return rule.threshold !== null && value > rule.threshold;
    case "LT":
      return rule.threshold !== null && value < rule.threshold;
    case "EQ":
      return rule.threshold !== null && value === rule.threshold;
    case "NE":
      return rule.threshold !== null && value !== rule.threshold;
    case "OUT_OF_RANGE":
      return rule.threshold !== null && rule.threshold2 !== null && (value < rule.threshold || value > rule.threshold2);
    case "RATE_OF_CHANGE":
      return false;
    default:
      return false;
  }
}

export async function evaluateTagAlarms(input: {
  tenantId: string;
  siteId: string;
  deviceId: string;
  tagId: string;
  tagName: string;
  value: TagValue;
}): Promise<{ created: number; resolved: number }> {
  const rules = await prisma.alarmRule.findMany({
    where: { tenantId: input.tenantId, enabled: true, targetType: "TAG", targetId: input.tagId },
  });
  let created = 0;
  let resolved = 0;
  for (const rule of rules) {
    const numeric = typeof input.value.value === "number" ? input.value.value : null;
    const active = await prisma.alarmEvent.findFirst({
      where: { tenantId: input.tenantId, ruleId: rule.id, tagId: input.tagId, status: { in: ["ACTIVE", "ACK", "ASSIGNED"] } },
    });
    const triggered =
      input.value.quality === "BAD" || input.value.quality === "UNCERTAIN"
        ? rule.condition === "COMM_FAIL"
        : isTriggered(rule, numeric);
    if (triggered) {
      if (active) {
        await prisma.alarmEvent.update({
          where: { id: active.id },
          data: { repeatCount: { increment: 1 }, message: `${input.tagName}=${input.value.value ?? "통신불량"}` },
        });
      } else {
        await prisma.alarmEvent.create({
          data: {
            tenantId: input.tenantId,
            siteId: input.siteId,
            ruleId: rule.id,
            tagId: input.tagId,
            deviceId: input.deviceId,
            severity: rule.severity,
            code: `TAG_${rule.condition}`,
            title: rule.name,
            message: `${input.tagName}=${input.value.value ?? "통신불량"} (${rule.condition}${rule.threshold !== null ? ` ${rule.threshold}` : ""})`,
            value: numeric,
            status: "ACTIVE",
          },
        });
        created += 1;
      }
    } else if (active) {
      await prisma.alarmEvent.update({
        where: { id: active.id },
        data: { status: "RESOLVED", resolvedAt: new Date(), resolution: "자동 복구(값 정상)" },
      });
      resolved += 1;
    }
  }
  return { created, resolved };
}

export async function evaluateDeviceCommAlarms(input: {
  tenantId: string;
  siteId: string;
  deviceId: string;
  deviceName: string;
  failed: boolean;
  error?: string;
}): Promise<void> {
  const rules = await prisma.alarmRule.findMany({
    where: { tenantId: input.tenantId, enabled: true, targetType: "DEVICE", targetId: input.deviceId, condition: "COMM_FAIL" },
  });
  for (const rule of rules) {
    const active = await prisma.alarmEvent.findFirst({
      where: { tenantId: input.tenantId, ruleId: rule.id, deviceId: input.deviceId, status: { in: ["ACTIVE", "ACK", "ASSIGNED"] } },
    });
    if (input.failed && !active) {
      await prisma.alarmEvent.create({
        data: {
          tenantId: input.tenantId,
          siteId: input.siteId,
          ruleId: rule.id,
          deviceId: input.deviceId,
          severity: rule.severity,
          code: "COMM_FAIL",
          title: rule.name,
          message: `${input.deviceName} 통신 장애: ${input.error ?? "응답 없음"}`,
          status: "ACTIVE",
        },
      });
    } else if (!input.failed && active) {
      await prisma.alarmEvent.update({
        where: { id: active.id },
        data: { status: "RESOLVED", resolvedAt: new Date(), resolution: "통신 복구" },
      });
    }
  }
}

/** 임계값 규칙 자동 생성 헬퍼 (태그 등록 시 사용) */
export function ruleDataForTag(tag: {
  tenantId: string;
  siteId: string;
  id: string;
  name: string;
  alarmHigh: number | null;
  alarmLow: number | null;
}) {
  const rules: {
    tenantId: string;
    siteId: string;
    name: string;
    targetType: string;
    targetId: string;
    condition: string;
    threshold: number;
    severity: string;
  }[] = [];
  if (tag.alarmHigh !== null && tag.alarmHigh !== undefined) {
    rules.push({
      tenantId: tag.tenantId,
      siteId: tag.siteId,
      name: `${tag.name} 상한 초과`,
      targetType: "TAG",
      targetId: tag.id,
      condition: "GT",
      threshold: tag.alarmHigh,
      severity: "WARNING",
    });
  }
  if (tag.alarmLow !== null && tag.alarmLow !== undefined) {
    rules.push({
      tenantId: tag.tenantId,
      siteId: tag.siteId,
      name: `${tag.name} 하한 미달`,
      targetType: "TAG",
      targetId: tag.id,
      condition: "LT",
      threshold: tag.alarmLow,
      severity: "WARNING",
    });
  }
  return rules;
}
