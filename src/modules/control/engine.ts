import prisma from "@/lib/db";
import { audit, HttpError, type SessionPayload } from "@/lib/auth";
import { getDriver, toTagSpec } from "@/modules/protocol/drivers";

/**
 * 원격 전력제어 안전 절차:
 * 권한 → 이중 승인 → Local/Remote 확인 → 설비 상태/인터록 확인 → 명령 전송
 * → 실행 피드백 확인 → 최종 상태 검증 → 감사로그. 실패/불확정 시 자동 재전송하지 않는다.
 */
export type ControlInterlockConfig = {
  control?: { tagId: string; openValue: number; closeValue: number; startValue?: number; stopValue?: number };
  feedback?: { tagId: string; openValue: number; closedValue: number; runningValue?: number; stoppedValue?: number };
  requireLocalRemote?: boolean;
  localRemoteTagId?: string;
  remoteValue?: number;
  interlocks?: { tagId: string; expected: number; description?: string }[];
};

const ALLOWED: Record<string, string[]> = {
  BREAKER: ["OPEN", "CLOSE"],
  VCB: ["OPEN", "CLOSE"],
  ACB: ["OPEN", "CLOSE"],
  MCCB: ["OPEN", "CLOSE"],
  ATS: ["OPEN", "CLOSE", "START", "STOP"],
  GENERATOR: ["START", "STOP"],
  UPS: ["START", "STOP"],
  PV_INVERTER: ["START", "STOP", "SETPOINT"],
  ESS: ["START", "STOP", "SETPOINT"],
  EV_CHARGER: ["START", "STOP", "SETPOINT"],
};

export async function readTagValue(tagId: string): Promise<{ value: number | null; quality: string; error?: string }> {
  const tag = await prisma.deviceTag.findUnique({ where: { id: tagId }, include: { device: true } });
  if (!tag) throw new HttpError(404, "태그를 찾을 수 없습니다.");
  const device = tag.device;
  if (!device.host || !device.port) throw new HttpError(400, "장치 통신 정보(IP/포트)가 없습니다.");
  try {
    const driver = getDriver({
      id: device.id,
      protocolKey: device.protocolKey,
      host: device.host,
      port: device.port,
      unitId: device.slaveId ?? 1,
      timeoutMs: device.timeoutMs,
      retries: 0,
    });
    const [result] = await driver.readTags([toTagSpec(tag)]);
    const numeric = typeof result.value === "number" ? result.value : result.value === true ? 1 : result.value === false ? 0 : null;
    return { value: numeric, quality: result.quality, error: result.error };
  } catch (error) {
    return { value: null, quality: "BAD", error: (error as Error).message };
  }
}

export class ControlEngine {
  constructor(private session: SessionPayload, private req?: Request) {}

