/**
 * 관리자 콘솔 **개요** 숫자 — `docs/spec/admin-console.md` 「개요」.
 *
 * 한 화면의 숫자는 한 번의 묶음 읽기(`db.batch(..., 'read')`)로 가져온다 — 문장마다 워커 하위 요청이 하나씩이라
 * 따로 물으면 화면 하나가 상한의 절반을 쓴다.
 *
 * 시각 칸은 형식이 섞여 있다(`users.created_at` 은 `2026-10-22 01:10:26`, `usage_events.occurred_at` 은
 * `2026-10-23T06:25:01.652Z`). 문자열로 비교하지 말고 `julianday()` 로 비교하고, 날짜는 한국 시각으로 자른다.
 */
import { planWithGrantSql } from '../plan-grant-sql';
import type { Client } from '@libsql/client/web';
import { GENERAL_REQUIRED_CONSENTS, latestConsentsFromRows, missingConsentTypesFrom } from '../consent';

export type RangeDays = 7 | 30 | 90;

export function parseRange(raw: unknown): RangeDays {
  return raw === '7' || raw === 7 ? 7 : raw === '90' || raw === 90 ? 90 : 30;
}

export interface DayPoint {
  /** 한국 날짜 YYYY-MM-DD */
  day: string;
  value: number;
}

export interface Overview {
  generatedAt: string;
  range: RangeDays;
  users: { total: number; today: number; inRange: number; pendingDeletion: number };
  signupsByDay: DayPoint[];
  active: { d1: number; d7: number; d30: number; tracked: number };
  devices: { android: number; ios: number; any: number };
  versions: Array<{ platform: 'android' | 'ios'; version: number; users: number }>;
  /** 알람이 울린 사람 — 사용 기록의 울림·해제·다시 알림(iOS 는 울림 순간을 못 봐 해제·다시 알림만 보인다). `rangD7` 은 안드로이드의 울림 횟수다. */
  rings: { usersD7: number; usersD30: number; rangD7: number };
  alarmThemes: Array<{ theme: string; total: number; active: number }>;
  ringsByDay: DayPoint[];
  eventTotals: Array<{ type: string; count: number }>;
  plus: { users: number; activeSubscriptions: number };
  voices: { custom: number; owners: number };
  consent: { reconsentNeeded: number; marketingAgreed: number; answered: number };
  adRewards: { granted: number; used: number };
  manualTtsUsed: number;
  weather: Array<{ country: string; rows: number; unresolved: number; lastComputedAt: string | null }>;
  recentPushes: Array<{
    id: string;
    kind: string;
    isTest: boolean;
    title: string;
    sent: number;
    failed: number;
    status: string;
    createdAt: string;
  }>;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** 한국 날짜 기준 최근 n 일(오늘 포함)의 빈 칸을 0 으로 채운다 — 막대가 빠진 날이 없게. */
export function fillDays(points: Map<string, number>, days: number, nowMs: number): DayPoint[] {
  const out: DayPoint[] = [];
  const todayKst = new Date(nowMs + 9 * 3600_000);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(todayKst.getUTCFullYear(), todayKst.getUTCMonth(), todayKst.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, value: points.get(key) ?? 0 });
  }
  return out;
}

export function kstMonth(nowMs: number): string {
  return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 7);
}

/**
 * 사람 계정만 — 마이그레이션이 심은 시스템 계정(기본 목소리 보관용, `google_id` 가 `system:` 으로 시작)은
 * 가입자도, 재동의 대상도 아니다. 고정 조각이라 SQL 에 그대로 붙인다.
 */
const HUMAN = (alias = '') => `COALESCE(${alias}google_id, '') NOT LIKE 'system:%'`;

