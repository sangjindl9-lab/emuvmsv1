import net from "node:net";
import { crc16, lrc, toHex } from "./modbus/crc";
import { registersToNumber, type WordOrder } from "./modbus/pdu";
import { evaluateExpression } from "./expression";

/**
 * 사용자 정의 프로토콜 프레임 편집기 (방식 3).
 * 프레임 필드/체크섬/응답 파싱/타임아웃/재시도/바이트 순서/변환식을 관리자가 직접 정의한다.
 * 임의 스크립트는 실행하지 않으며, 변환식은 제한된 수식 평가기에서만 수행한다.
 */
export type FrameFieldKind =
  | "HEX"
  | "ASCII"
  | "U8"
  | "U16BE"
  | "U16LE"
  | "ADDRESS"
  | "COUNT"
  | "PAYLOAD_LENGTH"
  | "TOTAL_LENGTH"
  | "CRC16"
  | "LRC"
  | "SUM8"
  | "XOR8"
  | "PAYLOAD";

export type FrameField = { kind: FrameFieldKind; value?: string | number };

export type ResponseSpec = {
  header?: string;
  minLength: number;
  maxLength: number;
  /** 값이 시작하는 바이트 오프셋 (헤더 포함) */
  valueOffset: number;
  /** 값 바이트 길이. 0이면 lengthField로 계산 */
  valueLength: number;
  lengthField?: { offset: number; bytes: 1 | 2; endian: "BE" | "LE"; includesHeader: boolean };
  dataType: string;
  byteOrder: "AB" | "BA";
  wordOrder: WordOrder;
  scale: number;
  offsetValue: number;
  transform?: string;
  /** 고정 응답 길이 (0이면 min/max 사용) */
  fixedLength?: number;
};

export type FrameTemplate = {
  name: string;
  description?: string;
  transport: "TCP";
  request: FrameField[];
  response: ResponseSpec;
  timeoutMs: number;
  retries: number;
};

export type FrameVariables = {
  slaveId: number;
  address: number;
  count: number;
};

export class FrameBuildError extends Error {}

function numberField(kind: FrameFieldKind, value: number, littleEndian = false): Uint8Array {
  if (kind === "U8" || kind === "ADDRESS" && value < 0x100) {
    return new Uint8Array([value & 0xff]);
  }
  const buf = new Uint8Array(2);
  if (littleEndian) {
    buf[0] = value & 0xff;
    buf[1] = (value >> 8) & 0xff;
  } else {
    buf[0] = (value >> 8) & 0xff;
    buf[1] = value & 0xff;
  }
  return buf;
}

function checksum(kind: FrameFieldKind, body: Uint8Array): Uint8Array {
  if (kind === "CRC16") {
    const crc = crc16(body);
    return new Uint8Array([crc & 0xff, (crc >> 8) & 0xff]);
  }
  if (kind === "LRC") return new Uint8Array([lrc(body)]);
  if (kind === "SUM8") return new Uint8Array([body.reduce((a, b) => (a + b) & 0xff, 0)]);
  if (kind === "XOR8") return new Uint8Array([body.reduce((a, b) => a ^ b, 0)]);
  return new Uint8Array();
}

