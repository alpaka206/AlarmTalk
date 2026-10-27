/**
 * 관리자 콘솔 **사용 지표**(`/admin/usage`) 숫자 — `docs/spec/admin-console.md` 「사용 지표」, 지시서 10.4.
 *
 * 모두 `usage_events` 2판(#142) 칸에서 센다. 한 화면의 숫자는 한 번의 묶음 읽기로 가져온다(개요와 같다).
 *
 * ⚠ 숫자의 뜻을 넓히지 말 것:
 * - **가입 전은 없다.** 기록은 로그인·동의 뒤에만 쌓인다(`usage-events.md` §7.4) — 퍼널의 첫 칸은 '앱을 처음 연 사람' 이
 *   아니라 '동의한 계정 중 그 단계를 한 사람' 이다.
 * - **iOS 의 울림은 아래로 치우친다.** 아무도 안 누른 울림은 우리 코드가 돌지 않아 적히지 않는다(§2) — '관측한 울림' 이지
 *   울림 수가 아니고, 관측이 없다고 0회로 단정하지 않는다.
 * - **해제는 기상 성공이 아니다.** 화면을 벗어나 꺼진 해제(`screen_off`·`left_screen`)도 해제다.
 * - **준비 시작 → 알람 저장의 차이는 다운로드 대기시간이 아니다** — 사이에 사용자 입력이 섞인다. 준비시간은 작업 소유자가
 *   단조 시계로 잰 `duration_ms` 만 쓴다.
 * - **미완료 시작은 실패가 아니다.** 앱을 다시 켜면 새 시도다 — 따로 센다.
 */
import { ENTITLEMENT_SOURCES, type EntitlementSource } from '@alarmtalk/shared';
import type { Client } from '@libsql/client/web';
import { parseRange, type RangeDays } from './metrics';

export interface UsageFilter {
  range: RangeDays;
  platform: 'android' | 'ios' | null;
  /** 앱 버전(적는 순간의 값) 정확히 일치. */
  appVersion: string | null;
  source: EntitlementSource | null;
}

export function parseUsageFilter(query: (key: string) => string | undefined): UsageFilter {
  const platform = query('platform');
  const version = (query('version') ?? '').trim();
  const source = query('source');
  return {
    range: parseRange(query('range')),
    platform: platform === 'android' || platform === 'ios' ? platform : null,
    appVersion: /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/.test(version) ? version : null,
    source: (ENTITLEMENT_SOURCES as readonly string[]).includes(source ?? '') ? (source as EntitlementSource) : null,
  };
}

/** 거르기 조각 — 고정 SQL 과 값 배열. `alias` 는 개발자 고정 별칭만 넣는다. */
export function filterSql(f: UsageFilter, alias = 'e'): { sql: string; args: (string | number)[] } {
  const parts = [`julianday(${alias}.occurred_at) >= julianday('now') - ?`];
  const args: (string | number)[] = [f.range];
  if (f.platform) {
    parts.push(`${alias}.platform = ?`);
    args.push(f.platform);
  }
  if (f.appVersion) {
    parts.push(`${alias}.app_version = ?`);
    args.push(f.appVersion);
  }
  if (f.source) {
    parts.push(`${alias}.entitlement_source = ?`);
    args.push(f.source);
  }
  return { sql: parts.join(' AND '), args };
}

export interface Percentiles {
  count: number;
  p50: number | null;
  p90: number | null;
}

/** 정렬된 값의 백분위(최근접 순위). 값이 없으면 null. */
export function percentiles(sorted: number[]): Percentiles {
  if (sorted.length === 0) return { count: 0, p50: null, p90: null };
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
  return { count: sorted.length, p50: at(0.5), p90: at(0.9) };
}

export interface FunnelStep {
  key: string;
  label: string;
  users: number;
  /** 앞 단계도 한 사람 중 이 단계까지 온 사람. 첫 단계는 null. */
  fromPrevious: number | null;
  previousUsers: number | null;
}

export interface PreparationRow {
  scope: string;
  started: number;
  ready: number;
  failed: number;
  avgBytes: number | null;
  duration: Percentiles;
}