export async function loadOverview(db: Client, range: RangeDays, nowMs: number = Date.now()): Promise<Overview> {
  const month = kstMonth(nowMs);
  const stmts = [
    // 0 가입
    {
      sql: `SELECT COUNT(*) AS total,
                   SUM(date(created_at, '+9 hours') = date('now', '+9 hours')) AS today,
                   SUM(julianday(created_at) >= julianday('now') - ?) AS in_range,
                   SUM(deletion_status = 'pending_deletion') AS pending
            FROM users WHERE ${HUMAN()}`,
      args: [range],
    },
    // 1 날짜별 가입
    {
      sql: `SELECT date(created_at, '+9 hours') AS day, COUNT(*) AS n FROM users
            WHERE ${HUMAN()} AND julianday(created_at) >= julianday('now') - ? GROUP BY day`,
      args: [range + 1],
    },
    // 2 앱 접속(기록이 시작된 뒤만)
    {
      sql: `SELECT COUNT(DISTINCT user_id) AS tracked,
                   COUNT(DISTINCT CASE WHEN julianday(last_seen_at) >= julianday('now') - 1 THEN user_id END) AS d1,
                   COUNT(DISTINCT CASE WHEN julianday(last_seen_at) >= julianday('now') - 7 THEN user_id END) AS d7,
                   COUNT(DISTINCT CASE WHEN julianday(last_seen_at) >= julianday('now') - 30 THEN user_id END) AS d30
            FROM user_app_presence`,
      args: [],
    },
    // 3 알림을 받을 수 있는 기기
    {
      sql: `SELECT COUNT(DISTINCT CASE WHEN pt.platform = 'android' THEN pt.user_id END) AS android,
                   COUNT(DISTINCT CASE WHEN pt.platform = 'ios' THEN pt.user_id END) AS ios,
                   COUNT(DISTINCT pt.user_id) AS any_user
            FROM push_tokens pt JOIN users u ON u.id = pt.user_id
            WHERE COALESCE(u.deletion_status, 'active') = 'active'`,
      args: [],
    },
    // 4 빌드 분포(최근 30일 접속)
    {
      sql: `SELECT platform, app_version, COUNT(*) AS n FROM user_app_presence
            WHERE julianday(last_seen_at) >= julianday('now') - 30
            GROUP BY platform, app_version ORDER BY platform, app_version DESC`,
      args: [],
    },
    // 5 알람이 울린 사람 — ⚠ **켜진 알람 수가 아니다**(2026-10-29 오너: 사람마다 켜 두는 수가 달라 쓰임을 말하지 못한다).
    //   실제로 울린 것을 센다. iOS 는 AlarmKit 이 울려 울림 순간을 못 보므로(`usage-events.md` §2) 해제·다시 알림을 함께 센다.
    {
      sql: `SELECT COUNT(DISTINCT CASE WHEN julianday(occurred_at) >= julianday('now') - 7 THEN user_id END) AS users_d7,
                   COUNT(DISTINCT user_id) AS users_d30,
                   COALESCE(SUM(CASE WHEN type = 'alarm_rang' AND julianday(occurred_at) >= julianday('now') - 7 THEN 1 ELSE 0 END), 0) AS rang_d7
            FROM usage_events
            WHERE type IN ('alarm_rang', 'alarm_dismissed', 'alarm_snoozed')
              AND julianday(occurred_at) >= julianday('now') - 30`,
      args: [],
    },
    // 6 테마
    {
      sql: `SELECT COALESCE(bucket_id, '') AS theme, COUNT(*) AS total, COALESCE(SUM(is_active), 0) AS active
            FROM alarms GROUP BY theme ORDER BY total DESC`,
      args: [],
    },
    // 7 날짜별 울림
    {
      sql: `SELECT date(occurred_at, '+9 hours') AS day, COUNT(*) AS n FROM usage_events
            WHERE type = 'alarm_rang' AND julianday(occurred_at) >= julianday('now') - ? GROUP BY day`,
      args: [range + 1],
    },
    // 8 사용 기록 종류별
    {
      sql: `SELECT type, COUNT(*) AS n FROM usage_events
            WHERE julianday(occurred_at) >= julianday('now') - ? GROUP BY type ORDER BY n DESC`,
      args: [range],
    },
    // 9 플러스
    {
      sql: `SELECT (SELECT COUNT(*) FROM users WHERE plan = 'plus') AS plus_users,
                   (SELECT COUNT(DISTINCT user_id) FROM subscriptions
                     WHERE status = 'active' AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))) AS active_subs`,
      args: [],
    },
    // 10 내 목소리
    {
      sql: `SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS owners FROM voice_profiles
            WHERE COALESCE(is_system, 0) = 0 AND COALESCE(is_draft, 0) = 0 AND deleted_at IS NULL`,
      args: [],
    },
    // 11 동의 — 판정은 lib/consent.ts 로(아래). 동의 행이 하나도 없는 사람도 막히므로 사람 쪽에서 붙인다.
    {
      sql: `SELECT u.id AS user_id, c.consent_type, c.policy_version, c.agreed, c.created_at
            FROM users u LEFT JOIN user_consents c ON c.user_id = u.id
            WHERE COALESCE(u.deletion_status, 'active') = 'active' AND ${HUMAN('u.')}
            ORDER BY u.id, c.created_at DESC, c.rowid DESC`,
      args: [],
    },
    // 12 광고 보상(이번 달)
    {
      sql: `SELECT COUNT(*) AS granted, SUM(consumed_at IS NOT NULL) AS used FROM ad_reward_credits WHERE grant_month = ?`,
      args: [month],
    },
    // 13 직접 입력 생성(이번 달)
    { sql: `SELECT COALESCE(SUM(used_count), 0) AS n FROM manual_tts_usage WHERE usage_month = ?`, args: [month] },
    // 14 날씨 미리 계산 — 오늘 이후 칸
    {
      sql: `SELECT upper(substr(region_key, 1, 2)) AS country, COUNT(*) AS n, SUM(variant_index IS NULL) AS unresolved,
                   MAX(computed_at) AS last_at
            FROM weather_region_daily_official
            WHERE target_date >= date('now', '+9 hours')
            GROUP BY country ORDER BY country`,
      args: [],
    },
    // 15 최근 알림
    {
      sql: `SELECT id, kind, is_test, title, sent, failed, status, created_at FROM admin_push_jobs
            ORDER BY created_at DESC LIMIT 8`,
      args: [],
    },
  ];
  const r = await db.batch(stmts, 'read');
  const row = (i: number) => (r[i]?.rows[0] ?? {}) as Record<string, unknown>;
  const rows = (i: number) => (r[i]?.rows ?? []) as Array<Record<string, unknown>>;

  // 동의 판정
  const byUser = new Map<string, Array<Record<string, unknown>>>();
  for (const consent of rows(11)) {
    const uid = String(consent.user_id);
    const list = byUser.get(uid) ?? [];
    if (consent.consent_type != null) list.push(consent);
    byUser.set(uid, list);
  }
  let reconsentNeeded = 0;
  let marketingAgreed = 0;
  for (const list of byUser.values()) {
    const latest = latestConsentsFromRows(list);
    if (missingConsentTypesFrom(latest, GENERAL_REQUIRED_CONSENTS).length > 0) reconsentNeeded += 1;
    if (missingConsentTypesFrom(latest, ['marketing']).length === 0) marketingAgreed += 1;
  }

  const dayMap = (i: number) => new Map(rows(i).map((x) => [String(x.day), num(x.n)]));

  return {
    generatedAt: new Date(nowMs).toISOString(),
    range,
    users: {
      total: num(row(0).total),
      today: num(row(0).today),
      inRange: num(row(0).in_range),
      pendingDeletion: num(row(0).pending),
    },
    signupsByDay: fillDays(dayMap(1), range, nowMs),
    active: {
      d1: num(row(2).d1),
      d7: num(row(2).d7),
      d30: num(row(2).d30),
      tracked: num(row(2).tracked),
    },
    devices: { android: num(row(3).android), ios: num(row(3).ios), any: num(row(3).any_user) },
    versions: rows(4).map((x) => ({
      platform: x.platform === 'ios' ? 'ios' : 'android',
      version: num(x.app_version),
      users: num(x.n),
    })),
    rings: { usersD7: num(row(5).users_d7), usersD30: num(row(5).users_d30), rangD7: num(row(5).rang_d7) },
    alarmThemes: rows(6).map((x) => ({ theme: String(x.theme ?? ''), total: num(x.total), active: num(x.active) })),
    ringsByDay: fillDays(dayMap(7), range, nowMs),
    eventTotals: rows(8).map((x) => ({ type: String(x.type), count: num(x.n) })),
    plus: { users: num(row(9).plus_users), activeSubscriptions: num(row(9).active_subs) },
    voices: { custom: num(row(10).n), owners: num(row(10).owners) },
    consent: { reconsentNeeded, marketingAgreed, answered: byUser.size },
    adRewards: { granted: num(row(12).granted), used: num(row(12).used) },
    manualTtsUsed: num(row(13).n),
    weather: rows(14).map((x) => ({
      country: String(x.country),
      rows: num(x.n),
      unresolved: num(x.unresolved),
      lastComputedAt: x.last_at == null ? null : String(x.last_at),
    })),
    recentPushes: rows(15).map((x) => ({
      id: String(x.id),
      kind: String(x.kind),
      isTest: num(x.is_test) === 1,
      title: String(x.title),
      sent: num(x.sent),
      failed: num(x.failed),
      status: String(x.status),
      createdAt: String(x.created_at),
    })),
  };
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  plan: string;
  createdAt: string;
  deletionStatus: string;
  android: number | null;
  ios: number | null;
  lastSeenAt: string | null;
  devices: number;
  /** 최근 30일 울림·해제·다시 알림 기록 수(켜진 알람 수 대신 — 위 `rings`). */
  recentRings: number;
  reconsentNeeded: boolean;
}

