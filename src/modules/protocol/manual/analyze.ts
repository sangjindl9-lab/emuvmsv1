import { PROTOCOL_CATALOG, MANUFACTURER_CATALOG } from "../catalog";

export type DraftRegister = {
  name: string;
  address: number;
  functionCode: number;
  dataType: string;
  unit: string | null;
  scale: number;
  source: string;
};

export type ManualAnalysis = {
  manufacturerGuess: string | null;
  manufacturerConfidence: number;
  modelGuess: string | null;
  protocolGuess: string | null;
  protocolConfidence: number;
  transportGuess: string;
  driverType: "STANDARD_DRIVER" | "VENDOR_DRIVER_REQUIRED" | "CUSTOM_FRAME_REQUIRED";
  registers: DraftRegister[];
  confidence: number;
  notes: string[];
  warnings: string[];
};

const PROTOCOL_KEYWORDS: { key: string; patterns: RegExp }[] = [
  { key: "modbus-tcp", patterns: /\b(modbus\s*(tcp|\/tcp)|modbus-tcp)\b/i },
  { key: "modbus-rtu", patterns: /\b(modbus\s*(rtu)?|rtu)\b/i },
  { key: "modbus-ascii", patterns: /\bmodbus\s*ascii\b/i },
  { key: "bacnet-ip", patterns: /\bbacnet\b/i },
  { key: "opcua", patterns: /\bopc\s*ua\b/i },
  { key: "mqtt", patterns: /\bmqtt\b/i },
  { key: "dlms-cosem", patterns: /\b(dlms|cosem|iec\s*62056)\b/i },
  { key: "mbus", patterns: /\bm-?bus\b/i },
  { key: "iec61850-mms", patterns: /\b(iec\s*61850|61850)\b/i },
  { key: "iec60870-5-104", patterns: /\b(iec\s*60870|60870)\b/i },
  { key: "dnp3", patterns: /\bdnp\s*3?\b/i },
  { key: "s7comm", patterns: /\b(s7\s*(comm|protocol|communication)|s7-1[25]00|s7-300|s7-400)\b/i },
  { key: "mitsubishi-mc", patterns: /\b(mc\s*protocol|slmp|melsec)\b/i },
  { key: "ls-xgt-fenet", patterns: /\b(xgt|fenet|xgk|xgi|xgr)\b/i },
  { key: "omron-fins", patterns: /\bfins\b/i },
  { key: "rockwell-ethernetip", patterns: /\b(ethernet\/ip|cip|controllogix|compactlogix)\b/i },
  { key: "beckhoff-ads", patterns: /\b(twincat|beckhoff\s*ads|\bads\b)\b/i },
];

const DATA_TYPE_PATTERNS: { type: string; patterns: RegExp }[] = [
  { type: "FLOAT32", patterns: /\b(float|real|float32|single)\b/i },
  { type: "FLOAT64", patterns: /\b(double|float64|lreal)\b/i },
  { type: "INT32", patterns: /\b(int32|dint|long|dword\s*signed)\b/i },
  { type: "UINT32", patterns: /\b(uint32|udint|dword)\b/i },
  { type: "UINT16", patterns: /\b(uint16|word|unsigned\s*short)\b/i },
  { type: "INT16", patterns: /\b(int16|int|short|integer)\b/i },
  { type: "BOOL", patterns: /\b(bit|bool|boolean|coil|discrete)\b/i },
];

const UNIT_PATTERN = /(kWh|kVAh|kvarh|kVA|kvar|kW|MW|Wh|V|mV|kV|A|mA|Hz|%|℃|°C|degC|C)\b/;

export function normalizeAddress(raw: string): { address: number; functionCode: number } | null {
  const token = raw.trim().toUpperCase();
  if (!token) return null;
  if (/^0X[0-9A-F]+$/.test(token)) {
    const value = parseInt(token.slice(2), 16);
    return { address: value, functionCode: 3 };
  }
  if (!/^\d{1,6}$/.test(token)) return null;
  const value = Number(token);
  if (token.length === 5) {
    if (token.startsWith("4")) return { address: value - 40001, functionCode: 3 };
    if (token.startsWith("3")) return { address: value - 30001, functionCode: 4 };
    if (token.startsWith("1")) return { address: value - 10001, functionCode: 2 };
    if (token.startsWith("0")) return { address: value - 1, functionCode: 1 };
  }
  if (token.length === 6 && token.startsWith("4")) return { address: value - 400001, functionCode: 3 };
  return { address: value, functionCode: 3 };
}

