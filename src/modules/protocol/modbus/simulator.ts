import net from "node:net";
import { appendCrc, lrc, verifyCrc } from "./crc";

/**
 * 실제 TCP 소켓으로 동작하는 Modbus 슬레이브 시뮬레이터.
 * 통합 테스트와 현장 점검(오프라인 시연)에 사용한다.
 * MODBUS_TCP / RTU over TCP 두 방식을 동시에 수용한다.
 */
export type SimulatorOptions = {
  unitId?: number;
  port?: number;
  host?: string;
  transport?: "MODBUS_TCP" | "MODBUS_RTU_OVER_TCP";
  holding?: Record<number, number>;
  input?: Record<number, number>;
  coils?: Record<number, boolean>;
};

export class ModbusSimulator {
  private server: net.Server | null = null;
  readonly unitId: number;
  readonly transport: "MODBUS_TCP" | "MODBUS_RTU_OVER_TCP";
  holdings = new Map<number, number>();
  inputs = new Map<number, number>();
  coilsMap = new Map<number, boolean>();
  requests = 0;
  port = 0;
  host = "127.0.0.1";
  /** 주소별 쓰기 콜백 (실장비 피드백 흉내) */
  onWriteRegister?: (address: number, value: number) => void;
  onWriteCoil?: (address: number, on: boolean) => void;

  constructor(options: SimulatorOptions = {}) {
    this.unitId = options.unitId ?? 1;
    this.transport = options.transport ?? "MODBUS_TCP";
    this.port = options.port ?? 0;
    this.host = options.host ?? "127.0.0.1";
    for (const [k, v] of Object.entries(options.holding ?? {})) this.holdings.set(Number(k), v);
    for (const [k, v] of Object.entries(options.input ?? {})) this.inputs.set(Number(k), v);
    for (const [k, v] of Object.entries(options.coils ?? {})) this.coilsMap.set(Number(k), v);
  }

  async start(): Promise<{ host: string; port: number }> {
    this.server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        // 프레임 경계를 찾아 처리한다. TCP와 RTU가 섞여 들어와도 길이로 판별한다.
        while (buffer.length > 0) {
          let consumed = 0;
          let response: Buffer | null = null;
          if (this.transport === "MODBUS_TCP") {
            if (buffer.length < 6) break;
            const len = (buffer[4] << 8) | buffer[5];
            const total = 6 + len;
            if (buffer.length < total) break;
            response = this.handleTcp(buffer.subarray(0, total));
            consumed = total;
          } else {
            // RTU over TCP: 요청 길이는 FC에 따라 8 또는 11바이트 이상
            const expected = this.expectedRtuRequest(buffer);
            if (expected === null || buffer.length < expected) break;
            response = this.handleRtu(buffer.subarray(0, expected));
            consumed = expected;
          }
          buffer = buffer.subarray(consumed);
          if (response) socket.write(response);
        }
      });
      socket.on("error", () => socket.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, this.host, () => resolve());
    });
    const address = this.server.address();
    if (address && typeof address === "object") this.port = address.port;
    return { host: this.host, port: this.port };
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  private expectedRtuRequest(buffer: Buffer): number | null {
    if (buffer.length < 2) return null;
    const fc = buffer[1];
    if (fc === 1 || fc === 2 || fc === 3 || fc === 4 || fc === 5 || fc === 6) return 8;
    if (fc === 15 || fc === 16) {
      if (buffer.length < 7) return 7;
      return 9 + buffer[6];
    }
    return 8;
  }

  private handleTcp(frame: Buffer): Buffer | null {
    const transactionId = frame.readUInt16BE(0);
    const unitId = frame[6];
    const pdu = frame.subarray(7);
    const result = this.process(unitId, pdu);
    if (!result) return null;
    const out = Buffer.alloc(7 + result.length);
    out.writeUInt16BE(transactionId, 0);
    out.writeUInt16BE(0, 2);
    out.writeUInt16BE(result.length + 1, 4);
    out[6] = unitId;
    Buffer.from(result).copy(out, 7);
    return out;
  }

  private handleRtu(frame: Buffer): Buffer | null {
    if (!verifyCrc(new Uint8Array(frame))) return null;
    const unitId = frame[0];
    const pdu = frame.subarray(1, frame.length - 2);
    const result = this.process(unitId, pdu);
    if (!result) return null;
    const body = Buffer.concat([Buffer.from([unitId]), Buffer.from(result)]);
    return Buffer.from(appendCrc(new Uint8Array(body)));
  }

  private exception(fc: number, code: number): Uint8Array {
    return new Uint8Array([fc | 0x80, code]);
  }

  private process(unitId: number, pdu: Uint8Array): Uint8Array | null {
    this.requests += 1;
    if (unitId !== this.unitId && unitId !== 0 && unitId !== 255) return null; // 응답 없음
    const fc = pdu[0];
    const addr = (pdu[1] << 8) | pdu[2];
    const qty = (pdu[3] << 8) | pdu[4];
    if (fc === 3 || fc === 4) {
      if (qty < 1 || qty > 125) return this.exception(fc, 3);
      const src = fc === 3 ? this.holdings : this.inputs;
      const body = new Uint8Array(2 + qty * 2);
      body[0] = fc;
      body[1] = qty * 2;
      for (let i = 0; i < qty; i++) {
        const v = src.get(addr + i) ?? 0;
        body[2 + i * 2] = (v >> 8) & 0xff;
        body[3 + i * 2] = v & 0xff;
      }
      return body;
    }
    if (fc === 1 || fc === 2) {
      if (qty < 1 || qty > 2000) return this.exception(fc, 3);
      const byteCount = Math.ceil(qty / 8);
      const body = new Uint8Array(2 + byteCount);
      body[0] = fc;
      body[1] = byteCount;
      for (let i = 0; i < qty; i++) {
        const v = fc === 1 ? this.coilsMap.get(addr + i) ?? false : false;
        if (v) body[2 + Math.floor(i / 8)] |= 1 << i % 8;
      }
      return body;
    }
    if (fc === 5) {
      const on = pdu[3] === 0xff;
      this.coilsMap.set(addr, on);
      this.onWriteCoil?.(addr, on);
      return pdu.slice(0, 5);
    }
    if (fc === 6) {
      const value = (pdu[3] << 8) | pdu[4];
      this.holdings.set(addr, value);
      this.onWriteRegister?.(addr, value);
      return pdu.slice(0, 5);
    }
    if (fc === 16) {
      const count = (pdu[3] << 8) | pdu[4];
      for (let i = 0; i < count; i++) {
        const value = (pdu[6 + i * 2] << 8) | pdu[7 + i * 2];
        this.holdings.set(addr + i, value);
        this.onWriteRegister?.(addr + i, value);
      }
      return pdu.slice(0, 5);
    }
    if (fc === 15) {
      const count = (pdu[3] << 8) | pdu[4];
      for (let i = 0; i < count; i++) {
        const on = ((pdu[6 + Math.floor(i / 8)] >> i % 8) & 1) === 1;
        this.coilsMap.set(addr + i, on);
        this.onWriteCoil?.(addr + i, on);
      }
      return pdu.slice(0, 5);
    }
    return this.exception(fc, 1);
  }
}

// ASCII LRC 재노출 (게이트웨이/테스트에서 사용)
export { lrc };