export interface UsageMetrics {
  generatedAt: string;
  filter: UsageFilter;
  versions: Array<{ platform: string; version: string; events: number }>;
  funnel: FunnelStep[];
  auth: Array<{ method: string; outcome: string; count: number }>;
  preparation: PreparationRow[];
  preparationFailures: Array<{ code: string; count: number }>;
  preparationCache: Array<{ scope: string; cache: string; count: number }>;
  preparationUnfinished: number;
  save: { attempts: number; blocked: number; ready: number };
  saveBlockReasons: Array<{ reason: string; count: number }>;
  manual: {
    created: number;
    failed: number;
    reusedLocal: number;
    reusedServer: number;
    avgChars: number | null;
    charged: Array<{ source: string; count: number }>;
    rewardSpent: number;
  };
  ads: {
    offered: number;
    viewStarted: number;
    pending: number;
    granted: number;
    spent: number;
    grantDelay: Percentiles;
    /** 대기로 적힌 지 30분이 지났는데 지급이 없는 시도. */
    missing: number;
  };
  billing: {
    paywallViews: Array<{ surface: string; count: number; users: number }>;
    purchases: Array<{ offer: string; outcome: string; count: number; users: number }>;
    changes: Array<{ from: string; to: string; count: number }>;
  };
  /** 기간 안의 마지막 기록에 찍힌 권한 출처 — 사람마다 하나라 겹쳐 세지 않는다. */
  usersBySource: Array<{ source: string; users: number }>;
  alarms: Array<{ platform: string; type: string; count: number }>;
}

const FUNNEL: Array<{ key: string; label: string; col: string }> = [
  { key: 'sample_started', label: '샘플 재생 시작', col: 'a' },
  { key: 'sample_completed', label: '샘플 끝까지 들음', col: 'b' },
  { key: 'auth_success', label: '로그인 성공', col: 'l' },
  { key: 'alarm_save_attempt', label: '알람 저장 시도', col: 'c' },
  { key: 'alarm_ready', label: '알람 준비 완료', col: 'd' },
];

const PREP_TYPES = `('voice_preparation_started', 'voice_preparation_ready', 'voice_preparation_failed')`;

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function maybeNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
const str = (value: unknown) => (value == null ? '' : String(value));

