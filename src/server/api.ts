import { HttpError, getSession, type SessionPayload } from "@/lib/auth";

export type ApiContext = {
  req: Request;
  session: SessionPayload;
  path: string[];
  query: URLSearchParams;
  body: unknown;
  json: <T = unknown>() => Promise<T>;
};

export type Handler = (ctx: ApiContext) => Promise<unknown>;

export type RouteDef = {
  method: string;
  pattern: string; // 예: "devices/:id"
  handler: Handler;
};

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function matchRoute(pattern: string, path: string[]): Record<string, string> | null {
  const parts = pattern.split("/").filter(Boolean);
  if (parts.length !== path.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(":")) params[parts[i].slice(1)] = decodeURIComponent(path[i]);
    else if (parts[i] !== path[i]) return null;
  }
  return params;
}

let routesCache: RouteDef[] | null = null;

export async function loadRoutes(): Promise<RouteDef[]> {
  if (routesCache) return routesCache;
  const modules = await Promise.all([
    import("./routes/auth"),
    import("./routes/org"),
    import("./routes/devices"),
    import("./routes/protocols"),
    import("./routes/scada"),
    import("./routes/metering"),
    import("./routes/alarms"),
    import("./routes/control"),
    import("./routes/gateway"),
    import("./routes/licenses"),
    import("./routes/collector"),
  ]);
  routesCache = modules.flatMap((m) => m.routes);
  return routesCache;
}

const PUBLIC = new Set(["auth/login", "health"]);

export async function handleRequest(req: Request, path: string[]): Promise<Response> {
  const url = new URL(req.url);
  try {
    const routes = await loadRoutes();
    const pathKey = path.join("/");
    const isPublic = PUBLIC.has(pathKey) || path[0] === "gateway";
    let session = await getSession();
    if (!session && !isPublic) throw new HttpError(401, "로그인이 필요합니다.");
    if (!session && isPublic) {
      session = {
        uid: "",
        tid: "",
        email: "",
        name: "guest",
        roleCode: "GUEST",
        permissions: [],
        exp: 0,
      };
    }
    for (const route of routes) {
      if (route.method !== req.method && !(route.method === "GET" && req.method === "HEAD")) continue;
      const params = matchRoute(route.pattern, path);
      if (!params) continue;
      let body: unknown = undefined;
      const contentType = req.headers.get("content-type") ?? "";
      if (req.method !== "GET" && req.method !== "HEAD" && !contentType.includes("multipart/form-data")) {
        const text = await req.text();
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            throw new HttpError(400, "요청 본문이 올바른 JSON이 아닙니다.");
          }
        }
      }
      const result = await route.handler({
        req,
        session: session as SessionPayload,
        path,
        query: url.searchParams,
        body,
        json: async <T,>() => (body ?? {}) as T,
      });
      if (result instanceof Response) return result;
      return jsonResponse(result ?? { ok: true });
    }
    throw new HttpError(404, `API 경로를 찾을 수 없습니다: ${req.method} /api/v1/${pathKey}`);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message, status: error.status }, error.status);
    }
    const message = (error as Error).message ?? "서버 오류";
    console.error("[api]", req.method, url.pathname, error);
    return jsonResponse({ error: message, status: 500 }, 500);
  }
}

export function assert(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new HttpError(status, message);
}

export function str(body: Record<string, unknown>, key: string, required = true): string {
  const value = body[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (required) throw new HttpError(400, `${key} 값이 필요합니다.`);
  return "";
}

export function num(body: Record<string, unknown>, key: string, fallback?: number): number {
  const value = body[key];
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `${key} 값이 필요합니다.`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, `${key} 값이 숫자가 아닙니다.`);
  return parsed;
}

export function optNum(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function bool(body: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = body[key];
  if (value === undefined) return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}
