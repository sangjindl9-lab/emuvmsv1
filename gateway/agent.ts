/**
 * EUMBMS Edge Gateway Agent
 * 현장에서 PLC/RTU/계량기와 통신하고, 중앙 서버로 수집값을 전송한다.
 * 중앙 서버와 통신이 끊기면 로컬 버퍼(JSONL)에 저장했다가 복구 후 순서대로 동기화한다.
 * PLC/RTU는 인터넷에 직접 노출되지 않으며, 게이트웨이는 중앙 서버로만 outbound 연결한다.
 *
 * 환경변수
 *  EUMBMS_CENTRAL_URL   예: http://bms.example.com  (기본 http://127.0.0.1:3000)
 *  EUMBMS_GATEWAY_TOKEN 게이트웨이 등록 시 발급된 eum_... 토큰 (필수)
 *  EUMBMS_POLL_MS       폴링 주기 기본 2000
 *  EUMBMS_BUFFER_DIR    오프라인 버퍼 디렉터리 (기본 ./.queue)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { getDriver, type TagSpec } from "../src/modules/protocol/drivers";
import type { ModbusTransport } from "../src/modules/protocol/modbus/client";

type RemoteTag = { id: string; key: string; name: string; address: number; functionCode: number; dataType: string; byteOrder: string; wordOrder: string; scale: number; offset: number };
type RemoteDevice = {
  id: string;
  name: string;
  protocolKey: string;
  host: string | null;
  port: number | null;
  slaveId: number | null;
  pollingMs: number;
  timeoutMs: number;
  retryCount: number;
  tags: RemoteTag[];
};
type Handshake = { gateway: { id: string; name: string; serial: string }; site: { name: string } | null; devices: RemoteDevice[]; serverTime: string };
type BufferedReading = { deviceId: string; tagId: string; value: number | null; quality: string; ts: string };

const CENTRAL = (process.env.EUMBMS_CENTRAL_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const TOKEN = process.env.EUMBMS_GATEWAY_TOKEN ?? "";
const POLL_MS = Number(process.env.EUMBMS_POLL_MS ?? 2000);
const BUFFER_DIR = process.env.EUMBMS_BUFFER_DIR ?? "./.queue";
const HEARTBEAT_MS = 15000;

if (!TOKEN) {
  console.error("EUMBMS_GATEWAY_TOKEN 환경변수가 필요합니다.");
  process.exit(1);
}

mkdirSync(BUFFER_DIR, { recursive: true });

async function call<T>(pathName: string, body?: unknown): Promise<T> {
  const response = await fetch(`${CENTRAL}/api/v1/${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-gateway-token": TOKEN },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathName} ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

function bufferSize(): number {
  try {
    return readdirSync(BUFFER_DIR).filter((f) => f.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

function bufferReadings(readings: BufferedReading[]) {
  if (readings.length === 0) return;
  const file = path.join(BUFFER_DIR, `buffer-${Date.now()}.jsonl`);
  writeFileSync(file, readings.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.warn(`[gateway] 중앙 서버 연결 실패 → ${readings.length}건 로컬 버퍼 저장 (${file})`);
}

async function flushBuffer() {
  const files = readdirSync(BUFFER_DIR).filter((f) => f.endsWith(".jsonl")).sort();
  for (const file of files) {
    const full = path.join(BUFFER_DIR, file);
    const lines = readFileSync(full, "utf8").split("\n").filter(Boolean);
    const readings = lines.map((line) => JSON.parse(line) as BufferedReading);
    try {
      for (let i = 0; i < readings.length; i += 500) {
        await call("gateway/ingest", { readings: readings.slice(i, i + 500) });
      }
      renameSync(full, `${full}.synced`);
      console.log(`[gateway] 버퍼 동기화 완료: ${readings.length}건 (${file})`);
    } catch (error) {
      console.warn(`[gateway] 버퍼 동기화 실패, 다음 주기에 재시도: ${(error as Error).message}`);
      return;
    }
  }
}

function transportOf(protocolKey: string): ModbusTransport {
  if (protocolKey === "modbus-rtu" || protocolKey === "modbus-rtu-over-tcp") return "MODBUS_RTU_OVER_TCP";
  if (protocolKey === "modbus-ascii") return "MODBUS_ASCII_OVER_TCP";
  return "MODBUS_TCP";
}

async function main() {
  console.log(`[gateway] 중앙 서버 ${CENTRAL} 연결 시도`);
  let config = await call<Handshake>("gateway/handshake");
  console.log(`[gateway] 등록됨: ${config.gateway.name} (${config.gateway.serial}) / 사업장 ${config.site?.name ?? "-"} / 장치 ${config.devices.length}대`);
  setInterval(() => {
    void call("gateway/heartbeat", { bufferDepth: bufferSize(), firmware: "eum-edge/2.0.0" }).catch(() => undefined);
  }, HEARTBEAT_MS);

  let running = true;
  const stop = () => {
    running = false;
    console.log("[gateway] 종료합니다.");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (running) {
    const started = Date.now();
    await flushBuffer().catch(() => undefined);
    const batch: BufferedReading[] = [];
    for (const device of config.devices) {
      if (!device.host || !device.port) continue;
      try {
        const driver = getDriver(
          {
            id: device.id,
            protocolKey: device.protocolKey,
            host: device.host,
            port: device.port,
            unitId: device.slaveId ?? 1,
            transport: transportOf(device.protocolKey),
            timeoutMs: device.timeoutMs,
            retries: device.retryCount,
          },
          true,
        );
        const specs: TagSpec[] = device.tags.map((tag) => ({
          key: tag.key,
          name: tag.name,
          address: tag.address,
          functionCode: tag.functionCode,
          dataType: tag.dataType,
          byteOrder: tag.byteOrder === "BA" ? "BA" : "AB",
          wordOrder: tag.wordOrder as TagSpec["wordOrder"],
          scale: tag.scale,
          offset: tag.offset,
        }));
        const values = await driver.readTags(specs);
        for (const value of values) {
          const tag = device.tags.find((t) => t.key === value.key);
          if (!tag) continue;
          batch.push({
            deviceId: device.id,
            tagId: tag.id,
            value: typeof value.value === "number" ? value.value : value.value === true ? 1 : value.value === false ? 0 : null,
            quality: value.quality,
            ts: value.at,
          });
        }
      } catch (error) {
        console.warn(`[gateway] 장치 ${device.name} 수집 실패: ${(error as Error).message}`);
      }
    }
    if (batch.length > 0) {
      try {
        const result = await call<{ stored: number; errors: string[] }>("gateway/ingest", { readings: batch });
        console.log(`[gateway] 전송 ${result.stored}건${result.errors.length ? `, 오류 ${result.errors.length}건` : ""}`);
      } catch (error) {
        bufferReadings(batch);
      }
    }
    // 설정 주기적 갱신 (장치/태그 변경 반영)
    if (Date.now() - started > 60000) {
      try {
        config = await call<Handshake>("gateway/handshake");
      } catch {
        // 다음 주기 재시도
      }
    }
    const wait = Math.max(200, POLL_MS - (Date.now() - started));
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

main().catch((error) => {
  console.error("[gateway] 치명적 오류", error);
  process.exit(1);
});
