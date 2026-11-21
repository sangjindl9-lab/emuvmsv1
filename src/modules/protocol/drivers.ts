import { ModbusTcpClient, type ModbusTransport } from "./modbus/client";
import {
  ModbusException,
  numberToRegisters,
  registerCount,
  registersToNumber,
  type WordOrder,
} from "./modbus/pdu";

export type TagSpec = {
  key: string;
  name?: string;
  address: number;
  functionCode: number;
  dataType: string;
  byteOrder?: "AB" | "BA";
  wordOrder?: WordOrder;
  scale?: number;
  offset?: number;
};

export type TagValue = {
  key: string;
  value: number | string | boolean | null;
  quality: "GOOD" | "UNCERTAIN" | "BAD" | "STALE";
  error?: string;
  raw?: number[];
  at: string;
};

export type ConnectionTestResult = {
  ok: boolean;
  rttMs: number | null;
  detail: string;
  sample?: TagValue[];
};

export interface DeviceDriver {
  readonly protocolKey: string;
  testConnection(): Promise<ConnectionTestResult>;
  readTags(tags: TagSpec[]): Promise<TagValue[]>;
  writeTag(tag: TagSpec, value: number): Promise<void>;
  close(): void;
}

const now = () => new Date().toISOString();

function applyScale(raw: number | string | boolean, tag: TagSpec): number | string | boolean {
  if (typeof raw !== "number") return raw;
  const scale = tag.scale ?? 1;
  const offset = tag.offset ?? 0;
  const value = raw * scale + offset;
  return Number.isFinite(value) ? Number(value.toFixed(6)) : raw;
}

export class ModbusDriver implements DeviceDriver {
  readonly protocolKey: string;
  private client: ModbusTcpClient;

  constructor(options: {
    protocolKey?: string;
    host: string;
    port: number;
    unitId: number;
    transport?: ModbusTransport;
    timeoutMs?: number;
    retries?: number;
    pollGapMs?: number;
  }) {
    this.protocolKey = options.protocolKey ?? "modbus-tcp";
    this.client = new ModbusTcpClient({
      host: options.host,
      port: options.port,
      unitId: options.unitId,
      transport: options.transport,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
      pollGapMs: options.pollGapMs,
    });
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      await this.client.connect();
      const regs = await this.client.readHoldingRegisters(0, 1);
      return {
        ok: true,
        rttMs: Date.now() - started,
        detail: `연결 성공, Holding[0]=${regs[0]}`,
      };
    } catch (error) {
      return { ok: false, rttMs: null, detail: (error as Error).message };
    }
  }

  async readTags(tags: TagSpec[]): Promise<TagValue[]> {
    const results: TagValue[] = [];
    for (const tag of tags) {
      const count = registerCount(tag.dataType);
      try {
        let raw: number | string | boolean;
        let rawRegs: number[] = [];
        if (tag.dataType.toUpperCase() === "BOOL" || tag.functionCode === 1 || tag.functionCode === 2) {
          const bits =
            tag.functionCode === 2
              ? await this.client.readDiscreteInputs(tag.address, 1)
              : await this.client.readCoils(tag.address, 1);
          raw = bits[0];
        } else {
          const regs =
            tag.functionCode === 4
              ? await this.client.readInputRegisters(tag.address, count)
              : await this.client.readHoldingRegisters(tag.address, count);
          rawRegs = regs;
          raw = registersToNumber(regs, tag.dataType, tag.wordOrder ?? "ABCD");
        }
        results.push({
          key: tag.key,
          value: applyScale(raw, tag),
          quality: "GOOD",
          raw: rawRegs,
          at: now(),
        });
      } catch (error) {
        const message = error instanceof ModbusException ? error.message : (error as Error).message;
        results.push({
          key: tag.key,
          value: null,
          quality: error instanceof ModbusException && [2, 10, 11].includes(error.code) ? "BAD" : "UNCERTAIN",
          error: message,
          at: now(),
        });
      }
    }
    return results;
  }

  async writeTag(tag: TagSpec, value: number): Promise<void> {
    if (tag.dataType.toUpperCase() === "BOOL" || tag.functionCode === 5) {
      await this.client.writeSingleCoil(tag.address, value !== 0);
      return;
    }
    const regs = numberToRegisters(value, tag.dataType, tag.wordOrder ?? "ABCD");
    if (regs.length === 1) {
      await this.client.writeSingleRegister(tag.address, regs[0]);
    } else {
      await this.client.writeMultipleRegisters(tag.address, regs);
    }
  }

  close(): void {
    this.client.close();
  }
}

const driverCache = new Map<string, DeviceDriver>();

export type DeviceEndpoint = {
  id: string;
  protocolKey: string;
  transport?: ModbusTransport;
  host: string;
  port: number;
  unitId: number;
  timeoutMs?: number;
  retries?: number;
  pollGapMs?: number;
};

export function getDriver(endpoint: DeviceEndpoint, reuse = true): DeviceDriver {
  const cacheKey = `${endpoint.id}:${endpoint.host}:${endpoint.port}:${endpoint.unitId}:${endpoint.protocolKey}`;
  if (reuse) {
    const cached = driverCache.get(cacheKey);
    if (cached) return cached;
  }
  let driver: DeviceDriver;
  if (endpoint.protocolKey.startsWith("modbus") || endpoint.protocolKey === "delta-modbus" || endpoint.protocolKey === "wago-pfc" || endpoint.protocolKey === "abb-ac500" || endpoint.protocolKey === "schneider-modbus") {
    const transport: ModbusTransport =
      endpoint.protocolKey === "modbus-rtu"
        ? "MODBUS_RTU_OVER_TCP"
        : endpoint.protocolKey === "modbus-ascii"
          ? "MODBUS_ASCII_OVER_TCP"
          : endpoint.protocolKey === "modbus-rtu-over-tcp"
            ? "MODBUS_RTU_OVER_TCP"
            : "MODBUS_TCP";
    driver = new ModbusDriver({
      protocolKey: endpoint.protocolKey,
      host: endpoint.host,
      port: endpoint.port,
      unitId: endpoint.unitId,
      transport: endpoint.transport ?? transport,
      timeoutMs: endpoint.timeoutMs,
      retries: endpoint.retries,
      pollGapMs: endpoint.pollGapMs,
    });
  } else {
    throw new Error(`드라이버가 구현되지 않은 프로토콜입니다: ${endpoint.protocolKey}`);
  }
  if (reuse) driverCache.set(cacheKey, driver);
  return driver;
}

export function clearDrivers(): void {
  for (const driver of driverCache.values()) driver.close();
  driverCache.clear();
}

export function toTagSpec(tag: {
  key: string;
  name: string;
  address: number;
  functionCode: number;
  dataType: string;
  byteOrder: string;
  wordOrder: string;
  scale: number;
  offset: number;
}): TagSpec {
  return {
    key: tag.key,
    name: tag.name,
    address: tag.address,
    functionCode: tag.functionCode,
    dataType: tag.dataType,
    byteOrder: tag.byteOrder === "BA" ? "BA" : "AB",
    wordOrder: (tag.wordOrder as WordOrder) ?? "ABCD",
    scale: tag.scale,
    offset: tag.offset,
  };
}
