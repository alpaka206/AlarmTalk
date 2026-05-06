/**
 * 테스트 데이터 일괄 초기화 스크립트.
 *
 * 1. Turso(libsql) DB 의 모든 사용자 테이블을 비운다 (메타/마이그레이션 테이블은 제외).
 * 2. R2 버킷(voice-alarm-voices) 의 객체를 모두 삭제한다 (wrangler 가 PATH 에 있을 때만).
 *
 * 환경변수:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN  → packages/backend/.dev.vars 에서 자동 로드
 *   R2_BUCKET (선택, 기본값 voice-alarm-voices)
 *
 * 사용:
 *   npm run reset:test-data --workspace=backend
 *   (또는 packages/backend 에서: npm run reset:test-data)
 */

import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(SCRIPT_DIR, '..');
const DEV_VARS = resolve(BACKEND_DIR, '.dev.vars');

const PROTECTED_TABLES = new Set<string>([
  '_litestream_seq',
  '_litestream_lock',
]);

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

async function confirm(message: string): Promise<boolean> {
  if (process.argv.includes('--yes') || process.env.CI) return true;
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

async function clearDatabase(url: string, authToken: string): Promise<void> {
  const client = createClient({ url, authToken });
  const list = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'",
  );
  const tables = list.rows
    .map((r) => String(r['name']))
    .filter((name) => !PROTECTED_TABLES.has(name));

  if (tables.length === 0) {
    console.log('  (no user tables found — nothing to clear)');
    return;
  }
  console.log(`  → tables to clear (${tables.length}): ${tables.join(', ')}`);

  // 외래키 무시하고 일괄 삭제. (libsql remote 는 PRAGMA 제한 있을 수 있어 try)
  try {
    await client.execute('PRAGMA foreign_keys = OFF');
  } catch {
    /* ignore — turso remote 에서는 거부될 수 있음 */
  }

  for (const t of tables) {
    try {
      const res = await client.execute(`DELETE FROM "${t}"`);
      console.log(`  ✓ ${t} (rows=${res.rowsAffected})`);
    } catch (err) {
      console.warn(`  ✗ ${t}: ${(err as Error).message}`);
    }
  }

  // 시드 데이터 재주입 — _migrations ledger 는 보존하므로 직접 다시 채워둔다.
  await reseedPlans(client);
}

async function reseedPlans(client: ReturnType<typeof createClient>): Promise<void> {
  const seeds: Array<[string, string, string, string, number, number, number, number]> = [
    ['70000000-0000-4000-8000-000000000001', 'free', '무료', 'free', 36500, 1, 0, 1],
    ['70000000-0000-4000-8000-000000000002', 'personal', '개인', 'personal', 30, 1, 4900, 1],
    ['70000000-0000-4000-8000-000000000003', 'family', '가족', 'family', 30, 6, 9900, 1],
    ['70000000-0000-4000-8000-000000000004', 'couple', '커플', 'family', 30, 2, 7900, 1],
  ];
  for (const args of seeds) {
    await client.execute({
      sql: `INSERT OR IGNORE INTO plans (id, key, name, plan_type, period_days, max_members, price_krw, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args,
    });
  }
  console.log(`  ↻ reseeded plans (${seeds.length} rows)`);
}

async function clearR2Bucket(bucket: string, env: Record<string, string>): Promise<void> {
  // 우선 cloudflare REST API 시도 (한 번에 일괄 삭제 가능).
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  if (accountId && apiToken) {
    await clearR2BucketViaApi(bucket, accountId, apiToken);
    return;
  }

  // 폴백: 자동화 불가. wrangler v4 에는 r2 object list 가 없어 일괄 삭제 CLI 가 부재.
  console.log('  R2 자동 정리를 건너뜁니다 — 다음 중 하나로 직접 비워 주세요:');
  console.log('    1) Cloudflare 대시보드 → R2 → 대상 버킷에서 일괄 삭제');
  console.log('    2) .dev.vars 에 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN');
  console.log('       (R2 Read+Write) 추가 후 본 스크립트 재실행');
  void bucket; // bucket 이름은 환경변수에서 오므로 평문 로그 회피.
}

async function clearR2BucketViaApi(bucket: string, accountId: string, apiToken: string): Promise<void> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`;
  let cursor: string | undefined;
  let total = 0;
  do {
    const url = cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
    if (!res.ok) {
      console.warn(`  ✗ list failed: ${res.status} ${await res.text()}`);
      return;
    }
    const json = (await res.json()) as {
      result?: Array<{ key: string }>;
      result_info?: { cursor?: string };
    };
    const objects = json.result ?? [];
    for (const o of objects) {
      const delRes = await fetch(`${base}/${encodeURIComponent(o.key)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (delRes.ok) {
        console.log(`  ✓ ${o.key}`);
        total += 1;
      } else {
        console.warn(`  ✗ ${o.key}: ${delRes.status}`);
      }
    }
    cursor = json.result_info?.cursor && json.result_info.cursor.length > 0 ? json.result_info.cursor : undefined;
  } while (cursor);
  if (total === 0) console.log('  (R2 bucket is already empty)');
}

async function main(): Promise<void> {
  const env = { ...loadDevVars(), ...process.env };
  const tursoUrl = env.TURSO_DATABASE_URL;
  const tursoToken = env.TURSO_AUTH_TOKEN;
  if (!tursoUrl || !tursoToken) {
    throw new Error('TURSO_DATABASE_URL / TURSO_AUTH_TOKEN missing — check .dev.vars');
  }
  const bucket = env.R2_BUCKET ?? 'voice-alarm-voices';

  console.log('Reset target:');
  console.log('  DB     : (configured via TURSO_DATABASE_URL)');
  console.log('  R2     : (configured via R2_BUCKET, default voice-alarm-voices)');
  console.log('');

  if (!(await confirm('This will WIPE all user data. Continue?'))) {
    console.log('aborted.');
    process.exit(1);
  }

  console.log('\n[1/2] Clearing DB tables...');
  await clearDatabase(tursoUrl, tursoToken);

  console.log('\n[2/2] Clearing R2 bucket...');
  await clearR2Bucket(bucket, env);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
