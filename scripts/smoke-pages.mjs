/**
 * 로그인 후 18개 메뉴 페이지가 서버에서 정상 렌더링되는지 확인한다.
 * 사용: node scripts/smoke-pages.mjs
 */
const BASE = process.env.EUMBMS_SMOKE_URL ?? "http://127.0.0.1:3100";
const routes = [
  "/", "/sites", "/buildings", "/scada", "/diagrams", "/devices", "/gateways", "/protocols", "/tags",
  "/metering", "/tariffs", "/energy", "/alarms", "/control", "/reports", "/users", "/settings", "/licenses",
];

async function main() {
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@eumbms.local", password: "Eumbms!2026" }),
  });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; ");
  if (!login.ok) throw new Error(`로그인 실패 ${login.status}`);
  let failures = 0;
  for (const route of routes) {
    const response = await fetch(`${BASE}${route}`, { headers: { cookie }, redirect: "manual" });
    const html = await response.text();
    const ok = response.status === 200 && !/Application error|Internal Server Error|__next_error__/.test(html);
    console.log(`${ok ? "PASS" : "FAIL"}  ${route.padEnd(14)} ${response.status} ${html.length}b`);
    if (!ok) {
      failures += 1;
      console.log(html.slice(0, 400));
    }
  }
  const diagrams = await fetch(`${BASE}/api/v1/diagrams`, { headers: { cookie } });
  const diagramData = await diagrams.json();
  const diagramId = diagramData.items?.[0]?.id;
  console.log(`INFO  도면 ID ${diagramId ?? "없음"}`);
  let total = routes.length;
  if (diagramId) {
    total += 1;
    const editor = await fetch(`${BASE}/diagrams/${diagramId}`, { headers: { cookie } });
    const editorHtml = await editor.text();
    const ok = editor.status === 200 && !/Application error|Internal Server Error/.test(editorHtml);
    console.log(`${ok ? "PASS" : "FAIL"}  /diagrams/[id]  ${editor.status} ${editorHtml.length}b`);
    if (!ok) failures += 1;
  }
  console.log(`\n=== 페이지 결과: ${total - failures}/${total} ===`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
