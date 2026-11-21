import { appendCrc, fromHex, toHex, verifyCrc } from "./crc";

export const FUNCTION_CODES = {
  READ_COILS: 1,
  READ_DISCRETE_INPUTS: 2,
  READ_HOLDING_REGISTERS: 3,
  READ_INPUT_REGISTERS: 4,
  WRITE_SINGLE_COIL: 5,
  WRITE_SINGLE_REGISTER: 6,
  WRITE_MULTIPLE_COILS: 15,
  WRITE_MULTIPLE_REGISTERS: 16,
} as const;

export const EXCEPTION_NAMES: Record<number, string> = {
  1: "ILLEGAL_FUNCTION",
  2: "ILLEGAL_DATA_ADDRESS",
  3: "ILLEGAL_DATA_VALUE",
  4: "SERVER_DEVICE_FAILURE",
  5: "ACKNOWLEDGE",
  6: "SERVER_DEVICE_BUSY",
  8: "MEMORY_PARITY_ERROR",
  10: "GATEWAY_PATH_UNAVAILABLE",
  11: "GATEWAY_TARGET_NO_RESPONSE",
};

export type ByteOrder = "AB" | "BA";
export type WordOrder = "ABCD" | "CDAB" | "BADC" | "DCBA";

export type RegisterValue = {
  address: number;
  value: number;
  raw: number[];
};

export class ModbusException extends Error {
  code: number;
  constructor(code: number) {
    super(`Modbus 예외 응답: ${code} ${EXCEPTION_NAMES[code] ?? "UNKNOWN"}`);
    this.code = code;
  }
}

// ───────────── PDU 생성 (MBAP 제외)
export function buildReadPdu(functionCode: number, start: number, count: number): Uint8Array {
  if (count < 1 || count > 125) throw new Error("읽기 수량은 1~125 사이여야 합니다.");
  const pdu = new Uint8Array(5);
  pdu[0] = functionCode;
  pdu[1] = (start >> 8) & 0xff;
  pdu[2] = start & 0xff;
  pdu[3] = (count >> 8) & 0xff;
  pdu[4] = count & 0xff;
  return pdu;
}

export function buildWriteSingleRegisterPdu(address: number, value: number): Uint8Array {
  const pdu = new Uint8Array(5);
  pdu[0] = FUNCTION_CODES.WRITE_SINGLE_REGISTER;
  pdu[1] = (address >> 8) & 0xff;
  pdu[2] = address & 0xff;
  pdu[3] = (value >> 8) & 0xff;
  pdu[4] = value & 0xff;
  return pdu;
}

export function buildWriteSingleCoilPdu(address: number, on: boolean): Uint8Array {
  const pdu = new Uint8Array(5);
  pdu[0] = FUNCTION_CODES.WRITE_SINGLE_COIL;
  pdu[1] = (address >> 8) & 0xff;
  pdu[2] = address & 0xff;
  pdu[3] = on ? 0xff : 0x00;
  pdu[4] = 0x00;
  return pdu;
}

export function buildWriteMultipleRegistersPdu(address: number, values: number[]): Uint8Array {
  if (values.length < 1 || values.length > 123) throw new Error("쓰기 수량은 1~123 사이여야 합니다.");
  const pdu = new Uint8Array(6 + values.length * 2);
  pdu[0] = FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS;
  pdu[1] = (address >> 8) & 0xff;
  pdu[2] = address & 0xff;
  pdu[3] = (values.length >> 8) & 0xff;
  pdu[4] = values.length & 0xff;
  pdu[5] = values.length * 2;
  values.forEach((v, i) => {
    pdu[6 + i * 2] = (v >> 8) & 0xff;
    pdu[7 + i * 2] = v & 0xff;
  });
  return pdu;
}

export function buildWriteMultipleCoilsPdu(address: number, bits: boolean[]): Uint8Array {
  const byteCount = Math.ceil(bits.length / 8);
  const pdu = new Uint8Array(6 + byteCount);
  pdu[0] = FUNCTION_CODES.WRITE_MULTIPLE_COILS;
  pdu[1] = (address >> 8) & 0xff;
  pdu[2] = address & 0xff;
  pdu[3] = (bits.length >> 8) & 0xff;
  pdu[4] = bits.length & 0xff;
  pdu[5] = byteCount;
  bits.forEach((bit, i) => {
    if (bit) pdu[6 + Math.floor(i / 8)] |= 1 << i % 8;
  });
  return pdu;
}

// ───────────── MBAP / RTU 래핑
export function wrapTcp(transactionId: number, unitId: number, pdu: Uint8Array): Uint8Array {
  const frame = new Uint8Array(7 + pdu.length);
  frame[0] = (transactionId >> 8) & 0xff;
  frame[1] = transactionId & 0xff;
  frame[2] = 0;
  frame[3] = 0;
  frame[4] = ((pdu.length + 1) >> 8) & 0xff;
  frame[5] = (pdu.length + 1) & 0xff;
  frame[6] = unitId & 0xff;
  frame.set(pdu, 7);
  return frame;
}

export function wrapRtu(unitId: number, pdu: Uint8Array): Uint8Array {
  const body = new Uint8Array(1 + pdu.length);
  body[0] = unitId & 0xff;
  body.set(pdu, 1);
  return appendCrc(body);
}

export type ParsedResponse = {
  unitId: number;
  functionCode: number;
  data: Uint8Array;
  transactionId?: number;
};