function detectDataType(context: string): string {
  for (const entry of DATA_TYPE_PATTERNS) if (entry.patterns.test(context)) return entry.type;
  return "UINT16";
}

function detectUnit(context: string): string | null {
  const m = UNIT_PATTERN.exec(context);
  return m ? m[1] : null;
}

function guessManufacturer(text: string): { name: string | null; confidence: number } {
  const haystack = text.slice(0, 20000);
  let best: { name: string; score: number } | null = null;
  for (const manufacturer of MANUFACTURER_CATALOG) {
    const names = [manufacturer.name, manufacturer.nameKo].filter(Boolean) as string[];
    let score = 0;
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = haystack.match(new RegExp(escaped, "gi"));
      if (matches) score += matches.length;
    }
    if (score > 0 && (!best || score > best.score)) best = { name: manufacturer.name, score };
  }
  if (!best) return { name: null, confidence: 0 };
  return { name: best.name, confidence: Math.min(0.9, 0.4 + best.score * 0.02) };
}

function guessModel(text: string, manufacturer: string | null): string | null {
  if (!manufacturer) return null;
  const entry = MANUFACTURER_CATALOG.find((m) => m.name === manufacturer);
  if (!entry) return null;
  for (const model of entry.models) {
    if (text.toUpperCase().includes(model.name.toUpperCase())) return model.name;
  }
  return null;
}

function guessProtocol(text: string): { key: string | null; confidence: number } {
  let best: { key: string; score: number } | null = null;
  for (const entry of PROTOCOL_KEYWORDS) {
    const matches = text.match(new RegExp(entry.patterns.source, "gi"));
    if (matches && matches.length > 0) {
      if (!best || matches.length > best.score) best = { key: entry.key, score: matches.length };
    }
  }
  if (!best) return { key: null, confidence: 0 };
  return { key: best.key, confidence: Math.min(0.95, 0.5 + best.score * 0.03) };
}

function parseTables(rows: string[][]): DraftRegister[] {
  const registers: DraftRegister[] = [];
  if (!rows || rows.length < 2) return [];
  for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex++) {
    if (rows[rowIndex].length < 2) continue;
    const header = rows[rowIndex].map((cell) => String(cell).toLowerCase());
    const addressCol = header.findIndex((cell) => /(address|addr|주소|register|레지스터)/.test(cell));
    if (addressCol < 0) continue;
    const nameCol = header.findIndex((cell) => /(name|description|항목|태그|point|data)/.test(cell));
    const typeCol = header.findIndex((cell) => /(type|형식|data type)/.test(cell));
    const unitCol = header.findIndex((cell) => /(unit|단위)/.test(cell));
    const scaleCol = header.findIndex((cell) => /(scale|배율|gain)/.test(cell));
    for (let index = rowIndex + 1; index < rows.length; index++) {
      const row = rows[index];
      const addressCell = row[addressCol];
      if (!addressCell || !String(addressCell).trim()) continue;
      const normalized = normalizeAddress(String(addressCell));
      if (!normalized) continue;
      const values: string[] = row.map((cell) => String(cell ?? ""));
      const context = values.join(" ");
      registers.push({
        name: (nameCol >= 0 ? values[nameCol] : "") || `REG_${normalized.address}`,
        address: normalized.address,
        functionCode: normalized.functionCode,
        dataType: typeCol >= 0 ? detectDataType(values[typeCol]) : detectDataType(context),
        unit: unitCol >= 0 ? values[unitCol] || null : detectUnit(context),
        scale: scaleCol >= 0 && Number(values[scaleCol]) ? Number(values[scaleCol]) : 1,
        source: context.slice(0, 120),
      });
    }
    if (registers.length > 0) break;
  }
  return registers;
}

