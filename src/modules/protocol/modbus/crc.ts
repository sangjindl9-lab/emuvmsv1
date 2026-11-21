/**
 * Modbus CRC-16 (poly 0xA001, init 0xFFFF) / LRC 계산.
 * Modbus RTU 프레임의 CRC는 하위 바이트 먼저(LE) 전송한다.
 */
export function crc16(buffer: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x0001) {
        crc = (crc >> 1) ^ 0xa001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc & 0xffff;
}

export function appendCrc(body: Uint8Array): Uint8Array {
  const crc = crc16(body);
  const out = new Uint8Array(body.length + 2);
  out.set(body, 0);
  out[body.length] = crc & 0xff;
  out[body.length + 1] = (crc >> 8) & 0xff;
  return out;
}

export function verifyCrc(frame: Uint8Array): boolean {
  if (frame.length < 3) return false;
  const body = frame.subarray(0, frame.length - 2);
  const got = frame[frame.length - 2] | (frame[frame.length - 1] << 8);
  return crc16(body) === got;
}

/** LRC: 모든 바이트 합의 2의 보수 (1바이트) */
export function lrc(buffer: Uint8Array): number {
  let sum = 0;
  for (const b of buffer) sum = (sum + b) & 0xff;
  return ((~sum & 0xff) + 1) & 0xff;
}

export function toHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

export function fromHex(text: string): Uint8Array {
  const clean = text.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2 !== 0) throw new Error("홀수 길이의 16진수 문자열입니다.");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Modbus ASCII 프레임: ':' + hex(unit+pdu+lrc) + CRLF */
export function buildAsciiFrame(rtuBody: Uint8Array): string {
  const check = lrc(rtuBody);
  const withLrc = new Uint8Array(rtuBody.length + 1);
  withLrc.set(rtuBody);
  withLrc[rtuBody.length] = check;
  return `:${Array.from(withLrc)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join("")}\r\n`;
}

export function parseAsciiFrame(frame: string): { body: Uint8Array; valid: boolean } {
  const trimmed = frame.replace(/^\uFEFF/, "").trim();
  if (!trimmed.startsWith(":") || trimmed.length < 5) throw new Error("ASCII 프레임 형식 오류");
  const hex = trimmed.slice(1);
  const bytes = fromHex(hex);
  if (bytes.length < 2) throw new Error("ASCII 프레임 길이 오류");
  const body = bytes.subarray(0, bytes.length - 1);
  const check = lrc(body);
  return { body, valid: check === bytes[bytes.length - 1] };
}
