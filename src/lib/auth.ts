import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import prisma from "./db";
import { hasPermission } from "./rbac";

export const SESSION_COOKIE = "eumbms_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function secret(): string {
  return process.env.SESSION_SECRET || "eumbms-dev-secret";
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const computed = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== computed.length) return false;
  return timingSafeEqual(computed, expected);
}

export type SessionPayload = {
  uid: string;
  tid: string;
  email: string;
  name: string;
  roleCode: string;
  permissions: string[];
  exp: number;
};

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function encodeSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}

export async function setSessionCookie(payload: Omit<SessionPayload, "exp">): Promise<void> {
  const store = await cookies();
  const full: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  store.set(SESSION_COOKIE, encodeSession(full), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function authenticate(email: string, password: string): Promise<SessionPayload | null> {
  const user = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase() },
    include: { role: true, tenant: true },
  });
  if (!user || user.status !== "ACTIVE") return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return {
    uid: user.id,
    tid: user.tenantId,
    email: user.email,
    name: user.name,
    roleCode: user.role?.code ?? "VIEWER",
    permissions: user.role?.permissions ?? [],
    exp: 0,
  };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new HttpError(401, "로그인이 필요합니다.");
  return session;
}

export async function requirePermission(permission: string): Promise<SessionPayload> {
  const session = await requireSession();
  if (!hasPermission(session.permissions, permission)) {
    throw new HttpError(403, `권한이 없습니다: ${permission}`);
  }
  return session;
}

export async function audit(
  session: Pick<SessionPayload, "uid" | "tid" | "name">,
  action: string,
  targetType: string,
  targetId: string | null,
  before: unknown,
  after: unknown,
  req?: Request,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      tenantId: session.tid,
      actorId: session.uid,
      actorName: session.name,
      action,
      targetType,
      targetId,
      before: before === undefined ? undefined : JSON.parse(JSON.stringify(before)),
      after: after === undefined ? undefined : JSON.parse(JSON.stringify(after)),
      ip: req?.headers.get("x-forwarded-for") ?? null,
      userAgent: req?.headers.get("user-agent") ?? null,
    },
  });
}
