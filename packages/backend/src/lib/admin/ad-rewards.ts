import type { Client } from '@libsql/client';
import { AD_REWARD_STALE_MS, readAdRewardStatus } from '../ad-reward-sessions';

/**
 * 관리자 콘솔 **광고 보상 대조**(읽기 전용 JSON, `docs/spec/ad-rewards.md` §7 · `admin-console.md`).
 *
 * 장기 미확정 세션(시작 승인 뒤 24시간 넘게 적립이 없는 것)과 정산되지 않은 콜백을 모아, 사람이 승인·콜백·거래·잔액을
 * 맞춰 볼 수 있게 한다. ⚠ **여기서 쓰지 않는다** — 고객 보상 지급·재정산은 후속(스펙 §7)이다. 지급을 붙일 때는 같은 승인
 * id 에 묶어 이중 적립을 막고 사유·감사 이력을 남긴다.
 */

const LIST_LIMIT = 100;

function rows(res: { rows: Array<Record<string, unknown>> }): Array<Record<string, unknown>> {
  return res.rows.map((r) => ({ ...r }));
}

/** 전체 — 24시간 넘은 미확정 세션, 정산되지 않은 콜백, 상태별 세션 수. */
export async function loadAdRewardReconciliation(db: Client, now: Date) {
  const staleBefore = new Date(now.getTime() - AD_REWARD_STALE_MS).toISOString();
  const [stale, unsettled, counts] = await db.batch(
    [
      {
        // 시작 승인 뒤 적립이 없는 세션(정산 대기·결과 불명·시작) 중 24시간 넘은 것. 그 세션 id 로 들어온 콜백도 붙인다.
        sql: `SELECT s.id, s.user_id, s.platform, s.ad_unit, s.status, s.client_outcome, s.reserved_month,
                     s.created_at, s.started_at, s.closed_at,
                     (SELECT COUNT(*) FROM ad_reward_callbacks cb WHERE cb.session_id = s.id) AS callbacks,
                     (SELECT GROUP_CONCAT(cb.outcome) FROM ad_reward_callbacks cb WHERE cb.session_id = s.id) AS callback_outcomes
              FROM ad_reward_sessions s
              WHERE s.status IN ('started', 'unknown', 'pending') AND s.transaction_id IS NULL
                AND COALESCE(s.started_at, s.created_at) < ?
              ORDER BY s.created_at LIMIT ?`,
        args: [staleBefore, LIST_LIMIT],
      },
      {
        // 적어 두었지만 정산하지 못한 콜백 — cron 이 다시 하는데도 남았으면 장애다.
        sql: `SELECT transaction_id, user_id, ad_unit, session_id, reward_month, attempts, received_at
              FROM ad_reward_callbacks WHERE status = 'received' ORDER BY received_at LIMIT ?`,
        args: [LIST_LIMIT],
      },
      {
        sql: `SELECT status, COUNT(*) AS n FROM ad_reward_sessions GROUP BY status`,
        args: [],
      },
    ],
    'read',
  );
  return {
    generated_at: now.toISOString(),
    stale_after_hours: AD_REWARD_STALE_MS / 3_600_000,
    stale_sessions: rows(stale!),
    unsettled_callbacks: rows(unsettled!),
    sessions_by_status: Object.fromEntries(counts!.rows.map((r) => [String(r.status), Number(r.n ?? 0)])),
  };
}

/**
 * 한 사람 — 세션·콜백·적립을 나란히 두고 어긋남을 표시한다. 어긋남:
 * - `granted_session_without_credit`: 세션은 `granted` 인데 그 승인 id 의 적립 행이 없다.
 * - `credit_session_not_granted`: 적립 행은 승인 id 를 가리키는데 세션이 `granted` 가 아니다.
 * - `granted_callback_without_credit`: 콜백 결과가 `granted` 인데 그 거래의 적립 행이 없다.
 * - `stale_pending`: 시작 승인 뒤 24시간 넘게 적립이 없다(위 전체 목록과 같은 기준).
 */
export async function loadUserAdRewards(db: Client, userPk: string, now: Date) {
  const [sessions, callbacks, credits] = await db.batch(
    [
      {
        sql: `SELECT id, platform, ad_unit, status, release_reason, client_outcome, transaction_id, reserved_month,
                     granted_month, created_at, expires_at, started_at, closed_at, settled_at
              FROM ad_reward_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        args: [userPk, LIST_LIMIT],
      },
      {
        sql: `SELECT transaction_id, ad_unit, session_id, rewarded_at, reward_month, status, outcome, attempts,
                     received_at, settled_at
              FROM ad_reward_callbacks WHERE user_id = ? ORDER BY received_at DESC LIMIT ?`,
        args: [userPk, LIST_LIMIT],
      },
      {
        sql: `SELECT transaction_id, session_id, ad_unit, grant_month, granted_at, consumed_at
              FROM ad_reward_credits WHERE user_id = ? ORDER BY granted_at DESC LIMIT ?`,
        args: [userPk, LIST_LIMIT],
      },
    ],
    'read',
  );
  const sessionRows = rows(sessions!);
  const callbackRows = rows(callbacks!);
  const creditRows = rows(credits!);
  const creditBySession = new Set(creditRows.map((r) => r.session_id).filter((v) => v != null).map(String));
  const creditByTx = new Set(creditRows.map((r) => String(r.transaction_id)));
  const sessionById = new Map(sessionRows.map((r) => [String(r.id), r]));
  const staleBefore = new Date(now.getTime() - AD_REWARD_STALE_MS).toISOString();
  const mismatches: Array<{ kind: string; ref: string }> = [];
  for (const s of sessionRows) {
    const id = String(s.id);
    if (s.status === 'granted' && !creditBySession.has(id)) mismatches.push({ kind: 'granted_session_without_credit', ref: id });
    if (
      ['started', 'unknown', 'pending'].includes(String(s.status)) &&
      String(s.started_at ?? s.created_at) < staleBefore
    ) {
      mismatches.push({ kind: 'stale_pending', ref: id });
    }
  }
  for (const cr of creditRows) {
    if (cr.session_id == null) continue;
    const s = sessionById.get(String(cr.session_id));
    if (s && s.status !== 'granted') mismatches.push({ kind: 'credit_session_not_granted', ref: String(cr.transaction_id) });
  }
  for (const cb of callbackRows) {
    if (cb.outcome === 'granted' && !creditByTx.has(String(cb.transaction_id))) {
      mismatches.push({ kind: 'granted_callback_without_credit', ref: String(cb.transaction_id) });
    }
  }
  return {
    user_id: userPk,
    generated_at: now.toISOString(),
    balance: await readAdRewardStatus(db, userPk, { nowMs: now.getTime() }),
    sessions: sessionRows,
    callbacks: callbackRows,
    credits: creditRows,
    mismatches,
  };
}