  async request(input: {
    assetId: string;
    command: string;
    payload?: Record<string, unknown>;
    reason?: string;
    idempotencyKey: string;
    requiredApprovals?: number;
  }) {
    const asset = await prisma.electricalAsset.findFirst({
      where: { id: input.assetId, tenantId: this.session.tid },
    });
    if (!asset) throw new HttpError(404, "설비를 찾을 수 없습니다.");
    const existing = await prisma.controlCommand.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { command: existing, duplicated: true };
    if (!asset.remoteControlEnabled) throw new HttpError(409, "이 설비는 원격제어가 허용되지 않았습니다.");
    const allowed = ALLOWED[asset.assetType] ?? [];
    if (!allowed.includes(input.command)) {
      throw new HttpError(409, `${asset.name}(${asset.assetType})은 ${input.command} 명령을 지원하지 않습니다.`);
    }
    if (asset.status === "TRIP") throw new HttpError(409, "트립 상태의 설비에는 제어 명령을 보낼 수 없습니다. 현장 확인이 필요합니다.");

    const command = await prisma.controlCommand.create({
      data: {
        tenantId: this.session.tid,
        siteId: asset.siteId,
        assetId: asset.id,
        command: input.command,
        payload: input.payload as object | undefined,
        requestedById: this.session.uid,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        requiredApprovals: input.requiredApprovals ?? 2,
        status: "REQUESTED",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    await audit(this.session, "CONTROL_REQUEST", "control_command", command.id, null, { command: input.command, asset: asset.name, reason: input.reason }, this.req);
    return { command, duplicated: false };
  }

  async approve(input: { commandId: string; decision: "APPROVED" | "REJECTED"; comment?: string }) {
    const command = await prisma.controlCommand.findFirst({
      where: { id: input.commandId, tenantId: this.session.tid },
      include: { approvals: true },
    });
    if (!command) throw new HttpError(404, "제어 명령을 찾을 수 없습니다.");
    if (command.requestedById === this.session.uid) {
      throw new HttpError(409, "요청자 본인은 승인할 수 없습니다. 다른 승인자가 필요합니다.");
    }
    if (!["REQUESTED", "APPROVED"].includes(command.status)) {
      throw new HttpError(409, `현재 상태(${command.status})에서는 승인할 수 없습니다.`);
    }
    const already = command.approvals.find((a) => a.approverId === this.session.uid);
    if (already) throw new HttpError(409, "이미 이 명령에 참여했습니다.");
    await prisma.controlApproval.create({
      data: {
        tenantId: this.session.tid,
        commandId: command.id,
        approverId: this.session.uid,
        decision: input.decision,
        comment: input.comment,
      },
    });
    let status = command.status;
    if (input.decision === "REJECTED") {
      status = "REJECTED";
    } else {
      const count = command.approvals.filter((a) => a.decision === "APPROVED").length + 1;
      if (count >= command.requiredApprovals) status = "APPROVED";
    }
    const updated = await prisma.controlCommand.update({ where: { id: command.id }, data: { status } });
    await audit(this.session, `CONTROL_${input.decision}`, "control_command", command.id, { status: command.status }, { status, comment: input.comment }, this.req);
    return updated;
  }

  async execute(commandId: string) {
    const command = await prisma.controlCommand.findFirst({
      where: { id: commandId, tenantId: this.session.tid },
      include: { asset: true, approvals: true },
    });
    if (!command) throw new HttpError(404, "제어 명령을 찾을 수 없습니다.");
    if (command.status === "SENT" || command.status === "FEEDBACK_OK" || command.status === "FEEDBACK_FAIL" || command.status === "UNCERTAIN") {
      throw new HttpError(409, `이미 실행된 명령입니다(상태: ${command.status}). 중복 실행하지 않습니다.`);
    }
    if (command.status !== "APPROVED") {
      throw new HttpError(409, `승인이 완료되지 않았습니다(상태: ${command.status}).`);
    }
    if (command.expiresAt && command.expiresAt.getTime() < Date.now()) {
      await prisma.controlCommand.update({ where: { id: command.id }, data: { status: "EXPIRED", errorMessage: "승인 유효시간 초과" } });
      throw new HttpError(409, "승인 유효시간이 지났습니다. 다시 요청하세요.");
    }
    const asset = command.asset;
    const cfg = (asset.interlocks ?? {}) as ControlInterlockConfig;
    const checks: Record<string, unknown> = {};

    // 1) Local/Remote
    if (cfg.requireLocalRemote && cfg.localRemoteTagId) {
      const lr = await readTagValue(cfg.localRemoteTagId);
      checks.localRemote = lr;
      if (lr.value === null) {
        await this.fail(command.id, "UNCERTAIN", "Local/Remote 상태를 확인할 수 없습니다.");
        throw new HttpError(409, "Local/Remote 상태 확인 불가: 명령을 전송하지 않았습니다.");
      }
      if (lr.value !== (cfg.remoteValue ?? 1)) {
        await this.fail(command.id, "REJECTED", "현장 스위치가 LOCAL 상태입니다.");
        throw new HttpError(409, "현장이 LOCAL 상태여서 원격 명령을 전송하지 않았습니다.");
      }
    }

    // 2) 인터록
    for (const interlock of cfg.interlocks ?? []) {
      const value = await readTagValue(interlock.tagId);
      checks[`interlock:${interlock.tagId}`] = value;
      if (value.value === null || value.value !== interlock.expected) {
        await prisma.controlCommand.update({
          where: { id: command.id },
          data: { status: "REJECTED", interlockCheck: checks as object, errorMessage: `인터록 불충족: ${interlock.description ?? interlock.tagId}` },
        });
        await this.alarm(asset.siteId, "INTERLOCK_BLOCK", `인터록으로 제어 차단: ${asset.name} ${command.command}`);
        throw new HttpError(409, `인터록 조건이 충족되지 않았습니다: ${interlock.description ?? interlock.tagId}`);
      }
    }

    // 3) 설비 상태 재확인
    const currentAsset = await prisma.electricalAsset.findUnique({ where: { id: asset.id } });
    if (!currentAsset || currentAsset.status === "TRIP") {
      await this.fail(command.id, "REJECTED", "설비가 트립 상태입니다.");
      throw new HttpError(409, "설비가 트립 상태입니다.");
    }
    checks.assetStatus = currentAsset.status;
    checks.breakerState = currentAsset.breakerState;
    await prisma.controlCommand.update({
      where: { id: command.id },
      data: { status: "SENDING", interlockCheck: checks as object, localRemoteState: cfg.requireLocalRemote ? "REMOTE" : "UNKNOWN", sentAt: new Date() },
    });

    // 4) 명령 전송
    try {
      if (!cfg.control?.tagId) throw new Error("제어 태그가 설비에 매핑되지 않았습니다.");
      const controlTag = await prisma.deviceTag.findUnique({ where: { id: cfg.control.tagId }, include: { device: true } });
      if (!controlTag || !controlTag.device.host || !controlTag.device.port) throw new Error("제어 태그/장치 정보가 없습니다.");
      const writeValue = command.command === "OPEN" || command.command === "STOP" ? cfg.control.openValue ?? cfg.control.stopValue ?? 0 :
        command.command === "START" ? cfg.control.startValue ?? 1 : cfg.control.closeValue ?? 1;
      const driver = getDriver({
        id: controlTag.device.id,
        protocolKey: controlTag.device.protocolKey,
        host: controlTag.device.host,
        port: controlTag.device.port,
        unitId: controlTag.device.slaveId ?? 1,
        timeoutMs: controlTag.device.timeoutMs,
        retries: 0,
      });
      await driver.writeTag(toTagSpec(controlTag), writeValue);
      await prisma.controlFeedback.create({
        data: { tenantId: this.session.tid, commandId: command.id, state: "ACK", detail: `제어값 ${writeValue} 전송`, success: true },
      });
    } catch (error) {
      await prisma.controlFeedback.create({
        data: { tenantId: this.session.tid, commandId: command.id, state: "FAILED", detail: (error as Error).message, success: false },
      });
      await this.fail(command.id, "UNCERTAIN", `명령 전송 실패: ${(error as Error).message}`);
      await this.alarm(asset.siteId, "CONTROL_FAIL", `제어 명령 전송 실패: ${asset.name} ${command.command}`);
      throw new HttpError(502, `명령 전송에 실패했습니다(자동 재전송하지 않음): ${(error as Error).message}`);
    }

    // 5) 피드백 확인 (최대 5초)
    let finalOk = false;
    let lastFeedback: { value: number | null; quality: string } = { value: null, quality: "BAD" };
    const expectedOpen = command.command === "OPEN" || command.command === "STOP";
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 600));
      if (cfg.feedback?.tagId) {
        lastFeedback = await readTagValue(cfg.feedback.tagId);
        if (lastFeedback.value !== null) {
          const expected = expectedOpen
            ? cfg.feedback.openValue ?? cfg.feedback.stoppedValue ?? 0
            : cfg.feedback.closedValue ?? cfg.feedback.runningValue ?? 1;
          finalOk = lastFeedback.value === expected;
          await prisma.controlFeedback.create({
            data: {
              tenantId: this.session.tid,
              commandId: command.id,
              state: finalOk ? (expectedOpen ? "POSITION_OPEN" : "POSITION_CLOSED") : "FEEDBACK_PENDING",
              detail: `피드백 값 ${lastFeedback.value} (기대 ${expected})`,
              success: finalOk,
              measured: { value: lastFeedback.value, quality: lastFeedback.quality },
            },
          });
          if (finalOk) break;
        }
      } else {
        // 피드백 태그가 없으면 확인 불가 → 불확정 처리
        break;
      }
    }

    const status = finalOk ? "FEEDBACK_OK" : "UNCERTAIN";
    const updated = await prisma.controlCommand.update({
      where: { id: command.id },
      data: {
        status,
        completedAt: new Date(),
        finalState: finalOk ? (expectedOpen ? "OPEN" : "CLOSED") : "UNKNOWN",
        errorMessage: finalOk ? null : "피드백 미확인. 현장 확인 필요(자동 재전송 안 함).",
      },
    });
    if (finalOk) {
      await prisma.electricalAsset.update({
        where: { id: asset.id },
        data: { breakerState: expectedOpen ? "OPEN" : "CLOSED" },
      });
    } else {
      await this.alarm(asset.siteId, "CONTROL_UNCERTAIN", `제어 결과 불확정: ${asset.name} ${command.command} — 현장 확인 필요`);
    }
    await audit(this.session, "CONTROL_EXECUTE", "control_command", command.id, { status: "SENDING" }, { status, feedback: lastFeedback }, this.req);
    return updated;
  }

  private async fail(commandId: string, status: "UNCERTAIN" | "REJECTED", message: string) {
    await prisma.controlCommand.update({
      where: { id: commandId },
      data: { status, errorMessage: message, completedAt: new Date() },
    });
    await audit(this.session, "CONTROL_ABORT", "control_command", commandId, null, { status, message }, this.req);
  }

  private async alarm(siteId: string, code: string, title: string) {
    await prisma.alarmEvent.create({
      data: {
        tenantId: this.session.tid,
        siteId,
        severity: "MAJOR",
        code,
        title,
        status: "ACTIVE",
      },
    });
  }
}
