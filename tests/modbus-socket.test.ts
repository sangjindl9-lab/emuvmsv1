import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ModbusSimulator } from "@/modules/protocol/modbus/simulator";
import { ModbusTcpClient } from "@/modules/protocol/modbus/client";
import { ModbusDriver } from "@/modules/protocol/drivers";
import { buildAsciiFrame, lrc, parseAsciiFrame } from "@/modules/protocol/modbus/crc";

function floatRegs(value: number): number[] {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatBE(value, 0);
  return [buffer.readUInt16BE(0), buffer.readUInt16BE(2)];
}

describe("실제 TCP 소켓 Modbus 통신", () => {
  let tcpSim: ModbusSimulator;
  let rtuSim: ModbusSimulator;
  let tcpPort = 0;
  let rtuPort = 0;
  let asciiServer: net.Server;
  let asciiPort = 0;

  beforeAll(async () => {
    tcpSim = new ModbusSimulator({ unitId: 1, port: 0, transport: "MODBUS_TCP" });
    const [hi, lo] = floatRegs(220.5);
    tcpSim.holdings.set(0, hi);
    tcpSim.holdings.set(1, lo);
    tcpSim.holdings.set(2, 0x0064);
    tcpSim.inputs.set(0, 0x00c8);
    tcpSim.coilsMap.set(0, true);
    const started = await tcpSim.start();
    tcpPort = started.port;

    rtuSim = new ModbusSimulator({ unitId: 2, port: 0, transport: "MODBUS_RTU_OVER_TCP" });
    rtuSim.holdings.set(0, 1234);
    const startedRtu = await rtuSim.start();
    rtuPort = startedRtu.port;

    asciiServer = net.createServer((socket) => {
      socket.on("data", (chunk) => {
        const { body, valid } = parseAsciiFrame(chunk.toString("ascii"));
        if (!valid) {
          socket.end();
          return;
        }
        const fc = body[1];
        const count = (body[4] << 8) | body[5];
        if (fc === 3) {
          const response = Buffer.alloc(2 + count * 2);
          response[0] = 3;
          response[1] = count * 2;
          for (let i = 0; i < count; i++) {
            response.writeUInt16BE(111 + i, 2 + i * 2);
          }
          const responseBody = Buffer.concat([Buffer.from([body[0]]), response.subarray(0, 2 + count * 2)]);
          socket.write(Buffer.from(buildAsciiFrame(new Uint8Array(responseBody)), "ascii"));
        }
      });
    });
    await new Promise<void>((resolve) => asciiServer.listen(0, "127.0.0.1", () => resolve()));
    const address = asciiServer.address();
    if (address && typeof address === "object") asciiPort = address.port;
  });

  afterAll(async () => {
    await tcpSim.stop();
    await rtuSim.stop();
    await new Promise<void>((resolve) => asciiServer.close(() => resolve()));
  });

  it("Modbus TCP로 레지스터를 읽고 쓴다", async () => {
    const driver = new ModbusDriver({ host: "127.0.0.1", port: tcpPort, unitId: 1, timeoutMs: 2000, retries: 0 });
    const values = await driver.readTags([
      { key: "VOLTAGE", address: 0, functionCode: 3, dataType: "FLOAT32" },
      { key: "UINT", address: 2, functionCode: 3, dataType: "UINT16" },
      { key: "INPUT", address: 0, functionCode: 4, dataType: "UINT16" },
      { key: "COIL", address: 0, functionCode: 1, dataType: "BOOL" },
    ]);
    expect(values.find((v) => v.key === "VOLTAGE")?.value).toBeCloseTo(220.5, 3);
    expect(values.find((v) => v.key === "UINT")?.value).toBe(100);
    expect(values.find((v) => v.key === "INPUT")?.value).toBe(200);
    expect(values.find((v) => v.key === "COIL")?.value).toBe(true);
    expect(values.every((v) => v.quality === "GOOD")).toBe(true);

    await driver.writeTag({ key: "UINT", address: 2, functionCode: 3, dataType: "UINT16" }, 321);
    expect(tcpSim.holdings.get(2)).toBe(321);
    const [readBack] = await driver.readTags([{ key: "UINT", address: 2, functionCode: 3, dataType: "UINT16" }]);
    expect(readBack.value).toBe(321);

    await driver.writeTag({ key: "COIL", address: 1, functionCode: 5, dataType: "BOOL" }, 1);
    expect(tcpSim.coilsMap.get(1)).toBe(true);
    driver.close();
  });

  it("Modbus RTU over TCP(변환기 경유)로 통신한다", async () => {
    const client = new ModbusTcpClient({ host: "127.0.0.1", port: rtuPort, unitId: 2, transport: "MODBUS_RTU_OVER_TCP", timeoutMs: 2000, retries: 0 });
    const registers = await client.readHoldingRegisters(0, 1);
    expect(registers).toEqual([1234]);
    await client.writeSingleRegister(0, 4321);
    expect(rtuSim.holdings.get(0)).toBe(4321);
    client.close();
  });

  it("Modbus ASCII over TCP로 통신한다", async () => {
    const client = new ModbusTcpClient({ host: "127.0.0.1", port: asciiPort, unitId: 1, transport: "MODBUS_ASCII_OVER_TCP", timeoutMs: 2000, retries: 0 });
    const registers = await client.readHoldingRegisters(0, 2);
    expect(registers).toEqual([111, 112]);
    client.close();
  });

  it("응답 없는 포트는 타임아웃으로 실패한다", async () => {
    const client = new ModbusTcpClient({ host: "127.0.0.1", port: 9, unitId: 1, timeoutMs: 300, retries: 0 });
    await expect(client.readHoldingRegisters(0, 1)).rejects.toThrow();
  });

  it("잘못된 LRC를 거부한다", () => {
    expect(parseAsciiFrame(":01030000000100\r\n").valid).toBe(false);
    expect(parseAsciiFrame(buildAsciiFrame(new Uint8Array([1, 3, 0, 0, 0, 1]))).valid).toBe(true);
    expect(lrc(new Uint8Array([1, 3]))).toBe(0xfc);
  });
});
