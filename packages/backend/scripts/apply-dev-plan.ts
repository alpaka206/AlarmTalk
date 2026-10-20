/**
 * dev 환경용: 특정 이메일 계정에 개인 플랜을 직접 적용한다.
 *
 *   1) 기존 active 구독을 cancelled 로 정리
 *   2) 새 active 개인 구독 INSERT
 *   3) users.plan 미러 갱신 (personal → plus)
 *
 * 사용 (packages/backend 에서):
 *   node --experimental-strip-types scripts/apply-dev-plan.ts --email devrel.365@gmail.com
 *   옵션: --days <n> (기본 30), --env-file <파일> (기본 .dev.vars.dev)
 */

import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(SCRIPT_DIR, '..');

function argValue(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === name) return argv[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

const DEV_VARS = resolve(BACKEND_DIR, argValue('--env-file') ?? '.dev.vars.dev');

function loadDevVars(): Record<string, string> {
  const text = readFileSync(DEV_VARS, 'utf-8');
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

// migrations.ts 의 고정 plan UUID(개인).
const PERSONAL_PLAN_ID = '70000000-0000-4000-8000-000000000002';
// billing-helpers.planTypeToUserPlan 과 동일 (personal → plus).
const PERSONAL_USER_PLAN = 'plus';

async function main(): Promise<void> {
  const email = argValue('--email');
  if (!email) throw new Error('--email 이 필요합니다.');
  const days = Number(argValue('--days') ?? '30');

  const vars = loadDevVars();
  const url = vars.TURSO_DATABASE_URL;
  const authToken = vars.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error(`TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 이 ${DEV_VARS} 에 없음`);
  }
  const db = createClient({ url, authToken });

  const userRes = await db.execute({
    sql: 'SELECT id, email, plan FROM users WHERE email = ? LIMIT 1',
    args: [email],
  });
  if (userRes.rows.length === 0) throw new Error(`해당 이메일 유저가 없음: ${email}`);
  const userId = String(userRes.rows[0]!.id);
  const beforePlan = String(userRes.rows[0]!.plan);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // 1) 기존 active 구독 정리
  await db.execute({
    sql: `UPDATE subscriptions SET status = 'cancelled', canceled_at = ?, updated_at = datetime('now')
          WHERE user_id = ? AND status = 'active'`,
    args: [now.toISOString(), userId],
  });

  // 2) 새 active 개인 구독
  await db.execute({
    sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
          VALUES (?, ?, ?, 'active', ?, ?)`,
    args: [crypto.randomUUID(), userId, PERSONAL_PLAN_ID, now.toISOString(), expiresAt.toISOString()],
  });

  // 3) users.plan 미러
  await db.execute({
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [PERSONAL_USER_PLAN, userId],
  });

  console.log(
    `적용 완료: ${email} (id=${userId})\n` +
      `  plan: personal (users.plan ${beforePlan} → ${PERSONAL_USER_PLAN})\n` +
      `  expires_at: ${expiresAt.toISOString()}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