/** 사용자 찾기 — 이메일·이름 일부 또는 계정 id. 비어 있으면 최근 가입 순. 최대 50명. */
export async function searchUsers(db: Client, query: string): Promise<UserRow[]> {
  const q = query.trim().slice(0, 100);
  const where: string[] = [HUMAN('u.')];
  const args: (string | number)[] = [];
  if (q) {
    // LIKE 패턴은 값으로만 만들고 와일드카드는 이스케이프한다(CLAUDE.md 규약).
    const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(`(lower(u.email) LIKE lower(?) ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.id = ?)`);
    args.push(pattern, pattern, q);
  }
  args.push(50);
  const res = await db.execute({
    sql: `SELECT u.id, u.email, u.name, ${planWithGrantSql('u')} AS plan, u.created_at, u.deletion_status,
                 (SELECT app_version FROM user_app_presence p WHERE p.user_id = u.id AND p.platform = 'android') AS android,
                 (SELECT app_version FROM user_app_presence p WHERE p.user_id = u.id AND p.platform = 'ios') AS ios,
                 (SELECT MAX(last_seen_at) FROM user_app_presence p WHERE p.user_id = u.id) AS last_seen,
                 (SELECT COUNT(*) FROM push_tokens t WHERE t.user_id = u.id) AS devices,
                 (SELECT COUNT(*) FROM usage_events e
                   WHERE e.user_id = u.id AND e.type IN ('alarm_rang', 'alarm_dismissed', 'alarm_snoozed')
                     AND julianday(e.occurred_at) >= julianday('now') - 30) AS recent_rings
          FROM users u
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY u.created_at DESC
          LIMIT ?`,
    args,
  });
  const ids = res.rows.map((x) => String(x.id));
  const consentRows = new Map<string, Array<Record<string, unknown>>>();
  if (ids.length > 0) {
    const c = await db.execute({
      sql: `SELECT user_id, consent_type, policy_version, agreed, created_at FROM user_consents
            WHERE user_id IN (${ids.map(() => '?').join(', ')})
            ORDER BY user_id, created_at DESC, rowid DESC`,
      args: ids,
    });
    for (const x of c.rows) {
      const uid = String(x.user_id);
      const list = consentRows.get(uid) ?? [];
      list.push(x as Record<string, unknown>);
      consentRows.set(uid, list);
    }
  }
  return res.rows.map((x) => {
    const id = String(x.id);
    const latest = latestConsentsFromRows(consentRows.get(id) ?? []);
    return {
      id,
      email: String(x.email ?? ''),
      name: String(x.name ?? ''),
      plan: String(x.plan ?? ''),
      createdAt: String(x.created_at ?? ''),
      deletionStatus: String(x.deletion_status ?? 'active'),
      android: x.android == null ? null : num(x.android),
      ios: x.ios == null ? null : num(x.ios),
      lastSeenAt: x.last_seen == null ? null : String(x.last_seen),
      devices: num(x.devices),
      recentRings: num(x.recent_rings),
      reconsentNeeded: missingConsentTypesFrom(latest, GENERAL_REQUIRED_CONSENTS).length > 0,
    };
  });
}

