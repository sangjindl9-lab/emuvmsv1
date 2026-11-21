import net from "node:net";
import {
  FUNCTION_CODES,
  ModbusException,
  buildReadPdu,
  buildWriteMultipleRegistersPdu,
  buildWriteSingleCoilPdu,
  buildWriteSingleRegisterPdu,
  decodeBits,
  decodeRegisters,
  parseRtuResponse,
  parseTcpResponse,
  wrapRtu,
  wrapTcp,
} from "./pdu";
import { buildAsciiFrame, parseAsciiFrame } from "./crc";

export type ModbusTransport = "MODBUS_TCP" | "MODBUS_RTU_OVER_TCP" | "MODBUS_ASCII_OVER_TCP";

export type ModbusClientOptions = {
  host: string;
  port: number;
  unitId?: number;
  transport?: ModbusTransport;
  timeoutMs?: number;
  retries?: number;
  pollGapMs?: number;
};

export type ModbusStats = {
  requests: number;
  responses: number;
  errors: number;
  timeouts: number;
  lastRttMs: number | null;
  connectedAt: string | null;
};

export class ModbusTcpClient {
  readonly host: string;
  readonly port: number;
  readonly unitId: number;
  readonly transport: ModbusTransport;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly pollGapMs: number;

  private socket: net.Socket | null = null;
  private transactionId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private lastPollAt = 0;
  private closed = false;

  stats: ModbusStats = {
    requests: 0,
    responses: 0,
    errors: 0,
    timeouts: 0,
    lastRttMs: null,
    connectedAt: null,
  };

  constructor(options: ModbusClientOptions) {
    this.host = options.host;
    this.port = options.port;
    this.unitId = options.unitId ?? 1;
    this.transport = options.transport ?? "MODBUS_TCP";
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.retries = options.retries ?? 1;
    this.pollGapMs = options.pollGapMs ?? 10;
  }

