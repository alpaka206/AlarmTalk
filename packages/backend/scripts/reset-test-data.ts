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
import { execSync, spawnSync } from 'node:child_process';
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
}

function clearR2Bucket(bucket: string): void {
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['wrangler']);
  if (which.status !== 0) {
    console.log(`  (wrangler not found on PATH — skip R2; run \`npx wrangler r2 ...\` manually)`);
    return;
  }
  let listJson: string;
  try {
    listJson = execSync(
      `wrangler r2 object list ${bucket} --remote --output json`,
      { stdio: ['ignore', 'pipe', 'inherit'] },
    ).toString();
  } catch {
    console.log(`  (wrangler list failed — skip R2)`);
    return;
  }
  const parsed = JSON.parse(listJson) as { result?: Array<{ key: string }>; objects?: Array<{ key: string }> };
  const objects = parsed.result ?? parsed.objects ?? [];
  if (objects.length === 0) {
    console.log('  (R2 bucket is already empty)');
    return;
  }
  console.log(`  → ${objects.length} object(s) to delete`);
  for (const o of objects) {
    try {
      execSync(`wrangler r2 object delete ${bucket}/${o.key} --remote`, { stdio: 'pipe' });
      console.log(`  ✓ ${o.key}`);
    } catch (err) {
      console.warn(`  ✗ ${o.key}: ${(err as Error).message}`);
    }
  }
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
  console.log(`  DB     : ${tursoUrl}`);
  console.log(`  R2     : ${bucket}`);
  console.log('');

  if (!(await confirm('This will WIPE all user data. Continue?'))) {
    console.log('aborted.');
    process.exit(1);
  }

  console.log('\n[1/2] Clearing DB tables...');
  await clearDatabase(tursoUrl, tursoToken);

  console.log('\n[2/2] Clearing R2 bucket...');
  clearR2Bucket(bucket);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