export function buildCustomFrame(template: FrameTemplate, vars: FrameVariables): Uint8Array {
  if (!template.request?.length) throw new FrameBuildError("요청 프레임 필드가 없습니다.");
  const parts: Uint8Array[] = [];
  const bodySoFar = () => Buffer.concat(parts.map((p) => Buffer.from(p)));
  let payloadLength = 0;
  for (const field of template.request) {
    switch (field.kind) {
      case "HEX": {
        const clean = String(field.value ?? "").replace(/[^0-9a-fA-F]/g, "");
        if (clean.length % 2) throw new FrameBuildError("HEX 필드의 자릿수가 홀수입니다.");
        const bytes = new Uint8Array(clean.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
        parts.push(bytes);
        break;
      }
      case "ASCII":
        parts.push(Buffer.from(String(field.value ?? ""), "ascii"));
        break;
      case "U8":
        parts.push(new Uint8Array([Number(field.value ?? 0) & 0xff]));
        break;
      case "U16BE":
        parts.push(numberField("U16BE", Number(field.value ?? 0)));
        break;
      case "U16LE":
        parts.push(numberField("U16BE", Number(field.value ?? 0), true));
        break;
      case "ADDRESS":
        parts.push(numberField("U16BE", vars.address));
        break;
      case "COUNT":
        parts.push(numberField("U16BE", vars.count));
        break;
      case "PAYLOAD":
        if (field.value !== undefined && String(field.value).length > 0) {
          const clean = String(field.value).replace(/[^0-9a-fA-F]/g, "");
          if (clean.length % 2) throw new FrameBuildError("PAYLOAD HEX 자릿수가 홀수입니다.");
          const bytes = new Uint8Array(clean.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
          parts.push(bytes);
          payloadLength = bytes.length;
        }
        break;
      case "PAYLOAD_LENGTH":
        parts.push(new Uint8Array([payloadLength]));
        break;
      case "TOTAL_LENGTH":
        parts.push(new Uint8Array([bodySoFar().length + 3]));
        break;
      default: {
        const computed = checksum(field.kind, new Uint8Array(bodySoFar()));
        if (computed.length === 0) throw new FrameBuildError(`알 수 없는 필드 종류: ${field.kind}`);
        parts.push(computed);
      }
    }
  }
  return new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
}

export function parseCustomResponse(template: FrameTemplate, frame: Uint8Array): {
  value: number | string | boolean;
  rawHex: string;
  bytes: number;
} {
  const spec = template.response;
  if (frame.length < spec.minLength) throw new Error(`응답 길이 부족: ${frame.length} < ${spec.minLength}`);
  if (spec.maxLength && frame.length > spec.maxLength) throw new Error(`응답 길이 초과: ${frame.length} > ${spec.maxLength}`);
  if (spec.header) {
    const header = spec.header.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
    const got = Buffer.from(frame.subarray(0, header.length / 2)).toString("hex");
    if (got !== header) throw new Error(`응답 헤더 불일치: ${got} != ${header}`);
  }
  let length = spec.valueLength;
  if (length === 0 && spec.lengthField) {
    const lf = spec.lengthField;
    const raw =
      lf.bytes === 1
        ? frame[lf.offset]
        : lf.endian === "BE"
          ? (frame[lf.offset] << 8) | frame[lf.offset + 1]
          : frame[lf.offset] | (frame[lf.offset + 1] << 8);
    length = raw - (lf.includesHeader ? 0 : spec.valueOffset);
  }
  if (!length || length <= 0) throw new Error("응답 값 길이를 결정할 수 없습니다.");
  if (spec.valueOffset + length > frame.length) throw new Error("응답 값이 프레임 범위를 벗어납니다.");
  const valueBytes = frame.subarray(spec.valueOffset, spec.valueOffset + length);
  const buf = Buffer.from(valueBytes);
  let numeric: number;
  const type = spec.dataType.toUpperCase();
  if (buf.length === 1) numeric = type === "INT8" ? buf.readInt8(0) : buf.readUInt8(0);
  else if (buf.length === 2) {
    const v = spec.byteOrder === "BA" ? buf.readUInt16LE(0) : buf.readUInt16BE(0);
    numeric = type === "INT16" ? (v > 0x7fff ? v - 0x10000 : v) : v;
  } else if (buf.length === 4) {
    numeric =
      type === "FLOAT32"
        ? spec.byteOrder === "BA"
          ? buf.readFloatLE(0)
          : buf.readFloatBE(0)
        : type === "INT32"
          ? spec.byteOrder === "BA"
            ? buf.readInt32LE(0)
            : buf.readInt32BE(0)
          : spec.byteOrder === "BA"
            ? buf.readUInt32LE(0)
            : buf.readUInt32BE(0);
  } else if (buf.length === 8) {
    numeric = spec.byteOrder === "BA" ? buf.readDoubleLE(0) : buf.readDoubleBE(0);
  } else {
    return {
      value: buf.toString("ascii").replace(/\0+$/, "").trim(),
      rawHex: toHex(valueBytes),
      bytes: valueBytes.length,
    };
  }
  let value: number | string | boolean = numeric;
  if (spec.transform && spec.transform.trim()) {
    value = evaluateExpression(spec.transform, { raw: numeric, offset: spec.offsetValue });
  } else if (spec.scale !== 1 || spec.offsetValue !== 0) {
    value = numeric * spec.scale + spec.offsetValue;
  }
  return { value, rawHex: toHex(valueBytes), bytes: valueBytes.length };
}

export type CustomFrameTestResult = {
  requestHex: string;
  responseHex: string;
  value: number | string | boolean;
  rttMs: number;
  bytesReceived: number;
};

/** 실제 TCP 소켓으로 사용자 정의 프레임을 송신하고 응답을 파싱한다. */
export async function testCustomFrame(options: {
  host: string;
  port: number;
  template: FrameTemplate;
  variables: FrameVariables;
}): Promise<CustomFrameTestResult> {
  const { host, port, template, variables } = options;
  const request = Buffer.from(buildCustomFrame(template, variables));
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= template.retries; attempt++) {
    const started = Date.now();
    try {
      const response = await new Promise<Buffer>((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        let buffer = Buffer.alloc(0);
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error(`응답 시간 초과 (${template.timeoutMs}ms)`));
        }, template.timeoutMs);
        socket.once("connect", () => socket.write(request));
        socket.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          const expected = template.response.fixedLength || template.response.minLength;
          if (expected && buffer.length >= expected) {
            clearTimeout(timer);
            socket.destroy();
            resolve(buffer);
          }
        });
        socket.once("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        socket.once("close", () => {
          clearTimeout(timer);
          if (buffer.length > 0) resolve(buffer);
        });
      });
      const parsed = parseCustomResponse(template, new Uint8Array(response));
      return {
        requestHex: toHex(new Uint8Array(request)),
        responseHex: toHex(new Uint8Array(response)),
        value: parsed.value,
        rttMs: Date.now() - started,
        bytesReceived: response.length,
      };
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw lastError ?? new Error("사용자 정의 프레임 통신 실패");
}

/** 프레임 편집기 미리보기용 (소켓 없이 요청 바이트만 생성) */
export function previewFrame(template: FrameTemplate, variables: FrameVariables): string {
  return toHex(buildCustomFrame(template, variables));
}

export function defaultFrameTemplate(): FrameTemplate {
  return {
    name: "사용자 정의 프로토콜",
    transport: "TCP",
    request: [
      { kind: "HEX", value: "AA55" },
      { kind: "U8", value: 1 },
      { kind: "U8", value: 3 },
      { kind: "ADDRESS" },
      { kind: "COUNT" },
      { kind: "CRC16" },
    ],
    response: {
      header: "AA55",
      minLength: 6,
      maxLength: 512,
      valueOffset: 4,
      valueLength: 2,
      dataType: "UINT16",
      byteOrder: "AB",
      wordOrder: "ABCD",
      scale: 1,
      offsetValue: 0,
    },
    timeoutMs: 1500,
    retries: 1,
  };
}

export { registersToNumber };
