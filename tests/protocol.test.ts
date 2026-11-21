import { describe, expect, it } from "vitest";
import { buildAsciiFrame, crc16, fromHex, lrc, parseAsciiFrame, toHex, verifyCrc, appendCrc } from "@/modules/protocol/modbus/crc";
import {
  buildReadPdu,
  buildWriteSingleRegisterPdu,
  decodeBits,
  decodeRegisters,
  numberToRegisters,
  parseTcpResponse,
  registerCount,
  registersToNumber,
  wrapRtu,
  wrapTcp,
} from "@/modules/protocol/modbus/pdu";
import { evaluateExpression } from "@/modules/protocol/expression";
import { buildCustomFrame, defaultFrameTemplate, parseCustomResponse, previewFrame } from "@/modules/protocol/custom-frame";
import { calculateBill, detectAnomalies, monthlyUsageSeries } from "@/modules/metering/billing";
import { isTriggered, type AlarmRuleLike } from "@/modules/alarms/engine";
import { extractDocument, parseCsv, readZip } from "@/modules/protocol/manual/extract";
import { analyzeDocument, normalizeAddress } from "@/modules/protocol/manual/analyze";

function buildStoredZip(files: { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = Buffer.from(file.content, "utf8");
    const name = Buffer.from(file.name, "utf8");
    const crcTable: number[] = [];
    // CRC32 (ZIP)
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    void crcTable;
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    data.copy(local, 30 + name.length);
    locals.push(local);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralStart = offset;
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

describe("Modbus CRC / LRC", () => {
  it("CRC-16/MODBUS 표준 벡터를 계산한다", () => {
    // 01 03 00 00 00 0A 의 CRC = 0xCDC5 (프레임에는 C5 CD 로 전송)
    const body = fromHex("01 03 00 00 00 0A");
    expect(crc16(body)).toBe(0xcdc5);
    const frame = appendCrc(body);
    expect(toHex(frame)).toBe("01 03 00 00 00 0A C5 CD");
    expect(verifyCrc(frame)).toBe(true);
    frame[2] = 0xff;
    expect(verifyCrc(frame)).toBe(false);
  });

  it("LRC를 계산하고 ASCII 프레임을 왕복 파싱한다", () => {
    const body = fromHex("01 03 00 00 00 01");
    const frame = buildAsciiFrame(body);
    expect(frame.startsWith(":")).toBe(true);
    const parsed = parseAsciiFrame(frame);
    expect(parsed.valid).toBe(true);
    expect(toHex(parsed.body)).toBe("01 03 00 00 00 01");
    expect(lrc(body)).toBe((0x100 - (body.reduce((a, b) => (a + b) & 0xff, 0) & 0xff)) & 0xff);
  });
});

describe("Modbus PDU", () => {
  it("FC03 요청 프레임을 생성한다", () => {
    const frame = wrapTcp(7, 1, buildReadPdu(3, 0x0010, 2));
    expect(toHex(frame)).toBe("00 07 00 00 00 06 01 03 00 10 00 02");
  });

  it("FC03 응답을 파싱한다", () => {
    const response = fromHex("00 07 00 00 00 07 01 03 04 00 64 00 C8");
    const parsed = parseTcpResponse(response);
    expect(parsed.functionCode).toBe(3);
    expect(decodeRegisters(parsed.data, 2)).toEqual([100, 200]);
  });

  it("예외 응답을 감지한다", () => {
    const response = fromHex("00 01 00 00 00 03 01 83 02");
    expect(() => parseTcpResponse(response)).toThrow(/ILLEGAL_DATA_ADDRESS/);
  });

  it("RTU 프레임에 CRC를 붙여 검증한다", () => {
    const frame = wrapRtu(1, buildReadPdu(3, 0, 1));
    expect(verifyCrc(frame)).toBe(true);
    expect(frame.length).toBe(8);
  });

  it("단일 레지스터 쓰기 PDU를 만든다", () => {
    expect(toHex(buildWriteSingleRegisterPdu(10, 0x0102))).toBe("06 00 0A 01 02");
  });

  it("FLOAT32 / INT32 레지스터 변환과 워드 순서를 처리한다", () => {
    const regs = numberToRegisters(220.5, "FLOAT32");
    expect(registersToNumber(regs, "FLOAT32")).toBeCloseTo(220.5, 4);
    const swapped = numberToRegisters(123456, "INT32", "CDAB");
    expect(registersToNumber(swapped, "INT32", "CDAB")).toBe(123456);
    expect(registersToNumber(numberToRegisters(-42, "INT16"), "INT16")).toBe(-42);
    expect(registerCount("FLOAT32")).toBe(2);
    expect(registerCount("FLOAT64")).toBe(4);
  });

  it("Bool / 비트 디코딩을 처리한다", () => {
    const data = new Uint8Array([1, 0b00000101]);
    expect(decodeBits(data, 3)).toEqual([true, false, true]);
  });
});

describe("수식 평가기 (sandbox)", () => {
  it("사칙연산과 변수를 계산한다", () => {
    expect(evaluateExpression("raw * 0.1 + 5", { raw: 100 })).toBe(15);
    expect(evaluateExpression("(raw - 4) * 20", { raw: 10 })).toBe(120);
    expect(evaluateExpression("max(raw, 10) + min(2, 3)", { raw: 5 })).toBe(12);
  });
  it("허용되지 않은 식은 거부한다", () => {
    expect(() => evaluateExpression("process.exit()", {})).toThrow();
    expect(() => evaluateExpression("raw +", { raw: 1 })).toThrow();
    expect(() => evaluateExpression("unknownVar * 2", {})).toThrow(/알 수 없는 변수/);
  });
});

describe("사용자 정의 프레임", () => {
  it("기본 템플릿 요청을 생성한다", () => {
    const hex = previewFrame(defaultFrameTemplate(), { slaveId: 1, address: 0x10, count: 2 });
    expect(hex.startsWith("AA 55 01 03 00 10 00 02")).toBe(true);
    // CRC16은 마지막 2바이트
    expect(hex.split(" ").length).toBe(8 + 2);
  });

  it("응답에서 값을 파싱하고 배율을 적용한다", () => {
    const template = defaultFrameTemplate();
    template.response.valueOffset = 4;
    template.response.valueLength = 2;
    template.response.scale = 0.1;
    const frame = fromHex("AA 55 01 03 01 2C 00");
    const parsed = parseCustomResponse(template, frame);
    expect(parsed.value).toBeCloseTo(30, 5);
  });

  it("헤더가 다르면 오류", () => {
    const template = defaultFrameTemplate();
    expect(() => parseCustomResponse(template, fromHex("BB 55 01 03 00 01"))).toThrow(/헤더/);
  });

  it("필드 누락을 검증한다", () => {
    const template = defaultFrameTemplate();
    template.request = [];
    expect(() => buildCustomFrame(template, { slaveId: 1, address: 0, count: 1 })).toThrow(/필드/);
  });
});

describe("요금 계산", () => {
  const config = {
    baseRatePerKw: 1000,
    energyTiers: [
      { limit: 100, rate: 100 },
      { limit: 200, rate: 200 },
      { limit: null, rate: 300 },
    ],
    vatRate: 0.1,
    climateRate: 10,
    carbonFactor: 0.5,
  };

  it("누진 구간 요금을 합산한다", () => {
    const bill = calculateBill({ usageKwh: 250, contractPowerKw: 10, config });
    expect(bill.baseCharge).toBe(10000);
    expect(bill.energyCharge).toBe(100 * 100 + 100 * 200 + 50 * 300);
    expect(bill.climateCharge).toBe(2500);
    expect(bill.vat).toBe(Math.round((bill.subtotal + 2500) * 0.1));
    expect(bill.carbonKg).toBe(125);
  });

  it("시간대별(TOU) 요금을 적용한다", () => {
    const usageByHour = Array(24).fill(0);
    usageByHour[10] = 100;
    const bill = calculateBill({
      usageKwh: 100,
      contractPowerKw: 0,
      usageByHour,
      config: { ...config, tou: [{ start: 9, end: 12, rate: 500 }] },
    });
    expect(bill.energyCharge).toBe(50000);
  });

  it("역률 저하 페널티를 계산한다", () => {
    const bill = calculateBill({ usageKwh: 100, contractPowerKw: 10, powerFactor: 80, config: { ...config, powerFactorPenaltyRate: 0.2 } });
    expect(bill.powerFactorCharge).toBeGreaterThan(0);
  });

  it("월별 사용량과 이상치를 계산한다", () => {
    const series = monthlyUsageSeries([
      { readingAt: "2026-01-01", value: 1000 },
      { readingAt: "2026-02-01", value: 1200 },
      { readingAt: "2026-03-01", value: 1500 },
      { readingAt: "2026-04-01", value: 3000 },
    ]);
    expect(series[0].usage).toBe(0);
    expect(series[1].usage).toBe(200);
    expect(detectAnomalies(series).length).toBeGreaterThan(0);
  });
});

describe("알람 규칙", () => {
  const base: AlarmRuleLike = {
    id: "r1", tenantId: "t1", siteId: null, name: "rule", targetType: "TAG", targetId: "tag1",
    condition: "GT", threshold: 100, threshold2: null, durationSec: 0, severity: "WARNING", enabled: true,
  };
  it("임계값 조건을 평가한다", () => {
    expect(isTriggered(base, 101)).toBe(true);
    expect(isTriggered(base, 100)).toBe(false);
    expect(isTriggered({ ...base, condition: "LT" }, 99)).toBe(true);
    expect(isTriggered({ ...base, condition: "OUT_OF_RANGE", threshold: 10, threshold2: 20 }, 25)).toBe(true);
    expect(isTriggered({ ...base, condition: "OUT_OF_RANGE", threshold: 10, threshold2: 20 }, 15)).toBe(false);
    expect(isTriggered(base, null)).toBe(false);
  });
});

describe("매뉴얼 문서 추출 (방식 2)", () => {
  it("CSV를 파싱한다", () => {
    const csv = 'name,address,type,unit\n전압,40001,FLOAT,V\n전류,40003,FLOAT,A\n';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0][0]).toBe("name");
    expect(rows[1][0]).toBe("전압");
    expect(parseCsv('name,note\n"a,b",c\n')[1][0]).toBe("a,b");
  });

  it("ZIP에서 DOCX 본문을 추출한다", () => {
    const zip = buildStoredZip([
      { name: "word/document.xml", content: "<w:document><w:body><w:p><w:r><w:t>Modbus TCP Register Map</w:t></w:r></w:p><w:p><w:r><w:t>Address 40001 Voltage FLOAT V</w:t></w:r></w:p></w:body></w:document>" },
    ]);
    const entries = readZip(zip);
    expect(entries.length).toBe(1);
    const doc = extractDocument("manual.docx", zip);
    expect(doc.text).toContain("Register Map");
  });

  it("ZIP에서 XLSX 표를 추출한다", () => {
    const zip = buildStoredZip([
      { name: "xl/sharedStrings.xml", content: "<sst><si><t>주소</t></si><si><t>데이터</t></si><si><t>전압</t></si><si><t>전류</t></si></sst>" },
      {
        name: "xl/worksheets/sheet1.xml",
        content: `<worksheet><sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
          <row r="2"><c r="A2"><v>40001</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row>
        </sheetData></worksheet>`,
      },
    ]);
    const xlsx = extractDocument("map.xlsx", zip);
    expect(xlsx.tables[0]).toContain("주소");
    expect(xlsx.text).toContain("40001");
  });

  it("주소 표기(4xxxx/3xxxx/0x)를 정규화한다", () => {
    expect(normalizeAddress("40001")).toEqual({ address: 0, functionCode: 3 });
    expect(normalizeAddress("30001")).toEqual({ address: 0, functionCode: 4 });
    expect(normalizeAddress("0x10")).toEqual({ address: 16, functionCode: 3 });
    expect(normalizeAddress("100")).toEqual({ address: 100, functionCode: 3 });
  });

  it("머리말이 있는 CSV에서도 헤더 행을 찾아 레지스터를 추출한다", () => {
    const csv = "Schneider Electric Modbus TCP register map\nname,address,type,unit\nVoltage,40001,FLOAT,V\n";
    const doc = extractDocument("preamble.csv", Buffer.from(csv));
    const analysis = analyzeDocument({ fileName: "preamble.csv", text: doc.text, tables: doc.tables });
    expect(analysis.registers).toHaveLength(1);
    expect(analysis.registers[0]).toMatchObject({ address: 0, functionCode: 3, dataType: "FLOAT32", unit: "V" });
  });

  it("문서에서 제조사·프로토콜·레지스터 초안을 만든다", () => {
    const analysis = analyzeDocument({
      fileName: "schneider.csv",
      text: "Schneider Electric Modbus TCP register map\nAddress 40001 Voltage FLOAT V\nAddress 40003 Current FLOAT A",
      tables: [["name", "address", "type", "unit"], ["Voltage", "40001", "FLOAT", "V"], ["Current", "40003", "FLOAT", "A"]],
    });
    expect(analysis.manufacturerGuess).toBe("Schneider Electric");
    expect(analysis.protocolGuess).toBe("modbus-tcp");
    expect(analysis.registers.length).toBeGreaterThanOrEqual(2);
    expect(analysis.registers[0].address).toBe(0);
    expect(analysis.registers[0].dataType).toBe("FLOAT32");
    expect(analysis.driverType).toBe("STANDARD_DRIVER");
  });
});
