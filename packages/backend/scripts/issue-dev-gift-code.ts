/**
 * dev 환경용 이용권 바우처 코드 발급 스크립트.
 *
 * 시스템 발급자 유저(system:voucher-issuer)를 보장한 뒤 voucher_codes 에
 * 코드를 삽입하고 평문 코드를 출력한다. 앱의 "코드 등록" (POST /api/code/register)
 * 에 그대로 입력하면 해당 플랜이 적용된다.
 *
 * personal 플랜은 GIFT- 프리픽스, couple/family 는 INV- 프리픽스를 쓴다
 * (voucher-redemption.ts 의 프리픽스-플랜 검증 규칙과 동일).
 *
 * 사용 (packages/backend 에서):
 *   node --experimental-strip-types scripts/issue-dev-gift-code.ts            # personal 1개
 *   node --experimental-strip-types scripts/issue-dev-gift-code.ts --plan couple --count 2
 *   옵션: --plan <personal|couple|family>, --count <n>, --expires-days <n>, --max-uses <n>,
 *         --env-file <파일> (기본 .dev.vars.dev)
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

// src/lib/vouchers.ts 와 동일한 포맷/해시 (0/O/1/I/L 제외 알파벳, SHA-256 hex).
const VOUCHER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomGroup(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += VOUCHER_ALPHABET[bytes[i]! % VOUCHER_ALPHABET.length]!;
  }
  return out;
}

async function hashVoucherCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const SYSTEM_ISSUER_GOOGLE_ID = 'system:voucher-issuer';

async function main(): Promise<void> {
  const planKey = argValue('--plan') ?? 'personal';
  if (!['personal', 'couple', 'family'].includes(planKey)) {
    throw new Error(`--plan 은 personal|couple|family 중 하나여야 함: ${planKey}`);
  }
  const count = Number(argValue('--count') ?? '1');
  const expiresDays = Number(argValue('--expires-days') ?? '365');
  const maxUses = Number(argValue('--max-uses') ?? '1');
  const prefix = planKey === 'personal' ? 'GIFT' : 'INV';

  const vars = loadDevVars();
  const url = vars.TURSO_DATABASE_URL;
  const authToken = vars.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error(`TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 이 ${DEV_VARS} 에 없음`);
  }
  const db = createClient({ url, authToken });

  const planRes = await db.execute({
    sql: 'SELECT id, name FROM plans WHERE key = ?',
    args: [planKey],
  });
  if (planRes.rows.length === 0) throw new Error(`plans.key='${planKey}' 가 DB 에 없음`);
  const planId = String(planRes.rows[0]!.id);

  // 셀프 등록 차단(SELF_ISSUED) 을 피하기 위한 시스템 발급자.
  let issuerRes = await db.execute({
    sql: 'SELECT id FROM users WHERE google_id = ?',
    args: [SYSTEM_ISSUER_GOOGLE_ID],
  });
  if (issuerRes.rows.length === 0) {
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, name, plan)
            VALUES (?, ?, 'system@alarm-talk.com', 'System Voucher Issuer', 'free')`,
      args: [crypto.randomUUID(), SYSTEM_ISSUER_GOOGLE_ID],
    });
    issuerRes = await db.execute({
      sql: 'SELECT id FROM users WHERE google_id = ?',
      args: [SYSTEM_ISSUER_GOOGLE_ID],
    });
  }
  const issuerId = String(issuerRes.rows[0]!.id);

  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = `${prefix}-${randomGroup()}-${randomGroup()}-${randomGroup()}`;
    const hash = await hashVoucherCode(code);
    await db.execute({
      sql: `INSERT INTO voucher_codes (id, code, code_hash, plan_id, issuer_user_id, status, max_uses, expires_at)
            VALUES (?, ?, ?, ?, ?, 'issued', ?, ?)`,
      args: [crypto.randomUUID(), code, hash, planId, issuerId, maxUses, expiresAt],
    });
    codes.push(code);
  }

  console.log(`발급 완료 — plan=${planKey}, max_uses=${maxUses}, expires_at=${expiresAt}`);
  for (const code of codes) console.log(code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