export async function loadUsageMetrics(db: Client, f: UsageFilter, nowMs: number = Date.now()): Promise<UsageMetrics> {
  const w = filterSql(f);
  const wp = filterSql(f, 'p');
  const at = (sql: string, extraArgs: (string | number)[] = []) => ({ sql, args: [...w.args, ...extraArgs] });
  const stmts = [
    // 0 버전 목록(거르기 칸) — 기간만 본다
    {
      sql: `SELECT COALESCE(platform, '') AS platform, app_version, COUNT(*) AS n FROM usage_events
            WHERE julianday(occurred_at) >= julianday('now') - ? AND app_version IS NOT NULL
            GROUP BY platform, app_version ORDER BY n DESC LIMIT 30`,
      args: [f.range],
    },
    // 1 퍼널 — 사람마다 단계 표시
    at(`SELECT COALESCE(SUM(a), 0) AS a, COALESCE(SUM(b), 0) AS b, COALESCE(SUM(l), 0) AS l,
               COALESCE(SUM(c), 0) AS c, COALESCE(SUM(d), 0) AS d,
               COALESCE(SUM(a AND b), 0) AS ab, COALESCE(SUM(b AND l), 0) AS bl,
               COALESCE(SUM(l AND c), 0) AS lc, COALESCE(SUM(c AND d), 0) AS cd
        FROM (SELECT e.user_id,
                     MAX(e.type = 'sample_started') AS a, MAX(e.type = 'sample_completed') AS b,
                     MAX(e.type = 'auth_result' AND e.outcome = 'success') AS l,
                     MAX(e.type = 'alarm_save_attempt') AS c, MAX(e.type = 'alarm_ready') AS d
              FROM usage_events e WHERE ${w.sql}
                AND e.type IN ('sample_started', 'sample_completed', 'auth_result', 'alarm_save_attempt', 'alarm_ready')
              GROUP BY e.user_id)`),
    // 2 로그인 결과
    at(`SELECT COALESCE(e.method, '') AS method, COALESCE(e.outcome, '') AS outcome, COUNT(*) AS n
        FROM usage_events e WHERE ${w.sql} AND e.type = 'auth_result' GROUP BY method, outcome ORDER BY n DESC`),
    // 3 준비 — 범위 × 종류
    at(`SELECT COALESCE(e.scope, '') AS scope, e.type, COUNT(*) AS n, AVG(e.bytes) AS avg_bytes
        FROM usage_events e WHERE ${w.sql} AND e.type IN ${PREP_TYPES} GROUP BY scope, e.type`),
    // 4 준비 완료 시간 — 백분위를 **SQL 에서 전체로** 센다(최근접 순위, `percentiles` 와 같은 셈). 예전에는 빠른 순으로 5000행만
    //   가져와 셌다 — 행이 많으면 느린 값이 잘려 p50·p90 이 낮게 나오고 뒤 범위는 통째로 빠졌다(코덱스 #958).
    //   이미 다 있던 시도(warm)는 받을 것이 없어 0 에 가깝다 — 대기시간에서 뺀다.
    at(`SELECT scope, MAX(cnt) AS n,
               MAX(CASE WHEN rn = (cnt + 1) / 2 THEN duration_ms END) AS p50,
               MAX(CASE WHEN rn = (9 * cnt + 9) / 10 THEN duration_ms END) AS p90
        FROM (SELECT COALESCE(e.scope, '') AS scope, e.duration_ms,
                     ROW_NUMBER() OVER (PARTITION BY COALESCE(e.scope, '') ORDER BY e.duration_ms) AS rn,
                     COUNT(*) OVER (PARTITION BY COALESCE(e.scope, '')) AS cnt
              FROM usage_events e
              WHERE ${w.sql} AND e.type = 'voice_preparation_ready' AND e.duration_ms IS NOT NULL
                AND COALESCE(e.cache_state, '') <> 'warm')
        GROUP BY scope`),
    // 5 준비 실패 코드
    at(`SELECT COALESCE(e.error_code, 'unknown') AS code, COUNT(*) AS n FROM usage_events e
        WHERE ${w.sql} AND e.type = 'voice_preparation_failed' GROUP BY code ORDER BY n DESC LIMIT 12`),
    // 6 시작할 때의 캐시
    at(`SELECT COALESCE(e.scope, '') AS scope, COALESCE(e.cache_state, '') AS cache, COUNT(*) AS n FROM usage_events e
        WHERE ${w.sql} AND e.type = 'voice_preparation_started' GROUP BY scope, cache`),
    // 7 미완료 시작(실패로 세지 않는다)
    {
      sql: `SELECT COUNT(*) AS n FROM usage_events p
            WHERE ${wp.sql} AND p.type = 'voice_preparation_started' AND p.attempt_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM usage_events t WHERE t.attempt_id = p.attempt_id AND t.user_id = p.user_id
                              AND t.type IN ('voice_preparation_ready', 'voice_preparation_failed'))`,
      args: wp.args,
    },
    // 8 알람 저장 — 종류 × 사유
    at(`SELECT e.type, COALESCE(e.reason, '') AS reason, COUNT(*) AS n FROM usage_events e
        WHERE ${w.sql} AND e.type IN ('alarm_save_attempt', 'alarm_save_blocked', 'alarm_ready')
        GROUP BY e.type, reason ORDER BY n DESC`),
    // 9 직접 입력
    at(`SELECT e.type, COALESCE(e.outcome, '') AS outcome, COALESCE(e.charged_source, '') AS charged,
               COALESCE(e.reuse_location, '') AS loc, COUNT(*) AS n, AVG(e.char_count) AS avg_chars
        FROM usage_events e WHERE ${w.sql} AND e.type IN ('generation_outcome', 'manual_result_reused', 'reward_spent')
        GROUP BY e.type, outcome, charged, loc`),
    // 10 광고 — 종류별
    at(`SELECT e.type, COUNT(*) AS n FROM usage_events e
        WHERE ${w.sql} AND e.type IN ('reward_offer', 'reward_view_started', 'reward_pending', 'reward_granted', 'reward_spent')
        GROUP BY e.type`),
    // 11 지급 지연 — 지급 기록에 단조 시계로 잰 대기(duration_ms)
    //    백분위는 4 와 같이 SQL 에서 전체로 센다.
    at(`SELECT MAX(cnt) AS n,
               MAX(CASE WHEN rn = (cnt + 1) / 2 THEN duration_ms END) AS p50,
               MAX(CASE WHEN rn = (9 * cnt + 9) / 10 THEN duration_ms END) AS p90
        FROM (SELECT e.duration_ms, ROW_NUMBER() OVER (ORDER BY e.duration_ms) AS rn, COUNT(*) OVER () AS cnt
              FROM usage_events e WHERE ${w.sql} AND e.type = 'reward_granted' AND e.duration_ms IS NOT NULL)`),
    // 12 지급 누락 — 대기 30분이 지났는데 같은 시도의 지급이 없다
    {
      sql: `SELECT COUNT(*) AS n FROM usage_events p
            WHERE ${wp.sql} AND p.type = 'reward_pending' AND p.attempt_id IS NOT NULL
              AND julianday(p.occurred_at) < julianday('now') - (30.0 / 1440)
              AND NOT EXISTS (SELECT 1 FROM usage_events g WHERE g.attempt_id = p.attempt_id AND g.user_id = p.user_id
                              AND g.type = 'reward_granted')`,
      args: wp.args,
    },
    // 13 결제
    at(`SELECT e.type, COALESCE(e.surface, '') AS surface, COALESCE(e.store_offer, '') AS offer,
               COALESCE(e.outcome, '') AS outcome, COALESCE(e.from_plan, '') AS from_plan, COALESCE(e.to_plan, '') AS to_plan,
               COUNT(*) AS n, COUNT(DISTINCT e.user_id) AS users
        FROM usage_events e WHERE ${w.sql} AND e.type IN ('paywall_viewed', 'store_purchase_verified', 'entitlement_changed')
        GROUP BY e.type, surface, offer, outcome, from_plan, to_plan ORDER BY n DESC`),
    // 14 권한 출처별 사람 — 사람마다 기간 안의 마지막 기록(rowid 최대) 하나
    at(`SELECT src, COUNT(*) AS n FROM (
          SELECT e.user_id, e.entitlement_source AS src, MAX(e.rowid) AS last_row FROM usage_events e
          WHERE ${w.sql} AND e.entitlement_source IS NOT NULL GROUP BY e.user_id)
        GROUP BY src ORDER BY n DESC`),
    // 15 관측한 알람 상호작용
    at(`SELECT COALESCE(e.platform, '') AS platform, e.type, COUNT(*) AS n FROM usage_events e
        WHERE ${w.sql} AND e.type IN ('alarm_rang', 'alarm_dismissed', 'alarm_snoozed', 'alarm_updated', 'alarm_deleted')
        GROUP BY platform, e.type`),
  ];
  const r = await db.batch(stmts, 'read');
  const rows = (i: number) => (r[i]?.rows ?? []) as Array<Record<string, unknown>>;
  const row = (i: number) => rows(i)[0] ?? {};

  const fr = row(1);
  const pairs: Record<string, [string, string] | null> = { a: null, b: ['a', 'ab'], l: ['b', 'bl'], c: ['l', 'lc'], d: ['c', 'cd'] };
  const funnel: FunnelStep[] = FUNNEL.map((step) => {
    const pair = pairs[step.col];
    return {
      key: step.key,
      label: step.label,
      users: num(fr[step.col]),
      fromPrevious: pair ? num(fr[pair[1]]) : null,
      previousUsers: pair ? num(fr[pair[0]]) : null,
    };
  });

  const sqlPercentiles = (x: Record<string, unknown> | undefined): Percentiles => {
    const count = x ? num(x.n) : 0;
    if (!x || count === 0) return { count: 0, p50: null, p90: null };
    return { count, p50: x.p50 == null ? null : num(x.p50), p90: x.p90 == null ? null : num(x.p90) };
  };
  const durations = new Map<string, Percentiles>();
  for (const x of rows(4)) durations.set(str(x.scope), sqlPercentiles(x));
  const prep = new Map<string, PreparationRow>();
  for (const x of rows(3)) {
    const scope = str(x.scope);
    const cur = prep.get(scope) ?? {
      scope,
      started: 0,
      ready: 0,
      failed: 0,
      avgBytes: null,
      duration: durations.get(scope) ?? { count: 0, p50: null, p90: null },
    };
    const n = num(x.n);
    if (x.type === 'voice_preparation_started') cur.started = n;
    else if (x.type === 'voice_preparation_ready') {
      cur.ready = n;
      cur.avgBytes = maybeNum(x.avg_bytes);
    } else cur.failed = n;
    prep.set(scope, cur);
  }

  const save = { attempts: 0, blocked: 0, ready: 0 };
  const saveBlockReasons: Array<{ reason: string; count: number }> = [];
  for (const x of rows(8)) {
    const n = num(x.n);
    if (x.type === 'alarm_save_attempt') save.attempts += n;
    else if (x.type === 'alarm_ready') save.ready += n;
    else {
      save.blocked += n;
      saveBlockReasons.push({ reason: str(x.reason) || 'unknown', count: n });
    }
  }

  const manual = {
    created: 0,
    failed: 0,
    reusedLocal: 0,
    reusedServer: 0,
    avgChars: null as number | null,
    charged: [] as Array<{ source: string; count: number }>,
    rewardSpent: 0,
  };
  const charged = new Map<string, number>();
  let charsWeighted = 0;
  let charsCount = 0;
  for (const x of rows(9)) {
    const n = num(x.n);
    if (x.type === 'generation_outcome') {
      if (x.outcome === 'success') {
        manual.created += n;
        const avg = maybeNum(x.avg_chars);
        if (avg !== null) {
          charsWeighted += avg * n;
          charsCount += n;
        }
        const source = str(x.charged) || 'unknown';
        charged.set(source, (charged.get(source) ?? 0) + n);
      } else if (x.outcome === 'failure') manual.failed += n;
    } else if (x.type === 'manual_result_reused') {
      if (x.loc === 'server') {
        manual.reusedServer += n;
        // 서버 재사용도 한 번 센다(2026-10-27) — 서버가 말한 정산 수단을 함께 더한다. 옛 앱·옛 서버의 줄은 칸이 비어 있어
        //   정산에 넣지 않는다(그 시절에는 세지 않았다).
        const source = str(x.charged);
        if (source) charged.set(source, (charged.get(source) ?? 0) + n);
      } else manual.reusedLocal += n;
    } else manual.rewardSpent += n;
  }
  manual.avgChars = charsCount > 0 ? Math.round(charsWeighted / charsCount) : null;
  manual.charged = [...charged.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);

  const adCounts = new Map(rows(10).map((x) => [str(x.type), num(x.n)]));
  const billing: UsageMetrics['billing'] = { paywallViews: [], purchases: [], changes: [] };
  for (const x of rows(13)) {
    const n = num(x.n);
    if (x.type === 'paywall_viewed') billing.paywallViews.push({ surface: str(x.surface) || 'unknown', count: n, users: num(x.users) });
    else if (x.type === 'store_purchase_verified')
      billing.purchases.push({ offer: str(x.offer) || 'unknown', outcome: str(x.outcome) || 'unknown', count: n, users: num(x.users) });
    else billing.changes.push({ from: str(x.from_plan) || '?', to: str(x.to_plan) || '?', count: n });
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    filter: f,
    versions: rows(0).map((x) => ({ platform: str(x.platform), version: str(x.app_version), events: num(x.n) })),
    funnel,
    auth: rows(2).map((x) => ({ method: str(x.method) || 'unknown', outcome: str(x.outcome) || 'unknown', count: num(x.n) })),
    preparation: [...prep.values()].sort((a, b) => a.scope.localeCompare(b.scope)),
    preparationFailures: rows(5).map((x) => ({ code: str(x.code), count: num(x.n) })),
    preparationCache: rows(6).map((x) => ({ scope: str(x.scope), cache: str(x.cache) || 'unknown', count: num(x.n) })),
    preparationUnfinished: num(row(7).n),
    save,
    saveBlockReasons,
    manual,
    ads: {
      offered: adCounts.get('reward_offer') ?? 0,
      viewStarted: adCounts.get('reward_view_started') ?? 0,
      pending: adCounts.get('reward_pending') ?? 0,
      granted: adCounts.get('reward_granted') ?? 0,
      spent: adCounts.get('reward_spent') ?? 0,
      grantDelay: sqlPercentiles(rows(11)[0]),
      missing: num(row(12).n),
    },
    billing,
    usersBySource: rows(14).map((x) => ({ source: str(x.src), users: num(x.n) })),
    alarms: rows(15).map((x) => ({ platform: str(x.platform), type: str(x.type), count: num(x.n) })),
  };
}
