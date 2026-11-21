/**
 * EUMBMS 데모/검증용 Modbus 슬레이브.
 * - 15020: Modbus TCP (수전 계량기, Unit 1)
 * - 15021: Modbus RTU over TCP (세대 계량기, Unit 2) — 이더넷 통신변환기 흉내
 *
 * 실행: npm run demo:simulator
 * 실제 TCP 소켓 서버이며 EUMBMS 드라이버가 이 서버와 통신한다.
 */
import { ModbusSimulator } from "../src/modules/protocol/modbus/simulator";

function floatRegisters(value: number): [number, number] {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatBE(value, 0);
  return [buffer.readUInt16BE(0), buffer.readUInt16BE(2)];
}

function setFloat(holding: Map<number, number>, address: number, value: number) {
  const [hi, lo] = floatRegisters(value);
  holding.set(address, hi);
  holding.set(address + 1, lo);
}

async function main() {
  const holding = new Map<number, number>();
  setFloat(holding, 0, 220.4);
  setFloat(holding, 2, 182.7);
  setFloat(holding, 4, 412.6);
  setFloat(holding, 6, 94.2);
  setFloat(holding, 8, 60.01);
  setFloat(holding, 10, 128540.5);

  const tcp = new ModbusSimulator({ unitId: 1, port: 15020, transport: "MODBUS_TCP", holding: Object.fromEntries(holding), coils: { 0: true, 1: false, 2: true } });
  tcp.onWriteCoil = (address, on) => {
    if (address === 1) {
      // 제어 코일이 바뀌면 실제 차단기 상태(코일 0)가 따라 움직인다 (피드백 시뮬레이션)
      setTimeout(() => tcp.coilsMap.set(0, on), 400);
      console.log(`[sim] 제어 코일 쓰기 → ${on ? "CLOSE" : "OPEN"} (피드백 0.4초 후)`);
    }
  };

  const rtuHolding = new Map<number, number>();
  setFloat(rtuHolding, 0, 28430.75);
  const rtu = new ModbusSimulator({ unitId: 2, port: 15021, transport: "MODBUS_RTU_OVER_TCP", holding: Object.fromEntries(rtuHolding) });

  await tcp.start();
  await rtu.start();
  console.log(`[sim] Modbus TCP 슬레이브 127.0.0.1:${tcp.port} (unit ${tcp.unitId})`);
  console.log(`[sim] Modbus RTU over TCP 슬레이브 127.0.0.1:${rtu.port} (unit ${rtu.unitId})`);

  let tick = 0;
  setInterval(() => {
    tick += 1;
    const voltage = 220 + Math.sin(tick / 5) * 3;
    const current = 180 + Math.sin(tick / 7) * 12;
    const power = (voltage * current * 1.732 * 0.94) / 1000;
    setFloat(tcp.holdings, 0, Number(voltage.toFixed(2)));
    setFloat(tcp.holdings, 2, Number(current.toFixed(2)));
    setFloat(tcp.holdings, 4, Number(power.toFixed(2)));
    setFloat(tcp.holdings, 6, Number((93.5 + Math.sin(tick / 9) * 2).toFixed(2)));
    setFloat(tcp.holdings, 8, Number((60 + Math.sin(tick / 11) * 0.05).toFixed(3)));
    const energy = tcp.holdings.get(10)! * 65536 + tcp.holdings.get(11)!;
    void energy;
    setFloat(tcp.holdings, 10, 128540.5 + tick * 0.12);
    setFloat(rtu.holdings, 0, 28430.75 + tick * 0.01);
  }, 2000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
