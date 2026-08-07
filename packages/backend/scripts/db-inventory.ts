/**
 * DB 인벤토리 (읽기 전용). 스키마 전수·행수·NULL 분포·정합성 검사와,
 * 사장(死藏) 스키마 정리를 위한 "이 객체에 실제 데이터가 있는가" 프로브를 출력한다.
 *
 * 개인정보는 출력하지 않는다 — 값이 아니라 count / distinct count 만 찍는다.
 * 쓰기 문장을 실행하지 않는다 (SELECT / PRAGMA 전용).
 *
 * 사용 (packages/backend 에서):
 *   node --experimental-strip-types scripts/db-inventory.ts                       # dev
 *   node --experimental-strip-types scripts/db-inventory.ts --env-file .dev.vars.prod
 *   옵션: --json <경로>  결과를 JSON 으로 저장 (기본: 표준출력 요약만)
 */

import { createClient, type Client } from '@libsql/client';
import { readFileSync, writeFileSync } from 'node:fs';
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

function loadEnvFile(path: string): Record<string, string> {
  const text = readFileSync(path, 'utf-8');
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

/** 식별자 인용 — sqlite_master 에서 읽은 이름만 넘어오지만 방어적으로 처리. */
function q(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

async function num(db: Client, sql: string): Promise<number> {
  const r = await db.execute(sql);
  const v = r.rows[0]?.[0];
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

/** 실패해도 인벤토리 전체를 중단시키지 않는 프로브 (컬럼/테이블이 이미 없을 수 있음). */
async function tryNum(db: Client, sql: string): Promise<number | string> {
  try {
    return await num(db, sql);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `n/a (${msg.replace(/\s+/g, ' ').slice(0, 80)})`;
  }
}

interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  pk: boolean;
  nulls: number;
  distinct: number;
}

interface TableInfo {
  name: string;
  rows: number;
  columns: ColumnInfo[];
  indexes: string[];
}

async function main() {
  const envFile = resolve(BACKEND_DIR, argValue('--env-file') ?? '.dev.vars.dev');
  const env = loadEnvFile(envFile);
  const url = env.TURSO_DATABASE_URL;
  const authToken = env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error(`TURSO_DATABASE_URL 없음: ${envFile}`);

  const db = createClient({ url, authToken });
  const host = url.replace(/^libsql:\/\//, '').split('.')[0];
  console.log(`\n═══ DB 인벤토리 — ${host} (${envFile.split(/[\\/]/).pop()}) ═══\n`);

  // ── 스키마 전수 ────────────────────────────────────────────────
  const master = await db.execute(
    `SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
  );
  const tables = master.rows.filter((r) => r.type === 'table').map((r) => String(r.name));
  const views = master.rows.filter((r) => r.type === 'view').map((r) => String(r.name));
  const indexes = master.rows
    .filter((r) => r.type === 'index')
    .map((r) => ({ name: String(r.name), table: String(r.tbl_name), sql: r.sql as string | null }));

  // 참조 테이블이 사라진 뷰 — libSQL 의 ALTER TABLE DROP COLUMN 을 통째로 실패시킨다.
  const danglingViews: string[] = [];
  for (const v of views) {
    try {
      await db.execute(`SELECT * FROM ${q(v)} LIMIT 0`);
    } catch {
      danglingViews.push(v);
    }
  }

  // ── 테이블별 행수 / 컬럼 분포 ──────────────────────────────────
  const tableInfos: TableInfo[] = [];
  for (const t of tables) {
    const rows = await num(db, `SELECT COUNT(*) FROM ${q(t)}`);
    const cols = await db.execute(`PRAGMA table_info(${q(t)})`);
    const columns: ColumnInfo[] = [];
    for (const c of cols.rows) {
      const name = String(c.name);
      // 빈 테이블은 전부 0 — 쿼리 왕복을 아낀다.
      const nulls = rows === 0 ? 0 : await num(db, `SELECT COUNT(*) FROM ${q(t)} WHERE ${q(name)} IS NULL`);
      const distinct =
        rows === 0 ? 0 : await num(db, `SELECT COUNT(DISTINCT ${q(name)}) FROM ${q(t)}`);
      columns.push({
        name,
        type: String(c.type ?? ''),
        notNull: Number(c.notnull) === 1,
        defaultValue: c.dflt_value == null ? null : String(c.dflt_value),
        pk: Number(c.pk) > 0,
        nulls,
        distinct,
      });
    }
    tableInfos.push({
      name: t,
      rows,
      columns,
      indexes: indexes.filter((i) => i.table === t).map((i) => i.name),
    });
  }

  // ── 정합성 ────────────────────────────────────────────────────
  const integrity = (await db.execute('PRAGMA integrity_check')).rows.map((r) => String(r[0]));
  const fkViolations = (await db.execute('PRAGMA foreign_key_check')).rows.length;

  // ── 정리 판단용 프로브 ────────────────────────────────────────
  // "제거해도 되는가"는 코드 사용처로 정하지만, 실데이터 유무가 위험도를 가른다.
  const probes: Record<string, number | string> = {
    'users.total': await tryNum(db, 'SELECT COUNT(*) FROM users'),
    'users.google_id NOT NULL': await tryNum(db, 'SELECT COUNT(*) FROM users WHERE google_id IS NOT NULL'),
    'users.password_hash NOT NULL': await tryNum(
      db,
      'SELECT COUNT(*) FROM users WHERE password_hash IS NOT NULL',
    ),
    'users.plan != free': await tryNum(db, "SELECT COUNT(*) FROM users WHERE plan != 'free'"),
    'users.deletion_status pending': await tryNum(
      db,
      "SELECT COUNT(*) FROM users WHERE deletion_status = 'pending_deletion'",
    ),
    "subscriptions active": await tryNum(
      db,
      "SELECT COUNT(*) FROM subscriptions WHERE status = 'active'",
    ),
    "push_tokens platform='android'": await tryNum(
      db,
      "SELECT COUNT(*) FROM push_tokens WHERE platform = 'android'",
    ),
    "store_transactions provider='google'": await tryNum(
      db,
      "SELECT COUNT(*) FROM store_transactions WHERE provider = 'google'",
    ),
    'plan_group_invites.total': await tryNum(db, 'SELECT COUNT(*) FROM plan_group_invites'),
    'plan_group_invites 최근90일': await tryNum(
      db,
      "SELECT COUNT(*) FROM plan_group_invites WHERE created_at > datetime('now','-90 days')",
    ),
    'voucher_codes.total': await tryNum(db, 'SELECT COUNT(*) FROM voucher_codes'),
    'voucher_codes max_uses>1': await tryNum(db, 'SELECT COUNT(*) FROM voucher_codes WHERE max_uses > 1'),
    'voucher_redemptions.total': await tryNum(db, 'SELECT COUNT(*) FROM voucher_redemptions'),
    // status/used_at 캐시가 redemptions 원장과 어긋난 행 = 중복 저장의 실증
    'voucher status↔redemptions 불일치': await tryNum(
      db,
      `SELECT COUNT(*) FROM voucher_codes vc
        WHERE (vc.status = 'used') !=
              (EXISTS (SELECT 1 FROM voucher_redemptions vr WHERE vr.voucher_id = vc.id))`,
    ),
    'message_library.total': await tryNum(db, 'SELECT COUNT(*) FROM message_library'),
    'message_library is_favorite=1': await tryNum(
      db,
      'SELECT COUNT(*) FROM message_library WHERE is_favorite = 1',
    ),
    // 남의 메시지를 저장한 행이 있으면 관계 테이블이 구조적으로 필요하다는 뜻
    'message_library 타인메시지': await tryNum(
      db,
      `SELECT COUNT(*) FROM message_library ml
        JOIN messages m ON m.id = ml.message_id WHERE m.user_id != ml.user_id`,
    ),
    'generated_audio_assets.total': await tryNum(db, 'SELECT COUNT(*) FROM generated_audio_assets'),
    'alarms.total': await tryNum(db, 'SELECT COUNT(*) FROM alarms'),
    'alarms.speaker_id NOT NULL': await tryNum(
      db,
      'SELECT COUNT(*) FROM alarms WHERE speaker_id IS NOT NULL',
    ),
    'alarms.raw_audio_url NOT NULL': await tryNum(
      db,
      'SELECT COUNT(*) FROM alarms WHERE raw_audio_url IS NOT NULL',
    ),
    'alarms.bucket_id NOT NULL': await tryNum(
      db,
      'SELECT COUNT(*) FROM alarms WHERE bucket_id IS NOT NULL',
    ),
    'voice_uploads.total': await tryNum(db, 'SELECT COUNT(*) FROM voice_uploads'),
    'voice_profiles.avatar_url NOT NULL': await tryNum(
      db,
      'SELECT COUNT(*) FROM voice_profiles WHERE avatar_url IS NOT NULL',
    ),
    'voice_profiles.voice_gender NOT NULL': await tryNum(
      db,
      'SELECT COUNT(*) FROM voice_profiles WHERE voice_gender IS NOT NULL',
    ),
    'voice_profiles.speech_formality NOT NULL': await tryNum(
      db,
      'SELECT COUNT(*) FROM voice_profiles WHERE speech_formality IS NOT NULL',
    ),
    'voice_profiles.speech_style NOT NULL': await tryNum(
      db,
      'SELECT COUNT(*) FROM voice_profiles WHERE speech_style IS NOT NULL',
    ),
    // 가족알람: legacy 단일 필드(#29)와 windows JSON(#30)의 실제 발산 여부
    'users quiet_windows 기본값 그대로': await tryNum(
      db,
      `SELECT COUNT(*) FROM users
        WHERE family_alarm_quiet_windows = '[{"days":[1,2,3,4,5],"start":"09:00","end":"18:30"}]'`,
    ),
    'users quiet_windows 커스텀': await tryNum(
      db,
      `SELECT COUNT(*) FROM users
        WHERE family_alarm_quiet_windows != '[{"days":[1,2,3,4,5],"start":"09:00","end":"18:30"}]'`,
    ),
    'users legacy quiet 컬럼 커스텀': await tryNum(
      db,
      `SELECT COUNT(*) FROM users
        WHERE family_alarm_quiet_days != '[1,2,3,4,5]'
           OR family_alarm_quiet_start != '09:00'
           OR family_alarm_quiet_end != '18:30'`,
    ),
    'users.allow_family_alarms=1': await tryNum(
      db,
      'SELECT COUNT(*) FROM users WHERE allow_family_alarms = 1',
    ),
    'users.dynamic_prompt_settings_json 비어있지않음': await tryNum(
      db,
      `SELECT COUNT(*) FROM users WHERE COALESCE(dynamic_prompt_settings_json, '{}') NOT IN ('{}', '')`,
    ),
    // 식별자 혼재 실증: 자식 행의 user_id 가 users.id 에 없는 경우
    'alarms.user_id ∉ users.id': await tryNum(
      db,
      'SELECT COUNT(*) FROM alarms a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)',
    ),
    'alarms.user_id = google_id 인 행': await tryNum(
      db,
      'SELECT COUNT(*) FROM alarms a WHERE EXISTS (SELECT 1 FROM users u WHERE u.google_id = a.user_id)',
    ),
    'messages.user_id ∉ users.id': await tryNum(
      db,
      'SELECT COUNT(*) FROM messages m WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.user_id)',
    ),
    'voice_profiles.user_id ∉ users.id': await tryNum(
      db,
      'SELECT COUNT(*) FROM voice_profiles v WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v.user_id)',
    ),
    'subscriptions.user_id ∉ users.id': await tryNum(
      db,
      'SELECT COUNT(*) FROM subscriptions s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)',
    ),
    'push_tokens.user_id ∉ users.id': await tryNum(
      db,
      'SELECT COUNT(*) FROM push_tokens p WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.user_id)',
    ),
    'generated_audio_assets.user_id ∉ users.id': await tryNum(
      db,
      'SELECT COUNT(*) FROM generated_audio_assets g WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.user_id)',
    ),
    // 고아 참조
    'alarms.message_id 고아': await tryNum(
      db,
      `SELECT COUNT(*) FROM alarms a WHERE a.message_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = a.message_id)`,
    ),
    'alarms.voice_profile_id 고아': await tryNum(
      db,
      `SELECT COUNT(*) FROM alarms a WHERE a.voice_profile_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM voice_profiles v WHERE v.id = a.voice_profile_id)`,
    ),
    'generated_audio_assets.message_id 고아': await tryNum(
      db,
      `SELECT COUNT(*) FROM generated_audio_assets g
        WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = g.message_id)`,
    ),
    // users.plan 미러가 subscriptions 원장과 어긋난 계정 수
    'users.plan ↔ 구독 불일치(유료인데 구독없음)': await tryNum(
      db,
      `SELECT COUNT(*) FROM users u WHERE u.plan != 'free'
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s
           WHERE s.user_id = u.id AND s.status = 'active'
             AND datetime(s.expires_at) > datetime('now'))`,
    ),
    'users.plan ↔ 구독 불일치(구독있는데 free)': await tryNum(
      db,
      `SELECT COUNT(*) FROM users u WHERE u.plan = 'free'
        AND EXISTS (
          SELECT 1 FROM subscriptions s
           WHERE s.user_id = u.id AND s.status = 'active'
             AND datetime(s.expires_at) > datetime('now'))`,
    ),
  };

  // ── 마이그레이션 원장 ─────────────────────────────────────────
  const ledger = await db.execute('SELECT id, name FROM _migrations ORDER BY id');
  const appliedIds = ledger.rows.map((r) => Number(r.id));

  // ── 출력 ──────────────────────────────────────────────────────
  console.log(`테이블 ${tables.length} · 뷰 ${views.length} · 인덱스 ${indexes.length}`);
  console.log(`integrity_check: ${integrity.join(', ')}`);
  console.log(`foreign_key_check 위반: ${fkViolations}`);
  console.log(
    `마이그레이션 적용: ${appliedIds.length}개 (최대 #${appliedIds[appliedIds.length - 1] ?? '-'})`,
  );
  if (danglingViews.length) {
    console.log(`\n⚠ 깨진 뷰 (참조 테이블 없음 — DROP COLUMN 을 실패시킨다): ${danglingViews.join(', ')}`);
  }

  console.log('\n── 테이블 행수 ──');
  for (const t of [...tableInfos].sort((a, b) => b.rows - a.rows)) {
    console.log(`  ${String(t.rows).padStart(7)}  ${t.name}  (${t.columns.length}컬럼)`);
  }

  console.log('\n── 전부 NULL 인 컬럼 (행이 있는 테이블만) ──');
  let allNullCount = 0;
  for (const t of tableInfos) {
    if (t.rows === 0) continue;
    for (const c of t.columns) {
      if (c.nulls === t.rows) {
        console.log(`  ${t.name}.${c.name}  (${t.rows}행 전부 NULL)`);
        allNullCount += 1;
      }
    }
  }
  if (allNullCount === 0) console.log('  없음');

  console.log('\n── 단일값 컬럼 (distinct=1, 행 2개 이상) ──');
  for (const t of tableInfos) {
    if (t.rows < 2) continue;
    for (const c of t.columns) {
      if (c.distinct === 1 && c.nulls === 0) console.log(`  ${t.name}.${c.name}`);
    }
  }

  console.log('\n── 프로브 ──');
  for (const [k, v] of Object.entries(probes)) {
    console.log(`  ${String(v).padStart(7)}  ${k}`);
  }

  console.log('\n── 뷰 ──');
  console.log(`  ${views.join(', ') || '없음'}`);

  const jsonPath = argValue('--json');
  if (jsonPath) {
    writeFileSync(
      resolve(process.cwd(), jsonPath),
      JSON.stringify(
        {
          database: host,
          generatedFrom: envFile.split(/[\\/]/).pop(),
          tables: tableInfos,
          views,
          danglingViews,
          indexes,
          integrity,
          fkViolations,
          appliedMigrations: appliedIds,
          probes,
        },
        null,
        2,
      ),
      'utf-8',
    );
    console.log(`\nJSON 저장: ${jsonPath}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
