/**
 * EUMBMS 실제 HTTP API 스모크 테스트.
 * 전제: `next start` 서버와 Modbus 시뮬레이터(15020/15021)가 실행 중이고,
 *       테스트 DB에 마이그레이션·시드가 적용되어 있어야 한다.
 * 사용: node scripts/smoke-http.mjs
 */
import net from "node:net";

const BASE = process.env.EUMBMS_SMOKE_URL ?? "http://127.0.0.1:3100";
const results = [];
let failures = 0;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function request(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.cookie) headers.cookie = options.cookie;
  let body = options.body;
  if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  const response = await fetch(`${BASE}/api/v1/${path}`, { method: options.method ?? "GET", headers, body });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data, text, headers: response.headers };
}

async function login(email, password = "Eumbms!2026") {
  const response = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const cookie = setCookie.map((value) => value.split(";")[0]).filter(Boolean).join("; ");
  const data = await response.json();
  if (!response.ok) throw new Error(`로그인 실패 ${email}: ${JSON.stringify(data)}`);
  return { cookie, user: data.user };
}

async function waitForHealth(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(`${BASE}/api/v1/health`);
      if (response.ok) return true;
    } catch {
      // 대기
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function startCustomFrameServer() {
  const server = net.createServer((socket) => {
    socket.on("data", () => {
      // AA 55 + unit + fc + value(2) + dummy
      socket.write(Buffer.from([0xaa, 0x55, 0x01, 0x03, 0x00, 0x2a, 0x00, 0x00]));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

async function main() {
  const healthy = await waitForHealth();
  record("health endpoint", healthy, BASE);
  if (!healthy) {
    console.error("서버가 응답하지 않습니다.");
    process.exit(1);
  }

  const operator = await login("operator@eumbms.local");
  record("로그인 (운전원)", Boolean(operator.cookie), operator.user.role);
  const admin = await login("admin@eumbms.local");
  record("로그인 (최고관리자)", Boolean(admin.cookie), admin.user.role);

  const dashboard = await request("dashboard", { cookie: operator.cookie });
  record("통합 대시보드 조회", dashboard.status === 200 && dashboard.data.counts.devices >= 2, `장치 ${dashboard.data?.counts?.devices}대, 태그 ${dashboard.data?.counts?.tags}개`);

  const liveBefore = await request("live", { cookie: operator.cookie });
  record("실시간 계측 조회", liveBefore.status === 200 && Array.isArray(liveBefore.data.items));

  const collect = await request("collector/run", { method: "POST", cookie: admin.cookie });
  record(
    "서버 내장 수집기 → 실제 Modbus TCP 수집",
    collect.status === 200 && collect.data.goodTags > 0,
    `status ${collect.status} · 장치 ${collect.data?.okDevices}/${collect.data?.devices}, 태그 ${collect.data?.tags}, 정상 ${collect.data?.goodTags}, 오류 ${collect.data?.errors?.length ?? 0} ${collect.status !== 200 ? collect.text.slice(0, 200) : ""}`,
  );

  const liveAfter = await request("live", { cookie: operator.cookie });
  const voltage = liveAfter.data.items.find((tag) => tag.standardKey === "VOLTAGE_L1_N");
  record("수집값이 실제 소켓 응답(220V대)으로 저장됨", voltage && voltage.lastValue > 200 && voltage.lastValue < 260, `${voltage?.lastValue} ${voltage?.unit ?? ""} (${voltage?.quality})`);

  const energy = await request("energy/analysis?months=12", { cookie: operator.cookie });
  record("에너지 분석(월별 사용량/탄소)", energy.status === 200 && energy.data.series.length > 0, `${energy.data?.series?.length}개월, ${energy.data?.totalUsage}kWh`);

  // 방식 2: 매뉴얼 업로드
  const csv = "Schneider Electric Modbus TCP register map\nname,address,type,unit\nVoltage,40001,FLOAT,V\nCurrent,40003,FLOAT,A\nActivePower,40005,FLOAT,kW\n";
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "schneider-register-map.csv");
  const upload = await request("protocols/documents/upload", { method: "POST", cookie: admin.cookie, body: form });
  record(
    "매뉴얼 업로드 → 분석 초안 생성",
    upload.status === 200 && upload.data.analysis.registers.length >= 2,
    `status ${upload.status} · 레지스터 ${upload.data?.analysis?.registers?.length}개 ${upload.status !== 200 ? upload.text.slice(0, 300) : ""}`,
  );
  if (upload.status === 200) {
    const approve = await request(`protocols/profiles/${upload.data.profile.id}/review`, { method: "POST", cookie: admin.cookie, json: { approve: true } });
    record("프로파일 관리자 승인", approve.status === 200 && approve.data.reviewStatus === "APPROVED");
    const sites = await request("sites", { cookie: operator.cookie });
    const instantiate = await request(`protocols/profiles/${upload.data.profile.id}/instantiate`, {
      method: "POST",
      cookie: admin.cookie,
      json: { siteId: sites.data.items[0].id, name: "스모크 테스트 장치", deviceType: "METER" },
    });
    record("승인 프로파일 → 장치/태그 생성", instantiate.status === 200 && instantiate.data.tagsCreated >= 2, `태그 ${instantiate.data?.tagsCreated}개`);
  }

  // 방식 3: 사용자 정의 프레임 실제 TCP
  const frameServer = await startCustomFrameServer();
  try {
    const frameTest = await request("protocols/frame/test", {
      method: "POST",
      cookie: admin.cookie,
      json: {
        host: "127.0.0.1",
        port: frameServer.port,
        address: 0,
        count: 1,
        template: {
          name: "smoke",
          transport: "TCP",
          request: [{ kind: "HEX", value: "AA55" }, { kind: "U8", value: 1 }, { kind: "U8", value: 3 }, { kind: "ADDRESS" }, { kind: "COUNT" }, { kind: "CRC16" }],
          response: { header: "AA55", minLength: 6, maxLength: 64, valueOffset: 4, valueLength: 2, dataType: "UINT16", byteOrder: "AB", wordOrder: "ABCD", scale: 1, offsetValue: 0 },
          timeoutMs: 1500,
          retries: 0,
        },
      },
    });
    record("사용자 정의 프레임 실제 TCP 송수신", frameTest.status === 200 && Number(frameTest.data.value) === 42, `status ${frameTest.status} · ${frameTest.data?.responseHex ?? frameTest.text.slice(0, 200)} → ${frameTest.data?.value}`);
  } finally {
    frameServer.server.close();
  }

  // 원격제어 이중 승인 전체 흐름
  const assets = await request("control/assets", { cookie: operator.cookie });
  const target = assets.data.items.find((asset) => asset.controlReady && asset.remoteControlEnabled);
  record("제어 준비된 설비 조회", Boolean(target), target?.name);
  if (target) {
    const requestResult = await request("control/commands", {
      method: "POST",
      cookie: operator.cookie,
      json: { assetId: target.id, command: "OPEN", reason: "스모크 테스트 개방", idempotencyKey: `smoke-open-${Date.now()}`, requiredApprovals: 2 },
    });
    record("제어 요청 생성 (REQUESTED)", requestResult.status === 200 && requestResult.data.command.status === "REQUESTED", requestResult.data?.command?.status ?? requestResult.text);
    const commandId = requestResult.data?.command?.id;

    const selfApprove = await request(`control/commands/${commandId}/approve`, { method: "POST", cookie: operator.cookie, json: { decision: "APPROVED" } });
    record("요청자 본인 승인 차단(권한 또는 자기승인 금지)", [403, 409].includes(selfApprove.status), selfApprove.data?.error);

    const approver = await login("approver@eumbms.local");
    const approve1 = await request(`control/commands/${commandId}/approve`, { method: "POST", cookie: approver.cookie, json: { decision: "APPROVED", comment: "1차 승인" } });
    record("1차 승인", approve1.status === 200 && approve1.data.status === "REQUESTED");
    const approve2 = await request(`control/commands/${commandId}/approve`, { method: "POST", cookie: admin.cookie, json: { decision: "APPROVED", comment: "2차 승인" } });
    record("2차 승인 → APPROVED", approve2.status === 200 && approve2.data.status === "APPROVED");

    const execute = await request(`control/commands/${commandId}/execute`, { method: "POST", cookie: approver.cookie });
    record("제어 실행 → 피드백 확인", execute.status === 200 && execute.data.status === "FEEDBACK_OK", `${execute.data?.status} / ${execute.data?.errorMessage ?? "정상"}`);
    const duplicate = await request(`control/commands/${commandId}/execute`, { method: "POST", cookie: approver.cookie });
    record("중복 실행 차단", duplicate.status === 409, duplicate.data?.error);
    const assetAfter = await request("control/assets", { cookie: operator.cookie });
    const updated = assetAfter.data.items.find((asset) => asset.id === target.id);
    record("차단기 최종 상태 OPEN 반영", updated?.breakerState === "OPEN", updated?.breakerState);

    // 복구(CLOSE)
    const closeRequest = await request("control/commands", {
      method: "POST",
      cookie: operator.cookie,
      json: { assetId: target.id, command: "CLOSE", reason: "스모크 테스트 복구", idempotencyKey: `smoke-close-${Date.now()}` },
    });
    const closeId = closeRequest.data?.command?.id;
    await request(`control/commands/${closeId}/approve`, { method: "POST", cookie: approver.cookie, json: { decision: "APPROVED" } });
    await request(`control/commands/${closeId}/approve`, { method: "POST", cookie: admin.cookie, json: { decision: "APPROVED" } });
    const closeExecute = await request(`control/commands/${closeId}/execute`, { method: "POST", cookie: approver.cookie });
    record("제어 복구(CLOSE) 피드백", closeExecute.data?.status === "FEEDBACK_OK", closeExecute.data?.status);
  }

  // 게이트웨이 API
  const createGateway = await request("gateways", {
    method: "POST",
    cookie: admin.cookie,
    json: { siteId: (await request("sites", { cookie: operator.cookie })).data.items[0].id, name: "스모크 게이트웨이", kind: "EDGE", mode: "TCP_CLIENT" },
  });
  const token = createGateway.data?.enrollToken;
  record("게이트웨이 등록 + 토큰 발급", Boolean(token), `status ${createGateway.status} ${createGateway.data?.gateway?.serial ?? createGateway.text.slice(0, 200)}`);
  if (token) {
    const handshake = await fetch(`${BASE}/api/v1/gateway/handshake`, { method: "POST", headers: { "x-gateway-token": token, "content-type": "application/json" }, body: "{}" });
    const handshakeData = await handshake.json();
    record("게이트웨이 핸드셰이크", handshake.ok && handshakeData.devices.length >= 1, `장치 ${handshakeData?.devices?.length}대`);
    const device = handshakeData.devices?.[0];
    const tag = device?.tags?.[0];
    if (tag) {
      const ingest = await fetch(`${BASE}/api/v1/gateway/ingest`, {
        method: "POST",
        headers: { "x-gateway-token": token, "content-type": "application/json" },
        body: JSON.stringify({ readings: [{ deviceId: device.id, tagId: tag.id, value: 123.45, quality: "GOOD", ts: new Date().toISOString() }] }),
      });
      const ingestData = await ingest.json();
      record("게이트웨이 수집값 수신(ingest)", ingest.ok && ingestData.stored === 1, `stored=${ingestData?.stored}`);
    }
    const badToken = await fetch(`${BASE}/api/v1/gateway/handshake`, { method: "POST", headers: { "x-gateway-token": "eum_invalid", "content-type": "application/json" }, body: "{}" });
    record("잘못된 게이트웨이 토큰 차단", badToken.status === 401);
  }

  // RBAC
  const viewer = await login("viewer@eumbms.local");
  const forbidden = await request("sites", { method: "POST", cookie: viewer.cookie, json: { code: "X", name: "권한없음" } });
  record("조회자 사업장 등록 차단(403)", forbidden.status === 403, forbidden.data?.error);

  // 보고서 CSV
  const reportResponse = await fetch(`${BASE}/api/v1/reports/export`, {
    method: "POST",
    headers: { cookie: admin.cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: "metering", format: "csv" }),
  });
  const reportText = await reportResponse.text();
  record("검침 보고서 CSV 생성", reportResponse.ok && reportText.includes("호실"), `${reportText.split("\n").length - 1}행 (status ${reportResponse.status}) ${reportResponse.ok ? "" : reportText.slice(0, 200)}`);

  // 감사로그
  const audit = await request("audit-logs", { cookie: admin.cookie });
  const executed = (audit.data?.items ?? []).some((log) => log.action === "CONTROL_EXECUTE");
  record("제어 감사로그 기록", executed);

  console.log(`\n=== 결과: ${results.length - failures}/${results.length} 통과 ===`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error("스모크 테스트 오류", error);
  process.exit(1);
});