export function parseTcpResponse(frame: Uint8Array): ParsedResponse {
  if (frame.length < 9) throw new Error("Modbus TCP 응답이 너무 짧습니다.");
  const transactionId = (frame[0] << 8) | frame[1];
  const protocolId = (frame[2] << 8) | frame[3];
  const length = (frame[4] << 8) | frame[5];
  if (protocolId !== 0) throw new Error(`Modbus 프로토콜 ID 오류: ${protocolId}`);
  if (length + 6 !== frame.length) throw new Error("MBAP 길이와 실제 프레임 길이가 다릅니다.");
  const unitId = frame[6];
  const pdu = frame.subarray(7);
  return parsePdu(unitId, pdu, transactionId);
}

export function parseRtuResponse(frame: Uint8Array): ParsedResponse {
  if (!verifyCrc(frame)) throw new Error("Modbus RTU CRC 검증 실패");
  const unitId = frame[0];
  const pdu = frame.subarray(1, frame.length - 2);
  return parsePdu(unitId, pdu);
}

export function parsePdu(unitId: number, pdu: Uint8Array, transactionId?: number): ParsedResponse {
  if (pdu.length < 2) throw new Error("PDU 길이 오류");
  const functionCode = pdu[0];
  if (functionCode & 0x80) {
    throw new ModbusException(pdu[1]);
  }
  return { unitId, functionCode, data: pdu.subarray(1), transactionId };
}

// ───────────── 응답 디코딩
export function decodeRegisters(data: Uint8Array, count: number): number[] {
  if (data.length < 1 + count * 2) throw new Error("레지스터 응답 바이트 수 부족");
  const byteCount = data[0];
  if (byteCount !== count * 2) throw new Error(`레지스터 바이트 수 불일치: ${byteCount} != ${count * 2}`);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push((data[1 + i * 2] << 8) | data[2 + i * 2]);
  }
  return values;
}

export function decodeBits(data: Uint8Array, count: number): boolean[] {
  const byteCount = data[0];
  if (data.length < 1 + byteCount) throw new Error("비트 응답 바이트 수 부족");
  const bits: boolean[] = [];
  for (let i = 0; i < count; i++) {
    bits.push(((data[1 + Math.floor(i / 8)] >> i % 8) & 1) === 1);
  }
  return bits;
}

function swapRegisters(regs: number[], wordOrder: WordOrder): number[] {
  const r = [...regs];
  switch (wordOrder) {
    case "CDAB":
      for (let i = 0; i + 1 < r.length; i += 2) [r[i], r[i + 1]] = [r[i + 1], r[i]];
      return r;
    case "BADC":
      return r.map((v) => ((v & 0xff) << 8) | ((v >> 8) & 0xff));
    case "DCBA":
      for (let i = 0; i + 1 < r.length; i += 2) [r[i], r[i + 1]] = [r[i + 1], r[i]];
      return r.map((v) => ((v & 0xff) << 8) | ((v >> 8) & 0xff));
    default:
      return r;
  }
}

export function registersToNumber(
  regs: number[],
  dataType: string,
  wordOrder: WordOrder = "ABCD",
): number | string | boolean {
  const ordered = swapRegisters(regs, wordOrder);
  const buf = Buffer.alloc(ordered.length * 2);
  ordered.forEach((v, i) => buf.writeUInt16BE(v & 0xffff, i * 2));
  switch (dataType.toUpperCase()) {
    case "BOOL":
      return ordered[0] !== 0;
    case "INT16":
      return buf.readInt16BE(0);
    case "UINT16":
      return buf.readUInt16BE(0);
    case "INT32":
      return buf.readInt32BE(0);
    case "UINT32":
      return buf.readUInt32BE(0);
    case "FLOAT32":
      return buf.readFloatBE(0);
    case "FLOAT64":
      return buf.readDoubleBE(0);
    case "STRING":
      return buf.toString("ascii").replace(/\0+$/, "").trim();
    case "BITFIELD":
      return ordered[0];
    case "ENUM":
      return ordered[0];
    case "TIMESTAMP":
      return buf.readUInt32BE(0);
    default:
      return buf.readUInt16BE(0);
  }
}

export function numberToRegisters(
  value: number,
  dataType: string,
  wordOrder: WordOrder = "ABCD",
): number[] {
  const type = dataType.toUpperCase();
  let regs: number[];
  if (type === "FLOAT32") {
    const b = Buffer.alloc(4);
    b.writeFloatBE(value, 0);
    regs = [b.readUInt16BE(0), b.readUInt16BE(2)];
  } else if (type === "INT32" || type === "UINT32") {
    const b = Buffer.alloc(4);
    if (type === "INT32") b.writeInt32BE(Math.trunc(value), 0);
    else b.writeUInt32BE(Math.trunc(value) >>> 0, 0);
    regs = [b.readUInt16BE(0), b.readUInt16BE(2)];
  } else if (type === "FLOAT64") {
    const b = Buffer.alloc(8);
    b.writeDoubleBE(value, 0);
    regs = [0, 2, 4, 6].map((o) => b.readUInt16BE(o));
  } else if (type === "INT16") {
    const b = Buffer.alloc(2);
    b.writeInt16BE(value, 0);
    regs = [b.readUInt16BE(0)];
  } else {
    regs = [Math.trunc(value) & 0xffff];
  }
  return swapRegisters(regs, wordOrder);
}

export function registerCount(dataType: string): number {
  switch (dataType.toUpperCase()) {
    case "FLOAT64":
      return 4;
    case "FLOAT32":
    case "INT32":
    case "UINT32":
      return 2;
    case "STRING":
      return 8;
    default:
      return 1;
  }
}

export { toHex, fromHex };
