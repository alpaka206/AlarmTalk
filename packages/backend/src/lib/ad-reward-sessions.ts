import type { DbExecutor } from './transactions';
import type { Env } from '../types';
import { planWithGrantSql } from './plan-grant-sql';
import { hasPersonalVoiceAccess } from '../routes/billing-helpers';
import { resolvePersonalPromo } from './personal-promo';
import { nextManualQuotaResetAt } from './manual-tts-quota';
import { UUID_RE } from './validate';
import {
  AD_REWARD_MONTHLY_LIMIT,
  grantMonthFor,
  isConfiguredRewardedAdUnit,
} from './ad-reward-credits';
import type { AdRewardCloseOutcome, AdRewardPlatform } from '@alarmtalk/shared';

/**
 * **광고 시청 승인 세션과 SSV 정산**(`docs/spec/ad-rewards.md` §3). 마이그레이션 141.
 *
 * 앱의 광고 한 번 = 세션 한 행이다. 상태:
 *
 * | 상태 | 뜻 | 동시 시청 잠금 | 월 획득 자리 |
 * | --- | --- | --- | --- |
 * | `prepared` | 승인 id 를 발급했다. 10분 안에 시작 승인을 받아야 한다 | 잡는다 | 잡는다(만료 전) |
 * | `started` | 표시 직전 시작을 승인했다 | 잡는다(15분) | 잡는다 |
 * | `unknown` | 시작 뒤 15분이 지나도록 앱이 끝을 알리지 않았다(결과 불명) | 푼다 | 잡는다 |
 * | `pending` | 앱이 '보상 신호를 받았다' 고 알렸다 — SSV 를 기다린다(정산 대기) | 푼다 | 잡는다 |
 * | `closed` | 보상 신호 없이 닫혔다(중도 닫힘). 늦은 SSV 는 그래도 정산한다 | 푼다 | 푼다 |
 * | `released` | 보상이 생길 수 없게 끝났다(시작 전 만료·취소·재고 없음·로딩·표시 실패) | 푼다 | 푼다 |
 * | `granted` | 서명된 SSV 로 보상 한 번을 적립했다 | 푼다 | 적립으로 센다 |
 *
 * ⚠ **세션은 보상의 증명이 아니다.** 앱의 `earned` 는 기다릴 상태만 정하고, 적립은 서명된 SSV 로만 한다.
 * ⚠ **시작 승인 뒤의 세션은 시간으로 지우지 않는다** — 늦게 온 정당한 콜백이 맞춰 볼 자리다. 24시간 넘게 정산되지 않은
 *   것은 관리자 조회(`lib/admin/ad-rewards.ts`)에 오른다. 자동 실패가 아니다.
 */

/** 발급부터 시작 승인까지의 유효 시간(초기 운영값). */
export const AD_REWARD_SESSION_TTL_MS = 10 * 60 * 1000;
/** 시작 승인 뒤 동시 시청 잠금을 잡고 있는 시간. 광고 한 편은 길어야 1분 남짓이다 — 그 뒤는 결과 불명(`unknown`). */
export const AD_REWARD_START_LOCK_MS = 15 * 60 * 1000;
/** 정산되지 않은 세션·콜백을 운영 확인 대상으로 올리는 나이(초기 운영 알림값 — 자동 실패·삭제 기한이 아니다). */
export const AD_REWARD_STALE_MS = 24 * 60 * 60 * 1000;
/** 정산 실패로 남은 콜백을 cron 이 다시 정산하기까지 기다리는 시간 — 응답 중인 첫 시도와 겹치지 않게. */
const CALLBACK_RETRY_AFTER_MS = 60 * 1000;
const CALLBACK_RETRY_BATCH = 3;
/** 시작도 못 하고 풀린 세션(보상이 생길 수 없다)을 지우는 나이. 시작한 세션은 지우지 않는다. */
const RELEASED_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** 적립하지 않은 콜백 기록을 지우는 나이. 적립한 기록은 적립 행과 함께 남는다. */
const UNGRANTED_CALLBACK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * **신규 시청 허용**(운영 스위치). `ADMOB_REWARDED_ADS_ENABLED` 가 켜져 있고 광고 단위가 설정됐을 때만이다.
 * ⚠ 이 스위치는 **새 세션만** 막는다 — 이미 승인한 세션의 정산과 SSV 의 광고 단위 허용(`ADMOB_REWARDED_AD_UNITS`)은
 *   그대로다. 끄는 순간 시청 중이던 사람의 보상이 사라지면 안 된다.
 */