function parseLines(text: string): DraftRegister[] {
  const registers: DraftRegister[] = [];
  const lines = text.split(/\r?\n/);
  const addressRegex = /(?:^|[\s\t|,;:])(?:0x[0-9A-Fa-f]{2,5}|[0-9]{5,6}|[0-9]{1,4})(?=[\s\t|,;]|$)/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/(address|addr|주소|register|레지스터|holding|input)/i.test(line) && !/(kWh|kvar|kW|Hz|역률|전압|전류)/.test(line)) continue;
    let match: RegExpExecArray | null;
    addressRegex.lastIndex = 0;
    const found: number[] = [];
    while ((match = addressRegex.exec(line))) {
      const value = match[0].trim();
      const normalized = normalizeAddress(value);
      if (normalized && normalized.address >= 0 && normalized.address < 65536) found.push(normalized.address);
    }
    if (found.length === 0) continue;
    const context = line;
    registers.push({
      name: line.replace(/[0-9]{4,}/g, "").replace(/[|,\t]/g, " ").trim().slice(0, 60) || `REG_${found[0]}`,
      address: found[0],
      functionCode: /coil|discrete|접점/i.test(context) ? 1 : 3,
      dataType: detectDataType(context),
      unit: detectUnit(context),
      scale: 1,
      source: line.trim().slice(0, 120),
    });
    if (registers.length > 500) break;
  }
  return registers;
}

export function analyzeDocument(input: {
  fileName: string;
  text: string;
  tables: string[][];
}): ManualAnalysis {
  const notes: string[] = [];
  const warnings: string[] = [];
  const text = input.text ?? "";
  const manufacturer = guessManufacturer(text);
  const protocol = guessProtocol(text);
  const model = guessModel(text, manufacturer.name);
  let registers = parseTables(input.tables ?? []);
  if (registers.length > 0) notes.push(`표에서 레지스터 ${registers.length}개 추출`);
  const lineRegisters = parseLines(text);
  if (lineRegisters.length > 0) {
    notes.push(`본문에서 레지스터 ${lineRegisters.length}개 추출`);
    registers = registers.concat(lineRegisters);
  }
  const seen = new Set<string>();
  registers = registers.filter((r) => {
    const key = `${r.functionCode}:${r.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 500);

  const catalogEntry = protocol.key ? PROTOCOL_CATALOG.find((p) => p.key === protocol.key) : undefined;
  const vendorProtocol = catalogEntry && catalogEntry.standard === "VENDOR";
  const driverType = vendorProtocol ? "VENDOR_DRIVER_REQUIRED" : protocol.key ? "STANDARD_DRIVER" : "CUSTOM_FRAME_REQUIRED";

  let transport = "TCP";
  if (/rs[- ]?(485|232|422)|serial|시리얼/i.test(text)) transport = "RTU";
  else if (/udp/i.test(text)) transport = "UDP";

  if (!manufacturer.name) warnings.push("제조사를 식별하지 못했습니다. 관리자 확인이 필요합니다.");
  if (!protocol.key) warnings.push("프로토콜 종류를 식별하지 못했습니다. 사용자 정의 프레임 검토가 필요합니다.");
  if (registers.length === 0) warnings.push("레지스터 주소를 추출하지 못했습니다. 원본 문서의 표 형식을 확인하세요.");
  if (vendorProtocol) warnings.push("제조사 전용 프로토콜입니다. 표준 드라이버로는 통신할 수 없어 별도 드라이버 개발·검증이 필요합니다.");
  warnings.push("자동 분석 결과는 초안입니다. 승인 전에는 실제 수집에 사용되지 않습니다.");

  const manufacturerConfidence = manufacturer.confidence;
  const protocolConfidence = protocol.confidence;
  const registerScore = Math.min(1, registers.length / 20);
  const confidence = Number(
    (manufacturerConfidence * 0.25 + protocolConfidence * 0.35 + registerScore * 0.4).toFixed(2),
  );

  return {
    manufacturerGuess: manufacturer.name,
    manufacturerConfidence,
    modelGuess: model,
    protocolGuess: protocol.key,
    protocolConfidence,
    transportGuess: transport,
    driverType,
    registers,
    confidence,
    notes,
    warnings,
  };
}
