/**
 * 아침 소식의 저장·캐시·조립. 원천 어댑터(`opendart.ts`·`policy-news.ts`)를 부르고 결과를 DB(#137)에 둔다.
 *
 * 표(#137, `lib/migrations.ts`):
 *  - `briefing_corp_codes` — OpenDART 고유번호 **공용** 캐시(사용자와 묶지 않는다). 하루 한 번 이하로 받는다.
 *  - `briefing_interests` — 사람마다 관심 기업 최대 3개. **탈퇴 파기가 지운다**(`lib/account-deletion.ts`).
 *  - `briefing_items` — 받아 둔 공시·정책뉴스(공용). 30일 지나면 크론이 지운다.
 *  - `briefing_fetch_state` — 원천·기업마다 마지막 성공/시도, 요청 한도 대기, 고유번호 받기 잠금.
 *
 * 캐시 규칙(`docs/spec/morning-briefing.md` §4):
 *  - 기업 하나·정책뉴스는 **15분** 안에 성공했으면 다시 묻지 않는다. 같은 기업을 고른 사람끼리 나눠 쓴다.
 *  - 다시 물어 실패하면 **전에 받아 둔 것**을 그때의 시각과 함께 `stale` 로 보여 준다. 성공한 적 없으면 `unavailable`.
 *  - ⚠ "새 공시 없음" 은 그 회차의 질의가 **실제로 성공했을 때만** 말할 수 있다 — 실패를 빈 목록으로 바꾸지 않는다.
 */
import type { Client, InStatement, InValue } from '@libsql/client';
import type {
  BriefingCompany,
  BriefingDisclosure,
  BriefingDisclosureFlags,
  BriefingPolicyNews,
  BriefingSource,
  BriefingSourceError as BriefingSourceErrorEntry,
  BriefingTodayResponse,
} from '@alarmtalk/shared';
import type { Env } from '../../types';
import { inPlaceholders } from '../caller-ids';
import { logStructured } from '../logger';
import { downloadCorpCodes, fetchDartDisclosures, type DartDisclosure } from './opendart';
import { fetchPolicyNews, type PolicyNewsItem } from './policy-news';
import {
  asBriefingSourceError,
  BRIEFING_RATE_LIMIT_COOLDOWN_SECONDS,
  BriefingSourceError,
  briefingSourceErrorCode,
  briefingSourceErrorKindOf,
  type BriefingSourceErrorKind,
  type FetchLike,
} from './source-error';

/** 원천 하나를 다시 묻지 않는 시간. */
export const BRIEFING_CACHE_TTL_MS = 15 * 60 * 1000;
/** 실패 뒤 같은 원천을 다시 묻기까지 기다리는 시간 — 앱이 연달아 열어도 원천을 두드리지 않게. */
export const BRIEFING_FAILURE_BACKOFF_MS = 60 * 1000;
/** 공시를 찾는 창 — 오늘 포함 7일(한국 날짜). */
export const DART_WINDOW_DAYS = 7;
/** 정책뉴스를 찾는 창 — 오늘 포함 2일. */
export const POLICY_NEWS_WINDOW_DAYS = 2;
/** 응답에 싣는 상한. */
const DISCLOSURE_RESPONSE_MAX = 60;
const POLICY_NEWS_RESPONSE_MAX = 20;
/** 받아 둔 항목을 지우는 나이(발표 날짜 기준). */
export const BRIEFING_ITEM_RETENTION_DAYS = 30;

/** 고유번호 캐시 — 마지막 성공에서 이만큼 지나야 다시 받는다(크론은 하루 한 시간 창에서만 본다). */
export const CORP_CODE_REFRESH_INTERVAL_MS = 20 * 60 * 60 * 1000;
/** 고유번호 받기 잠금. 받기·풀기·쓰기가 이 안에 끝난다. 워커가 죽어도 이 뒤에는 풀린다. */
export const CORP_CODE_LOCK_MS = 10 * 60 * 1000;
/** 고유번호 받기가 실패하면 이만큼 기다린다. */
export const CORP_CODE_FAILURE_BACKOFF_MS = 10 * 60 * 1000;
/**
 * 상장사 행이 이보다 적으면 원천이 잘린 파일을 준 것으로 보고 **아무것도 바꾸지 않는다** — 그대로 쓰면 아래의 '이번에
 * 안 보인 행 지우기' 가 캐시를 통째로 비운다. 상장사는 2026년 기준 약 2,700곳(코스피·코스닥·코넥스)이다.
 */