export interface PushJobRow {
  id: string;
  kind: string;
  isTest: boolean;
  title: string;
  body: string;
  estimatedTotal: number;
  sent: number;
  failed: number;
  status: string;
  createdAt: string;
  finishedAt: string | null;
}

/**
 * 발송 기록 — **보내는 중인 기록은 개수와 무관하게 전부**, 그 뒤에 최근 기록 `limit` 개. 멈춘 발송(광고 시간 밖·창을
 * 닫음)이 새 기록에 밀려 '이어 보내기' 를 잃지 않게.
 */
export async function listPushJobs(db: Client, limit = 30): Promise<PushJobRow[]> {
  const cols = `id, kind, is_test, title, body, estimated_total, sent, failed, status, created_at, finished_at`;
  const res = await db.execute({
    sql: `SELECT * FROM (SELECT ${cols}, 0 AS part FROM admin_push_jobs WHERE status = 'sending')
          UNION ALL
          SELECT * FROM (SELECT ${cols}, 1 AS part FROM admin_push_jobs WHERE status <> 'sending'
                         ORDER BY created_at DESC LIMIT ?)
          ORDER BY part, created_at DESC`,
    args: [Math.min(Math.max(limit, 1), 100)],
  });
  return res.rows.map((x) => ({
    id: String(x.id),
    kind: String(x.kind),
    isTest: num(x.is_test) === 1,
    title: String(x.title),
    body: String(x.body),
    estimatedTotal: num(x.estimated_total),
    sent: num(x.sent),
    failed: num(x.failed),
    status: String(x.status),
    createdAt: String(x.created_at),
    finishedAt: x.finished_at == null ? null : String(x.finished_at),
  }));
}