export function adRewardViewingEnabled(env: Pick<Env, 'ADMOB_REWARDED_ADS_ENABLED' | 'ADMOB_REWARDED_AD_UNITS'>): boolean {
  const flag = (env.ADMOB_REWARDED_ADS_ENABLED ?? '').trim().toLowerCase();
  return (flag === 'true' || flag === '1') && Boolean(env.ADMOB_REWARDED_AD_UNITS?.trim());
}

// 달마다 자리를 잡고 있는 세션(위 표의 '월 획득 자리'). 첫 `?` 는 지금 시각(ISO)이다.
const RESERVING_SQL = `((status = 'prepared' AND expires_at > ?) OR status IN ('started', 'pending', 'unknown'))`;

/** `user`·`month` 의 적립 + 예약이 상한보다 작은가 — INSERT … SELECT … WHERE 에 그대로 붙인다. */
function capacitySql(
  userPk: string,
  month: string,
  nowIso: string,
  limit: number,
  excludeSessionId: string | null = null,
): { sql: string; args: (string | number)[] } {
  return {
    sql: `((SELECT COUNT(*) FROM ad_reward_credits WHERE user_id = ? AND grant_month = ?) +
           (SELECT COUNT(*) FROM ad_reward_sessions
             WHERE user_id = ? AND reserved_month = ? AND ${RESERVING_SQL} AND id <> ?)) < ?`,
    args: [userPk, month, userPk, month, nowIso, excludeSessionId ?? '', limit],
  };
}

export interface AdRewardStatus {
  /** 지금 쓸 수 있는(받고 아직 안 쓴) 보상 횟수. 플랫폼과 무관하게 계정 하나에 한 잔액이다. */
  credits: number;
  /** 이번 달 광고로 더 받을 수 있는 횟수 — 적립과 **열린 예약**을 함께 뺀다. */
  remaining_grants: number;
  monthly_limit: number;
  /** 앱이 끝까지 봤다고 알렸는데 아직 SSV 가 오지 않은 세션 수(24시간 안). 앱은 '보상을 확인하고 있어요' 를 말한다. */
  pending: number;
  /** 이 계정에 준비·시청 중인 세션이 있는가(다른 기기 포함). */
  session_open: boolean;
}