export const CORP_CODE_MIN_LISTED_ROWS = 1000;
/** 상장사 행 상한 — 이상하게 많으면 파일이 틀린 것이다. */
const CORP_CODE_MAX_LISTED_ROWS = 20_000;
/** 크론이 고유번호를 보는 한국 시각(시). 이 한 시간의 5분 틱만 DB 를 부른다. */
export const CORP_CODE_CRON_KST_HOUR = 6;

const CORP_CODE_SCOPE = 'corpcode';
const POLICY_NEWS_SCOPE = 'policy_news';
const dartScope = (corpCode: string) => `dart:${corpCode}`;
const cooldownScope = (source: BriefingSource) => `cooldown:${source}`;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 날짜(`now` 에서 `offsetDays` 만큼). */
export function kstDate(now: Date, offsetDays = 0): { compact: string; iso: string } {
  const iso = new Date(now.getTime() + KST_OFFSET_MS + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { iso, compact: iso.replaceAll('-', '') };
}

export function opendartApiKey(env: Env): string | null {
  return env.OPENDART_API_KEY?.trim() || null;
}
export function policyNewsApiKey(env: Env): string | null {
  return env.KOREA_POLICY_NEWS_API_KEY?.trim() || null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function logSourceFailure(source: BriefingSource, err: ReturnType<typeof asBriefingSourceError>, corpCode?: string) {
  // 키 오류는 우리가 고칠 것이라 error, 나머지(한도·점검·일시 실패)는 warn. ⚠ URL·키를 싣지 않는다.
  logStructured(err.kind === 'key_invalid' ? 'error' : 'warn', {
    at: 'briefing.source_failed',
    source,
    kind: err.kind,
    detail: err.detail,
    source_status: err.sourceStatus,
    ...(corpCode ? { corp_code: corpCode } : {}),
  });
}

// ── 고유번호 캐시 ────────────────────────────────────────────────────────────────────

/** 고유번호 캐시에 행이 있는가(검색이 비었을 때 '아직 못 받음' 과 '결과 없음' 을 가른다). */
export async function corpCodeCacheIsEmpty(db: Pick<Client, 'execute'>): Promise<boolean> {
  const res = await db.execute('SELECT 1 FROM briefing_corp_codes LIMIT 1');
  return res.rows.length === 0;
}

/**
 * 잠금을 잡는다. 잠금이 비었고(또는 지났고), 마지막 성공이 `dueBefore` 보다 앞이고, 직전 실패의 대기가 지났을 때만.
 * 한 문장(조건부 upsert)이라 둘이 동시에 와도 하나만 잡는다.
 */
async function acquireCorpCodeLock(db: Pick<Client, 'execute'>, now: Date, dueBefore: Date): Promise<boolean> {
  const nowIso = now.toISOString();
  const res = await db.execute({
    sql: `INSERT INTO briefing_fetch_state (scope_key, last_attempt_at, lock_until) VALUES (?, ?, ?)
          ON CONFLICT(scope_key) DO UPDATE SET
            last_attempt_at = excluded.last_attempt_at,
            lock_until = excluded.lock_until
          WHERE (briefing_fetch_state.lock_until IS NULL OR briefing_fetch_state.lock_until < ?)
            AND (briefing_fetch_state.last_success_at IS NULL OR briefing_fetch_state.last_success_at < ?)
            AND (briefing_fetch_state.last_error_code IS NULL OR briefing_fetch_state.last_attempt_at < ?)`,
    args: [
      CORP_CODE_SCOPE,
      nowIso,
      new Date(now.getTime() + CORP_CODE_LOCK_MS).toISOString(),
      nowIso,
      dueBefore.toISOString(),
      new Date(now.getTime() - CORP_CODE_FAILURE_BACKOFF_MS).toISOString(),
    ],
  });
  return res.rowsAffected > 0;
}

export type CorpCodeRefreshResult =
  | { status: 'refreshed'; stored: number; unlisted: number; skipped: number }
  | { status: 'not_configured' | 'not_due' }
  | { status: 'failed'; kind: BriefingSourceErrorKind };

/**
 * 고유번호를 받아 캐시를 바꾼다(잠금 안에서). **상장사만** 담는다 — 이유는 `docs/spec/morning-briefing.md` §2.
 * `dueEvery` 는 마지막 성공에서 지나야 하는 시간(0 이면 잠금·실패 대기만 본다 — 캐시가 빈 경우의 즉시 받기).
 */
export async function refreshCorpCodes(
  db: Client,
  env: Env,
  now: Date,
  options: { fetchImpl?: FetchLike; dueEveryMs?: number; minListedRows?: number } = {},
): Promise<CorpCodeRefreshResult> {
  const apiKey = opendartApiKey(env);
  if (!apiKey) return { status: 'not_configured' };
  const dueBefore = new Date(now.getTime() - (options.dueEveryMs ?? CORP_CODE_REFRESH_INTERVAL_MS));
  if (!(await acquireCorpCodeLock(db, now, dueBefore))) return { status: 'not_due' };

  const stamp = now.toISOString();
  try {
    const { rows, skipped } = await downloadCorpCodes(apiKey, options.fetchImpl);
    const listed = rows.filter((row) => row.stock_code !== null);
    const minRows = options.minListedRows ?? CORP_CODE_MIN_LISTED_ROWS;
    if (listed.length < minRows || listed.length > CORP_CODE_MAX_LISTED_ROWS) {
      throw new BriefingSourceError('failed', 'row_count', String(listed.length));
    }
    const stmts: InStatement[] = [];
    // 한 문장 100행 × 5값 = 500 바인딩. 전부 **한 batch**(한 왕복, 한 트랜잭션)로 보낸다 — 반쯤 바뀐 캐시가 남지 않는다.
    for (const part of chunk(listed, 100)) {
      stmts.push({
        sql: `INSERT INTO briefing_corp_codes (corp_code, corp_name, stock_code, modify_date, refreshed_at)
              VALUES ${part.map(() => '(?, ?, ?, ?, ?)').join(', ')}
              ON CONFLICT(corp_code) DO UPDATE SET
                corp_name = excluded.corp_name,
                stock_code = excluded.stock_code,
                modify_date = excluded.modify_date,
                refreshed_at = excluded.refreshed_at`,
        args: part.flatMap((row) => [row.corp_code, row.corp_name, row.stock_code, row.modify_date, stamp]),
      });
    }
    // 이번 파일에 없는 기업(상장 폐지 등)은 지운다. 관심 목록의 행은 남는다(이름이 null 로 보인다).
    stmts.push({ sql: 'DELETE FROM briefing_corp_codes WHERE refreshed_at <> ?', args: [stamp] });
    stmts.push({
      sql: `UPDATE briefing_fetch_state SET last_success_at = ?, last_error_code = NULL, lock_until = NULL
            WHERE scope_key = ?`,
      args: [stamp, CORP_CODE_SCOPE],
    });
    await db.batch(stmts, 'write');
    logStructured('info', {
      at: 'briefing.corp_codes_refreshed',
      stored: listed.length,
      unlisted: rows.length - listed.length,
      skipped,
    });
    return { status: 'refreshed', stored: listed.length, unlisted: rows.length - listed.length, skipped };
  } catch (err) {
    const failure = asBriefingSourceError(err);
    logSourceFailure('opendart', failure);
    await db.execute({
      sql: `UPDATE briefing_fetch_state SET last_error_code = ?, lock_until = NULL WHERE scope_key = ?`,
      args: [briefingSourceErrorCode(failure.kind), CORP_CODE_SCOPE],
    });
    return { status: 'failed', kind: failure.kind };
  }
}

/**
 * 크론의 5분 틱에서 부른다. 한국 시각 06시대에만 DB 를 부르고, 마지막 성공에서 20시간이 지났을 때만 받는다.
 * 같은 시간의 첫 틱(분 < 5)에 오래된 항목도 지운다.
 */
export async function runBriefingCron(db: Client, env: Env, now: Date): Promise<CorpCodeRefreshResult | null> {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  if (kst.getUTCHours() !== CORP_CODE_CRON_KST_HOUR) return null;
  if (kst.getUTCMinutes() < 5) await pruneBriefingCache(db, now);
  if (!opendartApiKey(env)) return null;
  return refreshCorpCodes(db, env, now);
}

/** 30일 지난 항목, 7일 동안 시도도 없던 기업별 상태(관심에서 빠진 기업)를 지운다. */
export async function pruneBriefingCache(db: Client, now: Date): Promise<void> {
  await db.batch(
    [
      {
        sql: 'DELETE FROM briefing_items WHERE published_date < ?',
        args: [kstDate(now, -BRIEFING_ITEM_RETENTION_DAYS).iso],
      },
      {
        sql: `DELETE FROM briefing_fetch_state WHERE scope_key LIKE 'dart:%' AND last_attempt_at < ?`,
        args: [new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()],
      },
    ],
    'write',
  );
}

/** `LIKE` 의 와일드카드(`%`·`_`)와 이스케이프 문자(`\`)를 글자로. 절은 `ESCAPE '\'` 와 짝이다. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** 기업명(포함) 또는 종목코드(정확히)로 찾는다. 정확히 같은 이름 → 앞이 같은 이름 → 짧은 이름 순. */
export async function searchCorpCodes(
  db: Pick<Client, 'execute'>,
  query: string,
  limit: number,
): Promise<BriefingCompany[]> {
  const escaped = escapeLike(query);
  const res = await db.execute({
    sql: `SELECT corp_code, corp_name, stock_code FROM briefing_corp_codes
          WHERE corp_name LIKE ? ESCAPE '\\' OR stock_code = ?
          ORDER BY CASE WHEN corp_name = ? THEN 0 WHEN corp_name LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
                   length(corp_name), corp_name
          LIMIT ?`,
    args: [`%${escaped}%`, query.toUpperCase(), query, `${escaped}%`, limit],
  });
  return res.rows.map((row) => ({
    corp_code: String(row.corp_code),
    corp_name: String(row.corp_name),
    stock_code: row.stock_code === null ? null : String(row.stock_code),
  }));
}

// ── 관심 기업 ────────────────────────────────────────────────────────────────────────

export type InterestRow = {
  corp_code: string;
  corp_name: string | null;
  stock_code: string | null;
  created_at: string;
};

/** 그 사람의 관심 기업. ⚠ `userId` 는 인증이 정한 값만 넘긴다 — 남의 목록을 읽는 길이 없다. */
export async function listInterests(db: Pick<Client, 'execute'>, userId: string): Promise<InterestRow[]> {
  const res = await db.execute({
    sql: `SELECT i.corp_code, i.created_at, c.corp_name, c.stock_code
          FROM briefing_interests i
          LEFT JOIN briefing_corp_codes c ON c.corp_code = i.corp_code
          WHERE i.user_id = ?
          ORDER BY i.created_at, i.corp_code
          LIMIT 3`,
    args: [userId],
  });
  return res.rows.map((row) => ({
    corp_code: String(row.corp_code),
    corp_name: row.corp_name === null ? null : String(row.corp_name),
    stock_code: row.stock_code === null ? null : String(row.stock_code),
    created_at: String(row.created_at),
  }));
}

/**
 * 관심 목록을 통째로 바꾼다. 고른 기업은 전부 고유번호 캐시에 있어야 한다(없으면 `missing`).
 * 지우기·넣기가 한 batch(한 트랜잭션)라 동시에 두 번 바꿔도 결과는 어느 한쪽 목록이다 — 3개를 넘지 않는다.
 * 이미 있던 기업의 `created_at` 은 그대로 둔다.
 */
export async function replaceInterests(
  db: Client,
  userId: string,
  corpCodes: readonly string[],
  now: Date,
): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  if (corpCodes.length > 0) {
    const found = await db.execute({
      sql: `SELECT corp_code FROM briefing_corp_codes WHERE corp_code IN (${inPlaceholders(corpCodes)})`,
      args: [...corpCodes],
    });
    const have = new Set(found.rows.map((row) => String(row.corp_code)));
    const missing = corpCodes.filter((code) => !have.has(code));
    if (missing.length > 0) return { ok: false, missing };
  }
  const stmts: InStatement[] = [
    corpCodes.length > 0
      ? {
          sql: `DELETE FROM briefing_interests WHERE user_id = ? AND corp_code NOT IN (${inPlaceholders(corpCodes)})`,
          args: [userId, ...corpCodes],
        }
      : { sql: 'DELETE FROM briefing_interests WHERE user_id = ?', args: [userId] },
  ];
  if (corpCodes.length > 0) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO briefing_interests (user_id, corp_code, created_at)
            VALUES ${corpCodes.map(() => '(?, ?, ?)').join(', ')}`,
      args: corpCodes.flatMap((code) => [userId, code, now.toISOString()]),
    });
  }
  await db.batch(stmts, 'write');
  return { ok: true };
}

// ── 오늘의 소식 ──────────────────────────────────────────────────────────────────────

type FetchState = {
  scope_key: string;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_error_code: string | null;
  window_end: string | null;
  complete: number;
  retry_after: string | null;
};

async function loadStates(db: Pick<Client, 'execute'>, keys: string[]): Promise<Map<string, FetchState>> {
  const res = await db.execute({
    sql: `SELECT scope_key, last_success_at, last_attempt_at, last_error_code, window_end, complete, retry_after
          FROM briefing_fetch_state WHERE scope_key IN (${inPlaceholders(keys)})`,
    args: keys,
  });
  const out = new Map<string, FetchState>();
  for (const row of res.rows) {
    out.set(String(row.scope_key), {
      scope_key: String(row.scope_key),
      last_success_at: row.last_success_at === null ? null : String(row.last_success_at),
      last_attempt_at: row.last_attempt_at === null ? null : String(row.last_attempt_at),
      last_error_code: row.last_error_code === null ? null : String(row.last_error_code),
      window_end: row.window_end === null ? null : String(row.window_end),
      complete: Number(row.complete ?? 0),
      retry_after: row.retry_after === null ? null : String(row.retry_after),
    });
  }
  return out;
}

function isFresh(state: FetchState | undefined, todayCompact: string, now: Date): boolean {
  if (!state?.last_success_at || state.window_end !== todayCompact) return false;
  return now.getTime() - Date.parse(state.last_success_at) < BRIEFING_CACHE_TTL_MS;
}

function inFailureBackoff(state: FetchState | undefined, now: Date): boolean {
  if (!state?.last_error_code || !state.last_attempt_at) return false;
  return now.getTime() - Date.parse(state.last_attempt_at) < BRIEFING_FAILURE_BACKOFF_MS;
}

function cooldownSeconds(state: FetchState | undefined, now: Date): number | null {
  if (!state?.retry_after) return null;
  const left = Math.ceil((Date.parse(state.retry_after) - now.getTime()) / 1000);
  return left > 0 ? left : null;
}

/** 이번 회차에 원천 하나(또는 기업 하나)가 어떻게 끝났나. */
type PartOutcome =
  | { kind: 'fresh'; fetchedAt: string; complete: boolean }
  | { kind: 'failed'; error: BriefingSourceErrorKind; lastSuccessAt: string | null; retryAfterSeconds: number | null };

type ItemRow = {
  source_kind: BriefingSource;
  source_id: string;
  corp_code: string | null;
  title: string;
  org_name: string | null;
  summary: string;
  remarks: string;
  flags_json: string;
  published_date: string;
  published_at: string | null;
  source_url: string;
};

async function itemStatements(rows: ItemRow[], fetchedAt: string): Promise<InStatement[]> {
  const withHash = await Promise.all(
    rows.map(async (row) => ({
      row,
      hash: await sha256Hex(
        JSON.stringify([
          row.title,
          row.org_name,
          row.summary,
          row.remarks,
          row.flags_json,
          row.published_date,
          row.published_at,
          row.source_url,
          row.corp_code,
        ]),
      ),
    })),
  );
  // 한 문장 20행 × 13값 = 260 바인딩. 내용이 같으면(해시) 쓰지 않는다 — 15분마다 같은 행을 다시 쓰지 않게.
  return chunk(withHash, 20).map((part) => ({
    sql: `INSERT INTO briefing_items (source_kind, source_id, corp_code, title, org_name, summary, remarks, flags_json,
            published_date, published_at, source_url, content_hash, fetched_at)
          VALUES ${part.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
          ON CONFLICT(source_kind, source_id) DO UPDATE SET
            corp_code = excluded.corp_code,
            title = excluded.title,
            org_name = excluded.org_name,
            summary = excluded.summary,
            remarks = excluded.remarks,
            flags_json = excluded.flags_json,
            published_date = excluded.published_date,
            published_at = excluded.published_at,
            source_url = excluded.source_url,
            content_hash = excluded.content_hash,
            fetched_at = excluded.fetched_at
          WHERE briefing_items.content_hash <> excluded.content_hash`,
    args: part.flatMap(({ row, hash }): InValue[] => [
      row.source_kind,
      row.source_id,
      row.corp_code,
      row.title,
      row.org_name,
      row.summary,
      row.remarks,
      row.flags_json,
      row.published_date,
      row.published_at,
      row.source_url,
      hash,
      fetchedAt,
    ]),
  }));
}

function dartItemRow(item: DartDisclosure): ItemRow {
  return {
    source_kind: 'opendart',
    source_id: item.rceptNo,
    corp_code: item.corpCode,
    title: item.reportName,
    org_name: item.corpName,
    summary: '',
    remarks: item.remarks,
    flags_json: JSON.stringify(item.flags),
    published_date: item.receiptDate,
    published_at: null,
    source_url: item.url,
  };
}

function policyItemRow(item: PolicyNewsItem): ItemRow {
  return {
    source_kind: 'policy_news',
    source_id: item.id,
    corp_code: null,
    title: item.title,
    org_name: item.organization,
    summary: item.summary,
    remarks: '',
    flags_json: '{}',
    published_date: item.publishedDate,
    published_at: item.publishedAt,
    source_url: item.url,
  };
}

function successStateStatement(scope: string, nowIso: string, todayCompact: string, complete: boolean): InStatement {
  return {
    sql: `INSERT INTO briefing_fetch_state (scope_key, last_success_at, last_attempt_at, last_error_code, window_end, complete)
          VALUES (?, ?, ?, NULL, ?, ?)
          ON CONFLICT(scope_key) DO UPDATE SET
            last_success_at = excluded.last_success_at,
            last_attempt_at = excluded.last_attempt_at,
            last_error_code = NULL,
            window_end = excluded.window_end,
            complete = excluded.complete`,
    args: [scope, nowIso, nowIso, todayCompact, complete ? 1 : 0],
  };
}

function failureStateStatement(scope: string, nowIso: string, kind: BriefingSourceErrorKind): InStatement {
  // ⚠ 마지막 성공(`last_success_at`·`window_end`)은 건드리지 않는다 — 그때 받은 것을 그 시각과 함께 보여 줘야 한다.
  return {
    sql: `INSERT INTO briefing_fetch_state (scope_key, last_attempt_at, last_error_code) VALUES (?, ?, ?)
          ON CONFLICT(scope_key) DO UPDATE SET
            last_attempt_at = excluded.last_attempt_at,
            last_error_code = excluded.last_error_code`,
    args: [scope, nowIso, briefingSourceErrorCode(kind)],
  };
}

function cooldownStatement(source: BriefingSource, now: Date): InStatement {
  return {
    sql: `INSERT INTO briefing_fetch_state (scope_key, retry_after) VALUES (?, ?)
          ON CONFLICT(scope_key) DO UPDATE SET retry_after = excluded.retry_after`,
    args: [cooldownScope(source), new Date(now.getTime() + BRIEFING_RATE_LIMIT_COOLDOWN_SECONDS * 1000).toISOString()],
  };
}

function parseFlags(json: string): BriefingDisclosureFlags {
  const empty: BriefingDisclosureFlags = {
    amended_report: false,
    corrected_later: false,
    withdrawn: false,
    consolidated: false,
    ftc: false,
    market: null,
  };
  try {
    return { ...empty, ...(JSON.parse(json) as Partial<BriefingDisclosureFlags>) };
  } catch {
    return empty;
  }
}

export type BriefingTodayResult = { body: BriefingTodayResponse; retryAfterSeconds: number | null };

/**
 * `GET /briefing/today` 의 몸통. 관심 기업마다(최대 3)·정책뉴스 하나를 캐시에서 보거나 다시 묻고, 받아 둔 것을 조립한다.
 * 한 요청의 바깥 호출: 원천 최대 4(+공시 페이지), DB 왕복 4~5(관심·상태·쓰기 batch·공시·정책뉴스).
 */
export async function buildBriefingToday(
  db: Client,
  env: Env,
  userId: string,
  now: Date,
  options: { fetchImpl?: FetchLike } = {},
): Promise<BriefingTodayResult> {
  const nowIso = now.toISOString();
  const today = kstDate(now);
  const dartFrom = kstDate(now, -(DART_WINDOW_DAYS - 1));
  const policyFrom = kstDate(now, -(POLICY_NEWS_WINDOW_DAYS - 1));
  const dartKey = opendartApiKey(env);
  const policyKey = policyNewsApiKey(env);

  const interests = await listInterests(db, userId);
  const corpCodes = interests.map((interest) => interest.corp_code);
  const states = await loadStates(db, [
    POLICY_NEWS_SCOPE,
    cooldownScope('opendart'),
    cooldownScope('policy_news'),
    ...corpCodes.map(dartScope),
  ]);
  const dartCooldown = cooldownSeconds(states.get(cooldownScope('opendart')), now);
  const policyCooldown = cooldownSeconds(states.get(cooldownScope('policy_news')), now);

  const writes: InStatement[] = [];
  let dartRateLimitedNow = false;
  let policyRateLimitedNow = false;

  /** 다시 묻지 않고 끝나는 경우(신선함·대기·키 없음)를 먼저 가른다. 물어야 하면 null. */
  const settledWithoutFetch = (
    state: FetchState | undefined,
    key: string | null,
    cooldown: number | null,
  ): PartOutcome | null => {
    if (isFresh(state, today.compact, now)) {
      return { kind: 'fresh', fetchedAt: state!.last_success_at!, complete: state!.complete === 1 };
    }
    const lastSuccessAt = state?.last_success_at ?? null;
    if (!key) return { kind: 'failed', error: 'not_configured', lastSuccessAt, retryAfterSeconds: null };
    if (cooldown !== null) return { kind: 'failed', error: 'rate_limited', lastSuccessAt, retryAfterSeconds: cooldown };
    if (inFailureBackoff(state, now)) {
      return {
        kind: 'failed',
        error: briefingSourceErrorKindOf(state!.last_error_code),
        lastSuccessAt,
        retryAfterSeconds: null,
      };
    }
    return null;
  };

  const dartParts = corpCodes.map(async (corpCode): Promise<[string, PartOutcome]> => {
    const scope = dartScope(corpCode);
    const state = states.get(scope);
    const settled = settledWithoutFetch(state, dartKey, dartCooldown);
    if (settled) return [corpCode, settled];
    try {
      const result = await fetchDartDisclosures({
        apiKey: dartKey!,
        corpCode,
        bgnDe: dartFrom.compact,
        endDe: today.compact,
        fetchImpl: options.fetchImpl,
      });
      writes.push(...(await itemStatements(result.items.map(dartItemRow), nowIso)));
      if (result.complete) {
        // 창 안에서 이번에 안 보인 공시는 지운다 — 원천에서 사라진 것을 계속 보여 주지 않는다.
        const ids = result.items.map((item) => item.rceptNo);
        writes.push({
          sql: `DELETE FROM briefing_items
                WHERE source_kind = 'opendart' AND corp_code = ? AND published_date >= ? AND published_date <= ?
                ${ids.length > 0 ? `AND source_id NOT IN (${inPlaceholders(ids)})` : ''}`,
          args: [corpCode, dartFrom.iso, today.iso, ...ids],
        });
      }
      writes.push(successStateStatement(scope, nowIso, today.compact, result.complete));
      return [corpCode, { kind: 'fresh', fetchedAt: nowIso, complete: result.complete }];
    } catch (err) {
      const failure = asBriefingSourceError(err);
      logSourceFailure('opendart', failure, corpCode);
      writes.push(failureStateStatement(scope, nowIso, failure.kind));
      if (failure.kind === 'rate_limited') dartRateLimitedNow = true;
      return [
        corpCode,
        {
          kind: 'failed',
          error: failure.kind,
          lastSuccessAt: state?.last_success_at ?? null,
          retryAfterSeconds: failure.kind === 'rate_limited' ? BRIEFING_RATE_LIMIT_COOLDOWN_SECONDS : null,
        },
      ];
    }
  });

  const policyPart = (async (): Promise<PartOutcome> => {
    const state = states.get(POLICY_NEWS_SCOPE);
    const settled = settledWithoutFetch(state, policyKey, policyCooldown);
    if (settled) return settled;
    try {
      const result = await fetchPolicyNews({
        serviceKey: policyKey!,
        startDate: policyFrom.compact,
        endDate: today.compact,
        fetchImpl: options.fetchImpl,
      });
      writes.push(...(await itemStatements(result.items.map(policyItemRow), nowIso)));
      if (result.deletedIds.length > 0) {
        writes.push({
          sql: `DELETE FROM briefing_items WHERE source_kind = 'policy_news' AND source_id IN (${inPlaceholders(result.deletedIds)})`,
          args: result.deletedIds,
        });
      }
      writes.push(successStateStatement(POLICY_NEWS_SCOPE, nowIso, today.compact, true));
      return { kind: 'fresh', fetchedAt: nowIso, complete: true };
    } catch (err) {
      const failure = asBriefingSourceError(err);
      logSourceFailure('policy_news', failure);
      writes.push(failureStateStatement(POLICY_NEWS_SCOPE, nowIso, failure.kind));
      if (failure.kind === 'rate_limited') policyRateLimitedNow = true;
      return {
        kind: 'failed',
        error: failure.kind,
        lastSuccessAt: state?.last_success_at ?? null,
        retryAfterSeconds: failure.kind === 'rate_limited' ? BRIEFING_RATE_LIMIT_COOLDOWN_SECONDS : null,
      };
    }
  })();

  const dartOutcomes = new Map(await Promise.all(dartParts));
  const policyOutcome = await policyPart;
  if (dartRateLimitedNow) writes.push(cooldownStatement('opendart', now));
  if (policyRateLimitedNow) writes.push(cooldownStatement('policy_news', now));
  // ⚠ 쓰기를 읽기보다 먼저 — 방금 받은 것을 아래 조회가 읽는다. 한 batch(한 왕복)다.
  if (writes.length > 0) await db.batch(writes, 'write');

  const disclosures: BriefingDisclosure[] =
    corpCodes.length === 0
      ? []
      : (
          await db.execute({
            sql: `SELECT source_id, corp_code, title, org_name, remarks, flags_json, published_date, source_url, fetched_at
                  FROM briefing_items
                  WHERE source_kind = 'opendart' AND corp_code IN (${inPlaceholders(corpCodes)})
                    AND published_date >= ? AND published_date <= ?
                  ORDER BY published_date DESC, source_id DESC
                  LIMIT ?`,
            args: [...corpCodes, dartFrom.iso, today.iso, DISCLOSURE_RESPONSE_MAX],
          })
        ).rows.map((row) => ({
          source: 'opendart' as const,
          id: String(row.source_id),
          corp_code: String(row.corp_code),
          corp_name: String(row.org_name ?? ''),
          report_name: String(row.title),
          receipt_date: String(row.published_date),
          remarks: String(row.remarks ?? ''),
          flags: parseFlags(String(row.flags_json ?? '{}')),
          url: String(row.source_url),
          fetched_at: String(row.fetched_at),
        }));

  const policyNews: BriefingPolicyNews[] = (
    await db.execute({
      sql: `SELECT source_id, title, org_name, summary, published_date, published_at, source_url, fetched_at
            FROM briefing_items
            WHERE source_kind = 'policy_news' AND published_date >= ? AND published_date <= ?
            ORDER BY published_date DESC, COALESCE(published_at, '') DESC, source_id DESC
            LIMIT ?`,
      args: [policyFrom.iso, today.iso, POLICY_NEWS_RESPONSE_MAX],
    })
  ).rows.map((row) => ({
    source: 'policy_news' as const,
    id: String(row.source_id),
    title: String(row.title),
    summary: String(row.summary ?? ''),
    organization: row.org_name === null ? null : String(row.org_name),
    published_date: String(row.published_date),
    published_at: row.published_at === null ? null : String(row.published_at),
    url: String(row.source_url),
    fetched_at: String(row.fetched_at),
  }));

  // ── 조립 ──
  const errors: BriefingSourceErrorEntry[] = [];
  const fetchedTimes: string[] = [];
  let stale = false;
  let complete = true;
  let retryAfterSeconds: number | null = null;
  const account = (outcome: PartOutcome, source: BriefingSource, corpCode?: string): 'ok' | 'stale' | 'unavailable' => {
    if (outcome.kind === 'fresh') {
      fetchedTimes.push(outcome.fetchedAt);
      if (!outcome.complete) complete = false;
      return 'ok';
    }
    complete = false;
    errors.push({
      source,
      code: briefingSourceErrorCode(outcome.error),
      ...(corpCode ? { corp_code: corpCode } : {}),
      ...(outcome.retryAfterSeconds ? { retry_after_seconds: outcome.retryAfterSeconds } : {}),
    });
    if (outcome.retryAfterSeconds) retryAfterSeconds = Math.max(retryAfterSeconds ?? 0, outcome.retryAfterSeconds);
    if (outcome.lastSuccessAt) {
      stale = true;
      fetchedTimes.push(outcome.lastSuccessAt);
      return 'stale';
    }
    return 'unavailable';
  };

  const companies = interests.map((interest) => {
    const outcome = dartOutcomes.get(interest.corp_code)!;
    const status = account(outcome, 'opendart', interest.corp_code);
    return {
      corp_code: interest.corp_code,
      corp_name: interest.corp_name,
      status,
      fetched_at: outcome.kind === 'fresh' ? outcome.fetchedAt : outcome.lastSuccessAt,
    };
  });
  account(policyOutcome, 'policy_news');

  fetchedTimes.sort();
  return {
    body: {
      window: { from: dartFrom.iso, to: today.iso },
      companies,
      disclosures,
      policy_news: policyNews,
      fetched_at: fetchedTimes[0] ?? null,
      stale,
      complete,
      errors,
    },
    retryAfterSeconds,
  };
}
