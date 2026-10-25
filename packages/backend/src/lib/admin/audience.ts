/**
 * 관리자 알림의 **대상 고르기** — `docs/spec/admin-console.md` 「대상」.
 *
 * 대상은 토큰 목록이 아니라 **조건**이다. 발송 기록(`admin_push_jobs`)에는 이 조건과 커서만 적고, 보낼 때마다
 * 조건으로 다시 고른다. 그래서 그 표에는 사람을 가리키는 값이 남지 않는다.
 *
 * SQL 은 화이트리스트 조각만 붙이고 값은 전부 `?` 로 묶는다(CLAUDE.md 「입력/SQL 보안 규약」).
 * 동의 조건(재동의 필요·마케팅 수신)은 판정 규칙이 `lib/consent.ts` 에 있어서 SQL 로 베끼지 않고 행을 읽어
 * 같은 함수로 거른다 — 규칙이 두 벌이 되면 콘솔이 말하는 '재동의 필요' 와 서버가 실제로 막는 사람이 갈라진다.
 */
import type { Client } from '@libsql/client/web';
import {
  GENERAL_REQUIRED_CONSENTS,
  latestConsentsFromRows,
  missingConsentTypesFrom,
} from '../consent';

export type AudiencePlatform = 'all' | 'android' | 'ios';

export interface Audience {
  platform: AudiencePlatform;
  /** 이 빌드 **미만**인 안드로이드만. null 이면 안드로이드는 버전과 무관하게. */
  androidBelow: number | null;
  /** 이 빌드 **미만**인 iOS 만. null 이면 iOS 는 버전과 무관하게. */
  iosBelow: number | null;
  /** 버전 조건이 있을 때, 기록이 아직 없는(콘솔 배포 뒤 한 번도 접속하지 않은) 기기도 넣는가. */
  includeUnknownVersion: boolean;
  /** 필수 동의가 모자라 서버가 막고 있는 사람만. */
  reconsentOnly: boolean;
  /** 켜진 알람이 하나라도 있는 사람만. */
  activeAlarmOnly: boolean;
  /** 광고성 정보 수신에 동의한 사람만 — 광고 알림이면 언제나 켜진다. */
  marketingOnly: boolean;
}

export const DEFAULT_AUDIENCE: Audience = {
  platform: 'all',
  androidBelow: null,
  iosBelow: null,
  includeUnknownVersion: false,
  reconsentOnly: false,
  activeAlarmOnly: false,
  marketingOnly: false,
};

function buildNumber(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!/^\d{1,7}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 1_000_000 ? n : null;
}

function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on' || value === '1' || value === 1;
}

/** 폼·JSON 어느 쪽이든 받아 화이트리스트로 정규화한다. 모르는 값은 기본값으로 떨어진다. */
export function parseAudience(raw: Record<string, unknown>): Audience {
  const platform = raw.platform === 'android' || raw.platform === 'ios' ? raw.platform : 'all';
  return {
    platform,
    androidBelow: platform === 'ios' ? null : buildNumber(raw.androidBelow),
    iosBelow: platform === 'android' ? null : buildNumber(raw.iosBelow),
    includeUnknownVersion: flag(raw.includeUnknownVersion),
    reconsentOnly: flag(raw.reconsentOnly),
    activeAlarmOnly: flag(raw.activeAlarmOnly),
    marketingOnly: flag(raw.marketingOnly),
  };
}

export interface AudienceCandidate {
  /** push_tokens.id — 커서로 쓴다. */
  pid: string;
  token: string;
  platform: 'android' | 'ios';
  userId: string;
}

/** 조건에 맞는 토큰 후보(동의 조건은 아직 안 본 것) — `pid` 순서, 커서 다음부터. */
export function candidateQuery(
  audience: Audience,
  options: { afterPid: string; limit: number; upToPid?: string },
): { sql: string; args: (string | number)[] } {
  const where: string[] = [
    `COALESCE(u.deletion_status, 'active') = 'active'`,
    `pt.platform IN ('android', 'ios')`,
    `pt.id > ?`,
  ];
  const args: (string | number)[] = [options.afterPid];
  if (options.upToPid !== undefined) {
    where.push(`pt.id <= ?`);
    args.push(options.upToPid);
  }
  if (audience.platform !== 'all') {
    where.push(`pt.platform = ?`);
    args.push(audience.platform);
  }
  const versionClause = (platform: 'android' | 'ios', below: number | null) => {
    if (below === null) return;
    where.push(
      `(pt.platform <> ? OR p.app_version < ?${audience.includeUnknownVersion ? ' OR p.app_version IS NULL' : ''})`,
    );
    args.push(platform, below);
  };
  versionClause('android', audience.androidBelow);
  versionClause('ios', audience.iosBelow);
  if (audience.activeAlarmOnly) {
    // 알람 행의 user_id 는 통일 이전 행이면 로그인 id 다(`fcm.getTokensForUser` 주석).
    where.push(
      `EXISTS (SELECT 1 FROM alarms a WHERE a.is_active = 1 AND a.user_id IN (u.id, COALESCE(u.google_id, u.id)))`,
    );
  }
  args.push(options.limit);
  return {
    sql: `SELECT pt.id AS pid, pt.token AS token, pt.platform AS platform, u.id AS uid
          FROM push_tokens pt
          JOIN users u ON u.id = pt.user_id
          LEFT JOIN user_app_presence p ON p.user_id = u.id AND p.platform = pt.platform
          WHERE ${where.join(' AND ')}
          ORDER BY pt.id
          LIMIT ?`,
    args,
  };
}