export async function readAdRewardStatus(
  db: DbExecutor,
  userPk: string,
  opts: { nowMs?: number; monthlyLimit?: number } = {},
): Promise<AdRewardStatus> {
  const nowMs = opts.nowMs ?? Date.now();
  const monthlyLimit = opts.monthlyLimit ?? AD_REWARD_MONTHLY_LIMIT;
  const nowIso = iso(nowMs);
  const month = grantMonthFor(null, nowMs);
  const res = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM ad_reward_credits WHERE user_id = ? AND consumed_at IS NULL) AS credits,
            (SELECT COUNT(*) FROM ad_reward_credits WHERE user_id = ? AND grant_month = ?) AS granted,
            (SELECT COUNT(*) FROM ad_reward_sessions
              WHERE user_id = ? AND reserved_month = ? AND ${RESERVING_SQL}) AS reserved,
            (SELECT COUNT(*) FROM ad_reward_sessions
              WHERE user_id = ? AND status = 'pending' AND closed_at > ?) AS pending,
            (SELECT COUNT(*) FROM ad_reward_sessions
              WHERE user_id = ? AND ((status = 'prepared' AND expires_at > ?)
                                     OR (status = 'started' AND started_at > ?))) AS open`,
    args: [
      userPk,
      userPk,
      month,
      userPk,
      month,
      nowIso,
      userPk,
      iso(nowMs - AD_REWARD_STALE_MS),
      userPk,
      nowIso,
      iso(nowMs - AD_REWARD_START_LOCK_MS),
    ],
  });
  const row = res.rows[0];
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return {
    credits: n(row?.credits),
    remaining_grants: Math.max(0, monthlyLimit - n(row?.granted) - n(row?.reserved)),
    monthly_limit: monthlyLimit,
    pending: n(row?.pending),
    session_open: n(row?.open) > 0,
  };
}

export type AdRewardUnavailableReason = 'disabled' | 'monthly_limit' | 'session_open';

/**
 * 앱이 받는 `ad_reward`(`GET /tts/manual-quota`·429 본문). 지금 새 광고를 볼 수 있는지(`can_watch`)와 못 보면 왜인지,
 * 다음 자리가 언제 생기는지를 서버가 정해 준다 — 두 앱이 같은 판정을 손으로 다시 짓지 않게.
 *
 * ⚠ **`user_id` 를 싣지 않는다**(2026-10-26). 예전에는 여기 계정 PK 를 실었고, 옛 앱은 그 값이 있어야 광고를 권했다.
 *   이제 계정 PK 는 승인 세션 응답에만 있다 — 승인 없이 광고를 띄우는 옛 흐름이 더는 시작되지 않는다(스펙 §3 「옛 앱」).
 */
export function adRewardView(
  env: Pick<Env, 'ADMOB_REWARDED_ADS_ENABLED' | 'ADMOB_REWARDED_AD_UNITS'>,
  status: AdRewardStatus,
  now: Date = new Date(),
) {
  const reason: AdRewardUnavailableReason | null = !adRewardViewingEnabled(env)
    ? 'disabled'
    : status.remaining_grants <= 0
      ? 'monthly_limit'
      : status.session_open
        ? 'session_open'
        : null;
  return {
    credits: status.credits,
    remaining_grants: status.remaining_grants,
    monthly_limit: status.monthly_limit,
    pending: status.pending,
    can_watch: reason === null,
    unavailable_reason: reason,
    // 상한이면 다음 달 1일 0시(KST). 꺼짐·열린 세션은 날짜로 말할 수 없다.
    next_grant_at: reason === 'monthly_limit' ? nextManualQuotaResetAt(now) : null,
  };
}

export interface AdRewardSessionRow {
  id: string;
  user_id: string;
  platform: string;
  ad_unit: string;
  status: string;
  reserved_month: string;
  release_reason: string | null;
  client_outcome: string | null;
  transaction_id: string | null;
  granted_month: string | null;
  created_at: string;
  expires_at: string;
  started_at: string | null;
  closed_at: string | null;
  settled_at: string | null;
}

function toSessionRow(r: Record<string, unknown> | undefined): AdRewardSessionRow | null {
  if (!r) return null;
  const s = (v: unknown) => (v == null ? null : String(v));
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    platform: String(r.platform),
    ad_unit: String(r.ad_unit),
    status: String(r.status),
    reserved_month: String(r.reserved_month),
    release_reason: s(r.release_reason),
    client_outcome: s(r.client_outcome),
    transaction_id: s(r.transaction_id),
    granted_month: s(r.granted_month),
    created_at: String(r.created_at),
    expires_at: String(r.expires_at),
    started_at: s(r.started_at),
    closed_at: s(r.closed_at),
    settled_at: s(r.settled_at),
  };
}

const SESSION_COLUMNS = `id, user_id, platform, ad_unit, status, reserved_month, release_reason, client_outcome,
  transaction_id, granted_month, created_at, expires_at, started_at, closed_at, settled_at`;

/** 앱에 보이는 세션 — 상태와 시각만. 광고 단위·거래 id 는 운영용이라 싣지 않는다. */
export function sessionView(row: AdRewardSessionRow) {
  return {
    id: row.id,
    status: row.status,
    granted: row.status === 'granted',
    expires_at: row.expires_at,
    started_at: row.started_at,
  };
}

export async function readAdRewardSession(
  db: DbExecutor,
  sessionId: string,
  userPk: string,
): Promise<AdRewardSessionRow | null> {
  const res = await db.execute({
    sql: `SELECT ${SESSION_COLUMNS} FROM ad_reward_sessions WHERE id = ? AND user_id = ? LIMIT 1`,
    args: [sessionId, userPk],
  });
  return toSessionRow(res.rows[0] as Record<string, unknown> | undefined);
}

/** 이 계정의 낡은 세션을 정리한다 — 시작 전 만료는 `released`, 시작 뒤 잠금 시간이 지난 것은 `unknown`. */
function sweepStatements(userPk: string, nowMs: number) {
  const nowIso = iso(nowMs);
  return [
    {
      sql: `UPDATE ad_reward_sessions SET status = 'released', release_reason = 'expired', closed_at = ?
            WHERE user_id = ? AND status = 'prepared' AND expires_at <= ?`,
      args: [nowIso, userPk, nowIso],
    },
    {
      sql: `UPDATE ad_reward_sessions SET status = 'unknown'
            WHERE user_id = ? AND status = 'started' AND started_at <= ?`,
      args: [userPk, iso(nowMs - AD_REWARD_START_LOCK_MS)],
    },
  ];
}

export type PrepareResult =
  | { ok: true; session: AdRewardSessionRow }
  | { ok: false; reason: 'session_open' | 'monthly_limit' };

/**
 * 승인 id 를 발급하고 이번 달 획득 자리 하나를 잡는다. 열린 세션이 있거나 자리가 없으면 거절한다.
 * 정리·검사·삽입이 한 batch(한 트랜잭션)라 두 기기가 마지막 자리를 함께 잡지 못한다 — 그래도 겹치면 부분 고유
 * 인덱스(`idx_ad_reward_sessions_one_open`)가 하나를 떨군다.
 */
export async function prepareAdRewardSession(
  db: DbExecutor,
  input: { userPk: string; platform: AdRewardPlatform; adUnit: string; nowMs?: number; monthlyLimit?: number },
): Promise<PrepareResult> {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = iso(nowMs);
  const month = grantMonthFor(null, nowMs);
  const id = crypto.randomUUID();
  const capacity = capacitySql(input.userPk, month, nowIso, input.monthlyLimit ?? AD_REWARD_MONTHLY_LIMIT);
  let results;
  try {
    results = await db.batch([
      ...sweepStatements(input.userPk, nowMs),
      {
        sql: `INSERT INTO ad_reward_sessions
                (id, user_id, platform, ad_unit, status, reserved_month, created_at, expires_at)
              SELECT ?, ?, ?, ?, 'prepared', ?, ?, ?
              WHERE NOT EXISTS (SELECT 1 FROM ad_reward_sessions
                                 WHERE user_id = ? AND status IN ('prepared', 'started'))
                AND ${capacity.sql}`,
        args: [
          id,
          input.userPk,
          input.platform,
          input.adUnit,
          month,
          nowIso,
          iso(nowMs + AD_REWARD_SESSION_TTL_MS),
          input.userPk,
          ...capacity.args,
        ],
      },
      {
        sql: `SELECT COUNT(*) AS open FROM ad_reward_sessions
              WHERE user_id = ? AND status IN ('prepared', 'started') AND id <> ?`,
        args: [input.userPk, id],
      },
    ]);
  } catch (err) {
    // 같은 순간에 다른 기기가 먼저 열었다 — 부분 고유 인덱스가 막았다.
    if (/UNIQUE constraint failed/i.test(String(err))) return { ok: false, reason: 'session_open' };
    throw err;
  }
  if ((results[2]?.rowsAffected ?? 0) === 0) {
    return { ok: false, reason: Number(results[3]?.rows[0]?.open ?? 0) > 0 ? 'session_open' : 'monthly_limit' };
  }
  const session = await readAdRewardSession(db, id, input.userPk);
  if (!session) throw new Error('ad reward session vanished after insert');
  return { ok: true, session };
}

export type StartResult =
  | { ok: true; session: AdRewardSessionRow }
  | { ok: false; reason: 'not_found' | 'expired' | 'state' | 'monthly_limit' };

/**
 * 광고 표시 직전의 **시작 승인**. 준비 상태이고 10분 안이어야 한다. 발급과 시작 사이에 달이 바뀌었으면 새 달의 자리를
 * 다시 본다(없으면 예약을 풀고 거절). 그 밖의 자격(플랜·스위치)은 라우트가 먼저 본다.
 */
export async function startAdRewardSession(
  db: DbExecutor,
  input: { sessionId: string; userPk: string; nowMs?: number; monthlyLimit?: number },
): Promise<StartResult> {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = iso(nowMs);
  const month = grantMonthFor(null, nowMs);
  const capacity = capacitySql(
    input.userPk,
    month,
    nowIso,
    input.monthlyLimit ?? AD_REWARD_MONTHLY_LIMIT,
    input.sessionId,
  );
  const results = await db.batch([
    {
      sql: `UPDATE ad_reward_sessions SET status = 'released', release_reason = 'expired', closed_at = ?
            WHERE id = ? AND user_id = ? AND status = 'prepared' AND expires_at <= ?`,
      args: [nowIso, input.sessionId, input.userPk, nowIso],
    },
    {
      sql: `UPDATE ad_reward_sessions SET status = 'started', started_at = ?, reserved_month = ?
            WHERE id = ? AND user_id = ? AND status = 'prepared' AND expires_at > ?
              AND (reserved_month = ? OR ${capacity.sql})`,
      args: [nowIso, month, input.sessionId, input.userPk, nowIso, month, ...capacity.args],
    },
    {
      sql: `SELECT ${SESSION_COLUMNS} FROM ad_reward_sessions WHERE id = ? AND user_id = ? LIMIT 1`,
      args: [input.sessionId, input.userPk],
    },
  ]);
  const session = toSessionRow(results[2]?.rows[0] as Record<string, unknown> | undefined);
  if (!session) return { ok: false, reason: 'not_found' };
  if ((results[1]?.rowsAffected ?? 0) > 0) return { ok: true, session };
  if (session.status === 'prepared') {
    // 달이 바뀌었고 새 달에 자리가 없다 — 예약을 풀어 둔다.
    await releaseAdRewardSession(db, input.sessionId, input.userPk, 'monthly_limit', nowMs);
    return { ok: false, reason: 'monthly_limit' };
  }
  if (session.status === 'released' && session.release_reason === 'expired') return { ok: false, reason: 'expired' };
  return { ok: false, reason: 'state' };
}

/** 시작 승인 전의 세션을 푼다(자격을 잃었을 때 등). 시작한 세션에는 아무것도 하지 않는다. */
export async function releaseAdRewardSession(
  db: DbExecutor,
  sessionId: string,
  userPk: string,
  reason: string,
  nowMs: number = Date.now(),
): Promise<void> {
  await db.execute({
    sql: `UPDATE ad_reward_sessions SET status = 'released', release_reason = ?, closed_at = ?
          WHERE id = ? AND user_id = ? AND status = 'prepared'`,
    args: [reason, iso(nowMs), sessionId, userPk],
  });
}

/**
 * 광고 화면이 어떻게 끝났는지(앱의 주장)를 받는다. 보상을 주거나 빼앗지 않는다 — 잠금·예약을 풀지와 기다릴 상태만 정한다.
 *
 * | 지금 | `earned` | `dismissed` | `show_failed` | 그 밖(`no_fill`·`load_failed`·`cancelled`) |
 * | --- | --- | --- | --- | --- |
 * | `prepared` | `released` | `released` | `released` | `released` |
 * | `started`·`unknown` | `pending` | `closed` | `released` | `closed` |
 * | 그 밖 | 그대로 | 그대로 | 그대로 | 그대로 |
 *
 * 시작 전이면 광고가 뜬 적이 없으니 무엇이든 보상이 생길 수 없다. 시작 뒤의 `dismissed` 는 '보상 없음' 으로 단정하지
 * 않는다(`closed` — 늦은 SSV 는 정산한다). 같은 요청을 다시 보내도 상태가 바뀌지 않는다.
 */
export async function closeAdRewardSession(
  db: DbExecutor,
  input: { sessionId: string; userPk: string; outcome: AdRewardCloseOutcome; nowMs?: number },
): Promise<AdRewardSessionRow | null> {
  const nowIso = iso(input.nowMs ?? Date.now());
  const o = input.outcome;
  const results = await db.batch([
    {
      sql: `UPDATE ad_reward_sessions SET
              status = CASE WHEN status = 'prepared' THEN 'released'
                            WHEN ? = 'earned' THEN 'pending'
                            WHEN ? = 'show_failed' THEN 'released'
                            ELSE 'closed' END,
              release_reason = CASE WHEN status = 'prepared' OR ? = 'show_failed' THEN ? ELSE release_reason END,
              client_outcome = ?,
              closed_at = ?
            WHERE id = ? AND user_id = ? AND status IN ('prepared', 'started', 'unknown')`,
      args: [o, o, o, o, o, nowIso, input.sessionId, input.userPk],
    },
    {
      sql: `SELECT ${SESSION_COLUMNS} FROM ad_reward_sessions WHERE id = ? AND user_id = ? LIMIT 1`,
      args: [input.sessionId, input.userPk],
    },
  ]);
  return toSessionRow(results[1]?.rows[0] as Record<string, unknown> | undefined);
}

// MARK: - SSV 정산

export interface VerifiedRewardCallback {
  transactionId: string;
  userId: string;
  adUnit: string;
  customData: string;
  rewardedAtMs: number | null;
}

/**
 * 검증한 콜백을 **먼저 적는다**(내구 기록). 이게 성공해야 200 을 돌려준다 — 정산이 그 뒤에 실패해도 cron 이 다시 한다.
 * 같은 거래가 다시 오면 시도 횟수만 올린다. 돌려주는 값: 이미 정산됐으면 그때의 결과, 아니면 null(지금 정산한다).
 */
export async function recordAdRewardCallback(
  db: DbExecutor,
  cb: VerifiedRewardCallback,
  nowMs: number = Date.now(),
): Promise<{ settledOutcome: string | null }> {
  const sessionId = cb.customData.trim() === '' ? null : cb.customData.trim().slice(0, 128);
  const results = await db.batch([
    {
      sql: `INSERT INTO ad_reward_callbacks
              (transaction_id, user_id, ad_unit, session_id, rewarded_at, reward_month, received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(transaction_id) DO UPDATE SET attempts = attempts + 1`,
      args: [
        cb.transactionId,
        cb.userId,
        cb.adUnit,
        sessionId,
        cb.rewardedAtMs == null ? null : iso(cb.rewardedAtMs),
        grantMonthFor(cb.rewardedAtMs, nowMs),
        iso(nowMs),
      ],
    },
    {
      sql: `SELECT status, outcome FROM ad_reward_callbacks WHERE transaction_id = ?`,
      args: [cb.transactionId],
    },
  ]);
  const row = results[1]?.rows[0];
  return { settledOutcome: row && String(row.status) === 'settled' ? String(row.outcome ?? '') : null };
}

/** 정산 결과 — `granted` 만 적립이다. 나머지는 이유(관리자 대조·로그용). */
export type SettleOutcome =
  | 'granted'
  | 'duplicate'
  | 'monthly_limit'
  | 'plan'
  | 'user'
  | 'session_unknown'
  | 'session_user_mismatch'
  | 'session_ad_unit_mismatch'
  | 'session_reused';

async function finishCallback(db: DbExecutor, transactionId: string, outcome: SettleOutcome, nowMs: number) {
  await db.execute({
    sql: `UPDATE ad_reward_callbacks SET status = 'settled', outcome = ?, settled_at = ?
          WHERE transaction_id = ? AND status = 'received'`,
    args: [outcome, iso(nowMs), transactionId],
  });
}

/**
 * 적어 둔 콜백 하나를 정산한다. 여러 번 불러도 같다(첫 정산 뒤에는 기록된 결과를 돌려준다).
 *
 * - **승인 id 가 있으면**(`custom_data`): 세션의 계정·광고 단위가 콜백과 같아야 하고, 그 세션에 아직 적립이 없어야 한다
 *   (승인 하나 = 보상 한 번). 이 갈래는 **지금의 플랜을 보지 않는다** — 무료일 때 승인한 시청이다. 시청 중 플러스가
 *   됐으면 적립해 잔액으로 남긴다. 자리를 잡고 있던 세션(`prepared`·`started`·`unknown`·`pending`)이면 월 상한을 다시 보지
 *   않는다 — 승인할 때 자리를 확인했고, 처리 지연·월 경계로 정상 완료 보상을 잃게 하지 않는다. 자리를 푼 세션(`closed`·
 *   `released`)은 그 달 상한을 본다.
 * - **승인 id 가 없으면**(옛 앱): 옛 규칙 그대로 — 무료 계정만, 그 달 상한 안에서.
 * - 어느 쪽이든 귀속 달은 서명된 보상 시각의 KST 달이고, 같은 거래 id 는 한 번만 적립한다.
 */
export async function settleAdRewardCallback(
  db: DbExecutor,
  env: Env,
  transactionId: string,
  nowMs: number = Date.now(),
  monthlyLimit: number = AD_REWARD_MONTHLY_LIMIT,
): Promise<SettleOutcome> {
  const cbRes = await db.execute({
    sql: `SELECT transaction_id, user_id, ad_unit, session_id, reward_month, status, outcome
          FROM ad_reward_callbacks WHERE transaction_id = ?`,
    args: [transactionId],
  });
  const cb = cbRes.rows[0];
  if (!cb) throw new Error('ad reward callback is not recorded');
  if (String(cb.status) === 'settled') return String(cb.outcome) as SettleOutcome;
  const userId = String(cb.user_id);
  const adUnit = String(cb.ad_unit);
  const month = String(cb.reward_month);
  const sessionId = cb.session_id == null ? null : String(cb.session_id);
  const nowIso = iso(nowMs);

  const userRes = await db.execute({
    sql: `SELECT ${planWithGrantSql('users')} AS plan FROM users WHERE id = ? AND deletion_status = 'active' LIMIT 1`,
    args: [userId],
  });
  const user = userRes.rows[0];

  let holdsReservation = false;
  if (sessionId !== null) {
    if (!UUID_RE.test(sessionId)) {
      await finishCallback(db, transactionId, 'session_unknown', nowMs);
      return 'session_unknown';
    }
    const sRes = await db.execute({
      sql: `SELECT ${SESSION_COLUMNS} FROM ad_reward_sessions WHERE id = ? LIMIT 1`,
      args: [sessionId],
    });
    const session = toSessionRow(sRes.rows[0] as Record<string, unknown> | undefined);
    let refusal: SettleOutcome | null = null;
    if (!session) refusal = 'session_unknown';
    else if (session.user_id !== userId) refusal = 'session_user_mismatch';
    else if (!isConfiguredRewardedAdUnit(session.ad_unit, adUnit)) refusal = 'session_ad_unit_mismatch';
    else if (session.transaction_id && session.transaction_id !== transactionId) refusal = 'session_reused';
    else if (!user) refusal = 'user';
    if (refusal) {
      await finishCallback(db, transactionId, refusal, nowMs);
      return refusal;
    }
    holdsReservation =
      (session!.status === 'prepared' && session!.expires_at > nowIso) ||
      ['started', 'unknown', 'pending'].includes(session!.status);
  } else {
    // 옛 경로 — 승인 없이 온 콜백. 옛 규칙(무료만)을 그대로 쓴다.
    let refusal: SettleOutcome | null = null;
    if (!user) refusal = 'user';
    else if (hasPersonalVoiceAccess(user.plan == null ? null : String(user.plan), resolvePersonalPromo(env)))
      refusal = 'plan';
    if (refusal) {
      await finishCallback(db, transactionId, refusal, nowMs);
      return refusal;
    }
  }

  const capacity = capacitySql(userId, month, nowIso, monthlyLimit, sessionId);
  const sid = sessionId ?? '';
  const results = await db.batch([
    {
      sql: `INSERT OR IGNORE INTO ad_reward_credits (transaction_id, user_id, ad_unit, grant_month, session_id)
            SELECT ?, ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM ad_reward_credits WHERE transaction_id = ? OR (? <> '' AND session_id = ?))
              AND (? = 1 OR ${capacity.sql})`,
      args: [
        transactionId,
        userId,
        adUnit,
        month,
        sessionId,
        transactionId,
        sid,
        sid,
        holdsReservation ? 1 : 0,
        ...capacity.args,
      ],
    },
    {
      sql: `UPDATE ad_reward_sessions SET status = 'granted', transaction_id = ?, granted_month = ?, settled_at = ?
            WHERE id = ? AND transaction_id IS NULL
              AND EXISTS (SELECT 1 FROM ad_reward_credits WHERE transaction_id = ? AND session_id = ?)`,
      args: [transactionId, month, nowIso, sid, transactionId, sid],
    },
    {
      sql: `UPDATE ad_reward_callbacks SET status = 'settled', settled_at = ?,
              outcome = CASE
                WHEN EXISTS (SELECT 1 FROM ad_reward_credits WHERE transaction_id = ?
                              AND COALESCE(session_id, '') = ?) THEN 'granted'
                WHEN EXISTS (SELECT 1 FROM ad_reward_credits WHERE transaction_id = ?) THEN 'duplicate'
                WHEN ? <> '' AND EXISTS (SELECT 1 FROM ad_reward_credits WHERE session_id = ?) THEN 'session_reused'
                ELSE 'monthly_limit' END
            WHERE transaction_id = ? AND status = 'received'`,
      args: [nowIso, transactionId, sid, transactionId, sid, sid, transactionId],
    },
    { sql: `SELECT outcome FROM ad_reward_callbacks WHERE transaction_id = ?`, args: [transactionId] },
  ]);
  return String(results[3]?.rows[0]?.outcome ?? 'monthly_limit') as SettleOutcome;
}

/** cron — 적어 두었지만 정산이 실패한 콜백을 다시 정산한다(내부 재시도). AdMob 의 재전송에 기대지 않는다. */
export async function retryUnsettledAdRewardCallbacks(
  db: DbExecutor,
  env: Env,
  nowMs: number = Date.now(),
): Promise<{ settled: number; failed: number }> {
  const due = await db.execute({
    sql: `SELECT transaction_id FROM ad_reward_callbacks
          WHERE status = 'received' AND received_at <= ? ORDER BY received_at LIMIT ?`,
    args: [iso(nowMs - CALLBACK_RETRY_AFTER_MS), CALLBACK_RETRY_BATCH],
  });
  let settled = 0;
  let failed = 0;
  for (const row of due.rows) {
    try {
      await settleAdRewardCallback(db, env, String(row.transaction_id), nowMs);
      settled++;
    } catch (err) {
      failed++;
      console.error('[ad-reward] callback settle retry failed', err);
    }
  }
  return { settled, failed };
}

/**
 * cron — 다시 볼 일이 없는 기록을 지운다. **시작 승인을 받은 세션은 지우지 않는다**(늦은 콜백을 맞춰 볼 자리다).
 * 지우는 것: 시작도 못 하고 풀린 세션 30일, 적립하지 않은 콜백 기록 90일.
 */
export async function pruneAdRewardHistory(db: DbExecutor, nowMs: number = Date.now()): Promise<void> {
  await db.batch([
    {
      sql: `DELETE FROM ad_reward_sessions
            WHERE status = 'released' AND started_at IS NULL AND created_at < ?`,
      args: [iso(nowMs - RELEASED_SESSION_RETENTION_MS)],
    },
    {
      sql: `DELETE FROM ad_reward_callbacks
            WHERE status = 'settled' AND outcome <> 'granted' AND received_at < ?`,
      args: [iso(nowMs - UNGRANTED_CALLBACK_RETENTION_MS)],
    },
  ]);
}
