import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * 테스트 전용 DB 준비: 마이그레이션 적용 + 시드.
 * PostgreSQL이 실행 중이어야 한다 (scripts/db-up.sh).
 */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL 또는 DATABASE_URL이 필요합니다.");
  const cwd = process.cwd();
  const env = { ...process.env, DATABASE_URL: url };
  console.log("[test] prisma migrate deploy →", url.replace(/:[^:@/]+@/, ":***@"));
  execFileSync(path.join(cwd, "node_modules/.bin/prisma"), ["migrate", "deploy"], { cwd, env, stdio: "inherit" });
  execFileSync(path.join(cwd, "node_modules/.bin/tsx"), ["prisma/seed.ts"], { cwd, env, stdio: "inherit" });
}