const CONSENT_CHUNK = 400;

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/**
 * 후보에 동의 조건을 적용한다. 동의 조건이 없으면 DB 를 부르지 않는다.
 * 같은 사람의 행은 `created_at DESC, rowid DESC` 순서로 모아 `latestConsentsFromRows` 에 그대로 넘긴다.
 */
export async function applyConsentFilters(
  db: Pick<Client, 'execute'>,
  audience: Audience,
  candidates: AudienceCandidate[],
): Promise<AudienceCandidate[]> {
  if (!audience.reconsentOnly && !audience.marketingOnly) return candidates;
  const userIds = Array.from(new Set(candidates.map((c) => c.userId)));
  if (userIds.length === 0) return [];
  const rowsByUser = new Map<string, Array<Record<string, unknown>>>();
  // IN 목록은 나눠 묻는다 — SQLite 의 바인딩 수 상한에 닿지 않게.
  for (let i = 0; i < userIds.length; i += CONSENT_CHUNK) {
    const chunk = userIds.slice(i, i + CONSENT_CHUNK);
    const res = await db.execute({
      sql: `SELECT user_id, consent_type, policy_version, agreed, created_at
            FROM user_consents WHERE user_id IN (${placeholders(chunk.length)})
            ORDER BY user_id, created_at DESC, rowid DESC`,
      args: chunk,
    });
    for (const row of res.rows) {
      const uid = String(row.user_id);
      const list = rowsByUser.get(uid) ?? [];
      list.push(row as Record<string, unknown>);
      rowsByUser.set(uid, list);
    }
  }
  const keep = new Set<string>();
  for (const uid of userIds) {
    const latest = latestConsentsFromRows(rowsByUser.get(uid) ?? []);
    if (audience.reconsentOnly && missingConsentTypesFrom(latest, GENERAL_REQUIRED_CONSENTS).length === 0) continue;
    if (audience.marketingOnly && missingConsentTypesFrom(latest, ['marketing']).length > 0) continue;
    keep.add(uid);
  }
  return candidates.filter((c) => keep.has(c.userId));
}

function toCandidates(rows: ReadonlyArray<Record<string, unknown>>): AudienceCandidate[] {
  return rows.map((row) => ({
    pid: String(row.pid),
    token: String(row.token),
    platform: row.platform === 'ios' ? 'ios' : 'android',
    userId: String(row.uid),
  }));
}

/** 커서 다음의 한 장 — 후보 `scanLimit` 개를 훑어 조건을 통과한 것만 돌려주고, 훑은 마지막 자리를 커서로 준다. */
export async function nextAudiencePage(
  db: Pick<Client, 'execute'>,
  audience: Audience,
  afterPid: string,
  scanLimit: number,
  /** 끊긴 걸음을 다시 보낼 때 — 그 걸음이 맡았던 구간 `(afterPid, upToPid]` 만. */
  upToPid?: string,
): Promise<{ targets: AudienceCandidate[]; nextCursor: string; exhausted: boolean }> {
  const res = await db.execute(candidateQuery(audience, { afterPid, limit: scanLimit, upToPid }));
  const scanned = toCandidates(res.rows as Array<Record<string, unknown>>);
  const targets = await applyConsentFilters(db, audience, scanned);
  return {
    targets,
    nextCursor: scanned.length > 0 ? scanned[scanned.length - 1]!.pid : afterPid,
    exhausted: scanned.length < scanLimit,
  };
}

/** 미리보기 — 전체를 세어 플랫폼별 기기 수와 사람 수를 낸다(한 번에 최대 `cap` 기기까지). */
export async function countAudience(
  db: Pick<Client, 'execute'>,
  audience: Audience,
  cap = 20_000,
): Promise<{ android: number; ios: number; users: number; capped: boolean }> {
  const res = await db.execute(candidateQuery(audience, { afterPid: '', limit: cap + 1 }));
  const scanned = toCandidates(res.rows as Array<Record<string, unknown>>).slice(0, cap);
  const targets = await applyConsentFilters(db, audience, scanned);
  return {
    android: targets.filter((t) => t.platform === 'android').length,
    ios: targets.filter((t) => t.platform === 'ios').length,
    users: new Set(targets.map((t) => t.userId)).size,
    capped: res.rows.length > cap,
  };
}