  async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Modbus 연결 시간 초과 (${this.host}:${this.port})`));
      }, this.timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.setNoDelay(true);
        this.socket = socket;
        this.stats.connectedAt = new Date().toISOString();
        resolve();
      });
      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.on("close", () => {
        if (this.socket === socket) this.socket = null;
      });
      socket.on("error", () => {
        /* 요청 타임아웃에서 처리 */
      });
    });
  }

  close(): void {
    this.closed = true;
    this.socket?.destroy();
    this.socket = null;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async waitPollGap(): Promise<void> {
    const elapsed = Date.now() - this.lastPollAt;
    if (elapsed < this.pollGapMs) {
      await new Promise((r) => setTimeout(r, this.pollGapMs - elapsed));
    }
    this.lastPollAt = Date.now();
  }

  private expectedLength(partial: Buffer): number | null {
    if (this.transport === "MODBUS_TCP") {
      if (partial.length < 6) return null;
      const length = (partial[4] << 8) | partial[5];
      return length + 6;
    }
    if (this.transport === "MODBUS_ASCII_OVER_TCP") {
      const end = partial.indexOf("\n");
      return end >= 0 ? end + 1 : null;
    }
    if (partial.length < 3) return null;
    const fc = partial[1];
    if (fc & 0x80) return 5;
    if (fc === 1 || fc === 2 || fc === 3 || fc === 4) return 5 + partial[2];
    return 8;
  }

  private receive(): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const socket = this.socket;
      if (!socket) {
        reject(new Error("Modbus 소켓이 연결되지 않았습니다."));
        return;
      }
      let buffer = Buffer.alloc(0);
      const timer = setTimeout(() => {
        cleanup();
        this.stats.timeouts += 1;
        reject(new Error(`Modbus 응답 시간 초과 (${this.timeoutMs}ms)`));
      }, this.timeoutMs);
      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        const expected = this.expectedLength(buffer);
        if (expected !== null && buffer.length >= expected) {
          cleanup();
          resolve(buffer.subarray(0, expected));
        }
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("Modbus 연결이 종료되었습니다."));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
      };
      socket.on("data", onData);
      socket.on("error", onError);
      socket.on("close", onClose);
    });
  }

  private buildFrame(pdu: Uint8Array): Buffer {
    const tid = this.transactionId++ & 0xffff;
    if (this.transport === "MODBUS_TCP") {
      return Buffer.from(wrapTcp(tid, this.unitId, pdu));
    }
    if (this.transport === "MODBUS_RTU_OVER_TCP") {
      return Buffer.from(wrapRtu(this.unitId, pdu));
    }
    const body = new Uint8Array(1 + pdu.length);
    body[0] = this.unitId;
    body.set(pdu, 1);
    return Buffer.from(buildAsciiFrame(body), "ascii");
  }

  private parseFrame(frame: Buffer) {
    if (this.transport === "MODBUS_TCP") return parseTcpResponse(new Uint8Array(frame));
    if (this.transport === "MODBUS_RTU_OVER_TCP") return parseRtuResponse(new Uint8Array(frame));
    throw new Error("ASCII 프레임은 별도로 처리합니다.");
  }

  private async transact(pdu: Uint8Array): Promise<{ functionCode: number; data: Uint8Array }> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        await this.connect();
        await this.waitPollGap();
        const started = Date.now();
        this.stats.requests += 1;
        const socket = this.socket;
        if (!socket) throw new Error("Modbus 소켓 없음");
        const responsePromise = this.receive();
        socket.write(this.buildFrame(pdu));
        const frame = await responsePromise;
        this.stats.lastRttMs = Date.now() - started;
        this.stats.responses += 1;
        const parsed =
          this.transport === "MODBUS_ASCII_OVER_TCP"
            ? (() => {
                const { body, valid } = parseAsciiFrame(frame.toString("ascii"));
                if (!valid) throw new Error("Modbus ASCII LRC 검증 실패");
                if (body[1] & 0x80) throw new ModbusException(body[2]);
                return { unitId: body[0], functionCode: body[1], data: body.subarray(2) };
              })()
            : this.parseFrame(frame);
        return { functionCode: parsed.functionCode, data: parsed.data };
      } catch (error) {
        lastError = error as Error;
        this.stats.errors += 1;
        this.socket?.destroy();
        this.socket = null;
        if (error instanceof ModbusException) throw error;
      }
    }
    throw lastError ?? new Error("Modbus 요청 실패");
  }

  async readCoils(start: number, count: number): Promise<boolean[]> {
    const result = await this.enqueue(() => this.transact(buildReadPdu(FUNCTION_CODES.READ_COILS, start, count)));
    return decodeBits(result.data, count);
  }

  async readDiscreteInputs(start: number, count: number): Promise<boolean[]> {
    const result = await this.enqueue(() =>
      this.transact(buildReadPdu(FUNCTION_CODES.READ_DISCRETE_INPUTS, start, count)),
    );
    return decodeBits(result.data, count);
  }

  async readHoldingRegisters(start: number, count: number): Promise<number[]> {
    const result = await this.enqueue(() =>
      this.transact(buildReadPdu(FUNCTION_CODES.READ_HOLDING_REGISTERS, start, count)),
    );
    return decodeRegisters(result.data, count);
  }

  async readInputRegisters(start: number, count: number): Promise<number[]> {
    const result = await this.enqueue(() =>
      this.transact(buildReadPdu(FUNCTION_CODES.READ_INPUT_REGISTERS, start, count)),
    );
    return decodeRegisters(result.data, count);
  }

  async writeSingleCoil(address: number, on: boolean): Promise<void> {
    await this.enqueue(() => this.transact(buildWriteSingleCoilPdu(address, on)));
  }

  async writeSingleRegister(address: number, value: number): Promise<void> {
    await this.enqueue(() => this.transact(buildWriteSingleRegisterPdu(address, value)));
  }

  async writeMultipleRegisters(address: number, values: number[]): Promise<void> {
    await this.enqueue(() => this.transact(buildWriteMultipleRegistersPdu(address, values)));
  }
}
