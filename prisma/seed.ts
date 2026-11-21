import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import { MANUFACTURER_CATALOG, PROTOCOL_CATALOG } from "../src/modules/protocol/catalog";
import { ROLE_DEFINITIONS } from "../src/lib/rbac";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

const DEMO_PASSWORD = "Eumbms!2026";

async function main() {
  console.log("EUMBMS 시드 시작");
  const existing = await prisma.tenant.findUnique({ where: { code: "EUM" } });
  if (existing) {
    console.log("이미 시드된 테넌트(EUM)가 있습니다. 기존 데이터를 유지합니다.");
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      code: "EUM",
      name: "(주)이음솔루션",
      businessNo: "123-45-67890",
      address: "강원도 원주시 시청로 264",
      phone: "033-000-0000",
      plan: "ENTERPRISE",
    },
  });

  const roles: Record<string, string> = {};
  for (const [code, def] of Object.entries(ROLE_DEFINITIONS)) {
    const role = await prisma.role.create({
      data: { tenantId: tenant.id, code, name: def.name, permissions: def.permissions, isSystem: true },
    });
    roles[code] = role.id;
  }

  const users = [
    { email: "admin@eumbms.local", name: "이상진", role: "SUPER_ADMIN", phone: "010-2643-6014" },
    { email: "manager@eumbms.local", name: "김관리", role: "ADMIN" },
    { email: "operator@eumbms.local", name: "박운전", role: "OPERATOR" },
    { email: "approver@eumbms.local", name: "최승인", role: "APPROVER" },
    { email: "viewer@eumbms.local", name: "한조회", role: "VIEWER" },
  ];
  const userIds: Record<string, string> = {};
  for (const user of users) {
    const created = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: user.email,
        name: user.name,
        phone: user.phone ?? null,
        passwordHash: hashPassword(DEMO_PASSWORD),
        roleId: roles[user.role],
        status: "ACTIVE",
      },
    });
    userIds[user.email] = created.id;
  }

  // ── 제조사 / 모델
  const manufacturerIds: Record<string, string> = {};
  for (const manufacturer of MANUFACTURER_CATALOG) {
    const created = await prisma.manufacturer.create({
      data: {
        name: manufacturer.name,
        nameKo: manufacturer.nameKo,
        country: manufacturer.country,
        website: manufacturer.website,
      },
    });
    manufacturerIds[manufacturer.name] = created.id;
    for (const model of manufacturer.models) {
      await prisma.deviceModel.create({
        data: {
          manufacturerId: created.id,
          name: model.name,
          category: model.category,
          protocols: model.protocols,
          docsUrl: model.docsUrl,
        },
      });
    }
  }

  // ── 프로토콜 드라이버 (카탈로그 상태를 그대로 반영)
  for (const entry of PROTOCOL_CATALOG) {
    const driver = await prisma.protocolDriver.create({
      data: {
        tenantId: tenant.id,
        key: entry.key,
        name: entry.name,
        protocolFamily: entry.family,
        transport: entry.transport,
        status: entry.status,
        description: entry.verifiedNote,
        docsUrl: entry.docsUrl,
        builtin: true,
      },
    });
    const version =
      entry.status === "SIMULATOR_VERIFIED"
        ? "1.0.0"
        : entry.status === "IN_DEVELOPMENT"
          ? "0.2.0"
          : "0.1.0";
    await prisma.driverVersion.create({
      data: {
        tenantId: tenant.id,
        driverId: driver.id,
        version,
        changelog: entry.status === "SIMULATOR_VERIFIED" ? "시뮬레이터 통신 검증 완료" : "문서 확인 단계",
        status: entry.status === "SIMULATOR_VERIFIED" ? "VALIDATED" : "DRAFT",
        config: { protocolKey: entry.key, docsUrl: entry.docsUrl, license: entry.license },
        createdById: userIds["admin@eumbms.local"],
      },
    });
  }

  // ── 사업장 / 건물 / 세대
  const wonju = await prisma.site.create({
    data: { tenantId: tenant.id, code: "SITE-WJ", name: "원주 본사", address: "강원도 원주시 시청로 264", contractPowerKw: 850 },
  });
  const seoul = await prisma.site.create({
    data: { tenantId: tenant.id, code: "SITE-SE", name: "서울 오피스", address: "서울특별시 강남구 테헤란로 1", contractPowerKw: 320 },
  });
  const building = await prisma.building.create({
    data: { tenantId: tenant.id, siteId: wonju.id, code: "A", name: "A동 101동", purpose: "APARTMENT", floorsCount: 15, areaM2: 18500 },
  });
  const office = await prisma.building.create({
    data: { tenantId: tenant.id, siteId: seoul.id, code: "O1", name: "서울 오피스 빌딩", purpose: "OFFICE", floorsCount: 10, areaM2: 9200 },
  });

  for (let level = 1; level <= 3; level++) {
    const floor = await prisma.floor.create({
      data: { tenantId: tenant.id, buildingId: building.id, level, name: `${level}층` },
    });
    for (let index = 1; index <= 4; index++) {
      const ho = `${level}0${index}`;
      await prisma.unit.create({
        data: {
          tenantId: tenant.id,
          buildingId: building.id,
          floorId: floor.id,
          dong: "101",
          ho,
          name: `101동 ${ho}호`,
          areaM2: 84.9 + index * 2,
          occupancy: index === 4 ? "VACANT" : "OCCUPIED",
        },
      });
    }
  }

  // ── 게이트웨이
  const gateway = await prisma.gateway.create({
    data: {
      tenantId: tenant.id,
      siteId: wonju.id,
      name: "원주 본사 Edge Gateway",
      serial: "GW-WJ-0001",
      kind: "EDGE",
      mode: "TCP_CLIENT",
      host: "127.0.0.1",
      port: 15020,
      tokenHash: null,
      status: "OFFLINE",
      firmware: "2.0.0",
    },
  });
  const converter = await prisma.gateway.create({
    data: {
      tenantId: tenant.id,
      siteId: wonju.id,
      name: "변전실 RS-485 변환기",
      serial: "CV-WJ-0001",
      kind: "ETHERNET_CONVERTER",
      mode: "MODBUS_GATEWAY",
      convertsProtocol: true,
      host: "127.0.0.1",
      port: 15021,
      status: "OFFLINE",
    },
  });
  const bus = await prisma.serialBus.create({
    data: {
      tenantId: tenant.id,
      gatewayId: converter.id,
      name: "RS485-1 (변전실 계량기)",
      port: "COM3",
      baudRate: 19200,
      parity: "E",
      dataBits: 8,
      stopBits: 1,
      mode: "RTU",
      pollGapMs: 60,
    },
  });

  // ── 시뮬레이터 장치 + 태그 (통합 테스트/데모용 실제 통신 대상)
  const simulatorDevice = await prisma.device.create({
    data: {
      tenantId: tenant.id,
      siteId: wonju.id,
      buildingId: building.id,
      gatewayId: gateway.id,
      manufacturerId: manufacturerIds["Schneider Electric"],
      name: "수전 계량기 (Modbus TCP)",
      deviceType: "METER",
      protocolKey: "modbus-tcp",
      host: "127.0.0.1",
      port: 15020,
      slaveId: 1,
      pollingMs: 1000,
      timeoutMs: 2000,
      retryCount: 1,
      firmware: "3.2.1",
      description: "EUMBMS 검증용 Modbus TCP 슬레이브. 데모 시뮬레이터(scripts/demo-simulator.ts)와 연동됩니다.",
    },
  });

  const tagDefs = [
    { key: "VOLTAGE_L1_N", name: "수전 전압 L1", address: 0, dataType: "FLOAT32", unit: "V", standardKey: "VOLTAGE_L1_N" },
    { key: "CURRENT_L1", name: "수전 전류 L1", address: 2, dataType: "FLOAT32", unit: "A", standardKey: "CURRENT_L1" },
    { key: "ACTIVE_POWER", name: "유효전력", address: 4, dataType: "FLOAT32", unit: "kW", standardKey: "ACTIVE_POWER" },
    { key: "POWER_FACTOR", name: "역률", address: 6, dataType: "FLOAT32", unit: "%", standardKey: "POWER_FACTOR" },
    { key: "FREQUENCY", name: "주파수", address: 8, dataType: "FLOAT32", unit: "Hz", standardKey: "FREQUENCY" },
    { key: "ENERGY_IMPORT", name: "누적 수전량", address: 10, dataType: "FLOAT32", unit: "kWh", standardKey: "ENERGY_IMPORT" },
    { key: "BREAKER_STATE", name: "VCB-1 투입 상태", address: 0, functionCode: 1, dataType: "BOOL", unit: "", standardKey: "BREAKER_STATE" },
    { key: "BREAKER_CTRL", name: "VCB-1 제어 코일", address: 1, functionCode: 1, dataType: "BOOL", unit: "", writable: true },
    { key: "LOCAL_REMOTE", name: "VCB-1 Local/Remote", address: 2, functionCode: 1, dataType: "BOOL", unit: "" },
  ];
  const tags: Record<string, string> = {};
  for (const def of tagDefs) {
    const tag = await prisma.deviceTag.create({
      data: {
        tenantId: tenant.id,
        siteId: wonju.id,
        deviceId: simulatorDevice.id,
        key: def.key,
        name: def.name,
        address: def.address,
        functionCode: def.functionCode ?? 3,
        dataType: def.dataType,
        unit: def.unit,
        standardKey: def.standardKey ?? null,
        writable: def.writable ?? false,
      },
    });
    tags[def.key] = tag.id;
  }

  // 아파트 세대 계량기 (변환기 경유 RTU over TCP)
  const unitMeter = await prisma.device.create({
    data: {
      tenantId: tenant.id,
      siteId: wonju.id,
      buildingId: building.id,
      gatewayId: converter.id,
      serialBusId: bus.id,
      name: "101동 세대 전력량계 (RTU)",
      deviceType: "METER",
      protocolKey: "modbus-rtu-over-tcp",
      host: "127.0.0.1",
      port: 15021,
      slaveId: 2,
      pollingMs: 5000,
      timeoutMs: 2000,
      retryCount: 1,
    },
  });
  await prisma.deviceTag.create({
    data: {
      tenantId: tenant.id,
      siteId: wonju.id,
      deviceId: unitMeter.id,
      key: "ENERGY_IMPORT",
      name: "101동 세대 누적 전력량",
      address: 0,
      dataType: "FLOAT32",
      unit: "kWh",
      standardKey: "ENERGY_IMPORT",
    },
  });

  // ── 전력설비 자산
  const mainAsset = await prisma.electricalAsset.create({
    data: {
      tenantId: tenant.id,
      siteId: wonju.id,
      buildingId: building.id,
      code: "VCB-1",
      name: "수전 VCB-1",
      assetType: "VCB",
      ratedCapacity: "22.9kV 630A",
      voltage: "22900",
      phases: 3,
      location: "지하 1층 수변전실",
      status: "NORMAL",
      breakerState: "CLOSED",
      remoteControlEnabled: true,
      tagIds: [tags.BREAKER_STATE, tags.BREAKER_CTRL, tags.ACTIVE_POWER],
      interlocks: {
        control: { tagId: tags.BREAKER_CTRL, openValue: 0, closeValue: 1 },
        feedback: { tagId: tags.BREAKER_STATE, openValue: 0, closedValue: 1 },
        requireLocalRemote: true,
        localRemoteTagId: tags.LOCAL_REMOTE,
        remoteValue: 1,
        interlocks: [],
      } as object,
    },
  });
  const transformer = await prisma.electricalAsset.create({
    data: {
      tenantId: tenant.id,
      siteId: wonju.id,
      buildingId: building.id,
      parentId: mainAsset.id,
      code: "TR-1",
      name: "변압기 TR-1 (750kVA)",
      assetType: "TRANSFORMER",
      ratedCapacity: "750kVA",
      voltage: "22900/380",
      phases: 3,
      location: "지하 1층 수변전실",
      tagIds: [tags.ACTIVE_POWER],
    },
  });
  await prisma.electricalAsset.create({
    data: {
      tenantId: tenant.id,
      siteId: wonju.id,
      parentId: mainAsset.id,
      code: "GEN-1",
      name: "비상 발전기 GEN-1",
      assetType: "GENERATOR",
      ratedCapacity: "500kW",
      voltage: "380",
      phases: 3,
      location: "지하 1층 발전기실",
      remoteControlEnabled: false,
    },
  });
  await prisma.electricalAsset.create({
    data: {
      tenantId: tenant.id,
      siteId: wonju.id,
      code: "PV-1",
      name: "옥상 태양광 인버터",
      assetType: "PV_INVERTER",
      ratedCapacity: "100kW",
      voltage: "380",
      phases: 3,
      location: "옥상",
    },
  });
  await prisma.electricalAsset.create({
    data: {
      tenantId: tenant.id,
      siteId: wonju.id,
      code: "ESS-1",
      name: "ESS 200kWh",
      assetType: "ESS",
      ratedCapacity: "200kWh/100kW",
      voltage: "380",
      phases: 3,
      location: "지하 1층 ESS실",
    },
  });
  await prisma.electricalAsset.create({
    data: {
      tenantId: tenant.id,
      siteId: seoul.id,
      code: "ACB-O1",
      name: "서울 오피스 ACB-1",
      assetType: "ACB",
      ratedCapacity: "380V 1600A",
      voltage: "380",
      phases: 3,
      location: "B2 전기실",
    },
  });
  await prisma.electricalAsset.create({
    data: {
      tenantId: tenant.id,
      siteId: seoul.id,
      code: "UPS-O1",
      name: "서울 오피스 UPS-1",
      assetType: "UPS",
      ratedCapacity: "120kVA",
      voltage: "380",
      phases: 3,
      location: "B2 전기실",
    },
  });

  // ── 단선결선도
  const diagram = await prisma.diagram.create({
    data: {
      tenantId: tenant.id,
      siteId: wonju.id,
      name: "101동 수변전 단선결선도",
      description: "수전 VCB → 변압기 → 저압 모선 계통 (데모)",
      canvas: { width: 1600, height: 900 } as object,
      createdById: userIds["admin@eumbms.local"],
    },
  });
  const elements = [
    { elementKey: "BUS_HV", symbolType: "BUS", label: "22.9kV 모선", x: 120, y: 80, width: 520, height: 60, assetId: null, tagId: null },
    { elementKey: "VCB1", symbolType: "BREAKER", label: "VCB-1", x: 260, y: 190, width: 90, height: 70, assetId: mainAsset.id, tagId: tags.BREAKER_STATE },
    { elementKey: "TR1", symbolType: "TRANSFORMER", label: "TR-1 750kVA", x: 255, y: 320, width: 100, height: 90, assetId: transformer.id, tagId: tags.ACTIVE_POWER },
    { elementKey: "BUS_LV", symbolType: "BUS", label: "380V 모선", x: 120, y: 470, width: 520, height: 60, assetId: null, tagId: null },
    { elementKey: "METER1", symbolType: "METER", label: "수전 계량기", x: 700, y: 190, width: 90, height: 70, assetId: null, tagId: tags.ENERGY_IMPORT },
    { elementKey: "GEN1", symbolType: "GENERATOR", label: "비상발전기", x: 700, y: 480, width: 90, height: 80, assetId: null, tagId: null },
    { elementKey: "PV1", symbolType: "PV", label: "태양광 100kW", x: 830, y: 480, width: 90, height: 70, assetId: null, tagId: null },
    { elementKey: "LOAD1", symbolType: "LOAD", label: "101동 부하", x: 420, y: 620, width: 80, height: 70, assetId: null, tagId: tags.ACTIVE_POWER },
  ];
  for (const [index, element] of elements.entries()) {
    await prisma.diagramElement.create({
      data: {
        tenantId: tenant.id,
        diagramId: diagram.id,
        elementKey: element.elementKey,
        symbolType: element.symbolType,
        label: element.label,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        assetId: element.assetId,
        tagId: element.tagId,
        zIndex: index + 1,
      },
    });
  }

  // ── 요금표 (예시 구성 — 실제 고지서와 다를 수 있음)
  await prisma.tariffVersion.create({
    data: {
      tenantId: tenant.id,
      name: "산업용(을) 예시",
      version: 1,
      effectiveFrom: new Date("2026-01-01"),
      currency: "KRW",
      status: "ACTIVE",
      createdById: userIds["admin@eumbms.local"],
      config: {
        customerType: "산업용(을)",
        baseRatePerKw: 6500,
        demandRatePerKw: 0,
        energyTiers: [
          { limit: 100, rate: 90 },
          { limit: 200, rate: 140 },
          { limit: null, rate: 190 },
        ],
        vatRate: 0.1,
        climateRate: 9,
        fuelAdjustmentRate: 5,
        powerFactorThreshold: 90,
        powerFactorPenaltyRate: 0.2,
        carbonFactor: 0.4781,
      } as object,
    },
  });

  // ── 알람 규칙
  await prisma.alarmRule.createMany({
    data: [
      { tenantId: tenant.id, siteId: wonju.id, name: "수전 전압 과전압", targetType: "TAG", targetId: tags.VOLTAGE_L1_N, condition: "GT", threshold: 250, severity: "MAJOR", channels: ["INAPP"] },
      { tenantId: tenant.id, siteId: wonju.id, name: "역률 저하", targetType: "TAG", targetId: tags.POWER_FACTOR, condition: "LT", threshold: 90, severity: "WARNING", channels: ["INAPP"] },
      { tenantId: tenant.id, siteId: wonju.id, name: "수전 계량기 통신장애", targetType: "DEVICE", targetId: simulatorDevice.id, condition: "COMM_FAIL", severity: "CRITICAL", channels: ["INAPP"] },
      { tenantId: tenant.id, siteId: wonju.id, name: "차단기 트립", targetType: "TAG", targetId: tags.BREAKER_STATE, condition: "EQ", threshold: 0, severity: "CRITICAL", channels: ["INAPP"] },
    ],
  });

  // ── 검침 데이터 (최근 6개월, 세대별 누적값)
  const units = await prisma.unit.findMany({ where: { tenantId: tenant.id, buildingId: building.id } });
  const baseDate = new Date();
  for (const [unitIndex, unit] of units.entries()) {
    let cumulative = 12000 + unitIndex * 850;
    for (let monthOffset = 6; monthOffset >= 0; monthOffset--) {
      const readingAt = new Date(baseDate.getFullYear(), baseDate.getMonth() - monthOffset, 25, 10, 0, 0);
      cumulative += 180 + unitIndex * 12 + (monthOffset % 3) * 20;
      await prisma.meterReading.create({
        data: {
          tenantId: tenant.id,
          siteId: wonju.id,
          buildingId: building.id,
          unitId: unit.id,
          meterKind: "ELECTRICITY",
          readingAt,
          value: cumulative,
          source: monthOffset === 0 ? "MANUAL" : "AUTO",
          periodKey: `${readingAt.getFullYear()}-${String(readingAt.getMonth() + 1).padStart(2, "0")}`,
        },
      });
    }
  }

  // ── 시계열 예시 (트렌드 화면 확인용)
  const now = Date.now();
  for (let i = 0; i < 60; i++) {
    const ts = new Date(now - i * 5 * 60 * 1000);
    await prisma.tagReading.create({
      data: {
        tenantId: tenant.id,
        siteId: wonju.id,
        tagId: tags.ACTIVE_POWER,
        ts,
        value: Number((420 + Math.sin(i / 6) * 60 + Math.random() * 15).toFixed(2)),
        quality: "GOOD",
      },
    });
  }

  // ── 라이선스
  await prisma.license.create({
    data: {
      tenantId: tenant.id,
      licenseKey: "EUMBMS-DEMO-2026-0001-0001",
      edition: "ENTERPRISE",
      maxSites: 20,
      maxDevices: 2000,
      maxTags: 100000,
      status: "ACTIVE",
      features: ["SCADA", "METERING", "CONTROL", "PROTOCOL_CENTER", "EDGE_GATEWAY"],
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorId: userIds["admin@eumbms.local"],
      actorName: "시스템",
      action: "SEED",
      targetType: "tenant",
      targetId: tenant.id,
      after: { note: "초기 시드 데이터 생성" },
    },
  });

  console.log("시드 완료");
  console.log(`관리자: admin@eumbms.local / ${DEMO_PASSWORD}`);
  console.log(`승인자: approver@eumbms.local / ${DEMO_PASSWORD}`);
  console.log(`운전원: operator@eumbms.local / ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
