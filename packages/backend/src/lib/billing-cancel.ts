import type { Client } from '@libsql/client';
import { issueVoucherCode } from './voucher-issue';
import type { DbExecutor } from './transactions';
import { withWriteTransaction } from './transactions';
import { deletePaidVoiceDataForUser } from './paid-voice-cleanup';
import { logStructured } from './logger';
import {
  ENTITLED_STATES,
  getPlaySubscriptionV2,
  PlayBillingUnconfiguredError,
  type PlayEnv,
  type SubscriptionV2Response,
} from './play-subscriptions';
import { PAID_PLAN_TYPES, planTypeToUserPlan, plannedMaxUses } from '../routes/billing-helpers';

export interface ActiveSubscription {
  subscriptionId: string;
  userPk: string;
  planId: string;
  planType: string;
  planGroupId: string | null;
}

export async function findActiveSubscriptionByUserPk(
  db: DbExecutor,
  userPk: string,
): Promise<ActiveSubscription | null> {
  const subscriptions = await findActiveSubscriptionsByUserPk(db, userPk);
  return subscriptions[0] ?? null;
}

export async function findActiveSubscriptionsByUserPk(
  db: DbExecutor,
  userPk: string,
): Promise<ActiveSubscription[]> {
  const res = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id, p.plan_type
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.user_id = ? AND s.status = 'active'
          ORDER BY s.starts_at DESC`,
    args: [userPk],
  });
  return res.rows.map((r) => ({
    subscriptionId: String(r.sub_id),
    userPk: String(r.user_id),
    planId: String(r.plan_id),
    planType: String(r.plan_type),
    planGroupId: (r.plan_group_id as string | null) ?? null,
  }));
}

type CancelCleanupOptions = {
  deleteVoiceData?: boolean;
};

async function resolveUserLoginId(db: DbExecutor, userPk: string): Promise<string | null> {
  const res = await db.execute({
    sql: `SELECT google_id FROM users WHERE id = ? LIMIT 1`,
    args: [userPk],
  });
  return res.rows.length > 0 ? ((res.rows[0]!.google_id as string | null) ?? null) : null;
}

/** 해지/만료 후 유료 음성 데이터를 하드삭제 대신 보관하는 유예 기간(일). */
export const PAID_VOICE_RETENTION_DAYS = 30;

/**
 * 유료 음성 30일 보관을 예약(upsert)한다. 반환값은 delete_after ISO 문자열
 * (응답 voice_retention_until 로 그대로 내려줄 수 있게).
 * 재해지 시에는 마지막 해지 시점 기준 now+30일로 갱신한다(DO UPDATE) —
 * 그 사이 재구독으로 유예가 해제됐다가 다시 해지된 경우가 자연스럽게 처리된다.
 */
export async function schedulePaidVoiceRetention(
  db: DbExecutor,
  userPk: string,
  now: Date = new Date(),
): Promise<string> {
  const deleteAfter = new Date(
    now.getTime() + PAID_VOICE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  await db.execute({
    sql: `INSERT INTO paid_voice_retention (user_id, delete_after)
          VALUES (?, ?)
          ON CONFLICT(user_id) DO UPDATE SET delete_after = excluded.delete_after`,
    args: [userPk, deleteAfter],
  });
  return deleteAfter;
}

/** 재구독(스토어 entitlement/스텁 결제) 시 예약된 유료 음성 삭제를 해제한다. */
export async function clearPaidVoiceRetention(db: DbExecutor, userPk: string): Promise<void> {
  await db.execute({
    sql: `DELETE FROM paid_voice_retention WHERE user_id = ?`,
    args: [userPk],
  });
}

/**
 * 보관 유예가 끝난(delete_after 경과) 사용자들의 유료 음성 데이터를 삭제한다.
 * cron(processSubscriptionExpiry 말미)에서 호출. 사용자별 트랜잭션으로 처리해
 * 한 명 실패가 나머지를 막지 않게 한다.
 */
export async function sweepPaidVoiceRetention(db: Client, now: Date = new Date()): Promise<void> {
  const dueRes = await db.execute({
    sql: `SELECT user_id FROM paid_voice_retention WHERE delete_after <= ?`,
    args: [now.toISOString()],
  });
  for (const row of dueRes.rows) {
    const userPk = String(row.user_id);
    await withWriteTransaction(db, async (tx) => {
      // 경합 하드닝: delete_after 조건을 다시 걸어 보관 행을 트랜잭션 안에서 선점 삭제한다.
      // 위 목록 조회와 이 트랜잭션 사이에 재해지/연장으로 delete_after 가 미래로 밀렸다면
      // rowsAffected=0 → 유예가 아직 남아 있으므로 음성 삭제를 스킵한다(다음 run 재평가).
      const claimed = await tx.execute({
        sql: `DELETE FROM paid_voice_retention WHERE user_id = ? AND delete_after <= ?`,
        args: [userPk, now.toISOString()],
      });
      if (claimed.rowsAffected === 0) return;
      // 재구독 안전망: 어떤 경로로든(스토어/바우처/프로모) 유료 구독이 되살아났는데
      // 보관 행 해제가 누락됐다면, 음성은 삭제하지 않고 행만 거둔다.
      const activeRes = await tx.execute({
        sql: `SELECT s.id FROM subscriptions s JOIN plans p ON p.id = s.plan_id
              WHERE s.user_id = ? AND s.status = 'active'
                AND p.plan_type IN ('personal', 'family')
              LIMIT 1`,
        args: [userPk],
      });
      if (activeRes.rows.length === 0) {
        await deletePaidVoiceDataForUser(tx, userPk, await resolveUserLoginId(tx, userPk));
      }
    });
  }
}

export async function downgradeUserToFree(
  db: DbExecutor,
  userPk: string,
  options: CancelCleanupOptions = {},
): Promise<void> {
  await db.execute({
    sql: `UPDATE users SET plan = 'free', updated_at = datetime('now') WHERE id = ?`,
    args: [userPk],
  });
  if (options.deleteVoiceData === true) {
    await deletePaidVoiceDataForUser(db, userPk, await resolveUserLoginId(db, userPk));
    return;
  }
  // voice_profiles.user_id·alarms.user_id 는 로그인 id(google_id)로 저장되므로 PK(userPk)와
  // 로그인 id 를 모두 매칭한다(deletePaidVoiceDataForUser 와 동일 — 한쪽만 쓰면 일반 케이스를
  // 놓쳐 un-share·강등이 누락되고 취소된 목소리가 좀비로 계속 울린다).
  const loginId = await resolveUserLoginId(db, userPk);
  const ownerIds = Array.from(new Set([userPk, loginId].filter((x): x is string => Boolean(x))));
  const ph = ownerIds.map(() => '?').join(',');
  await db.execute({
    sql: `UPDATE voice_profiles SET is_shared = 0 WHERE user_id IN (${ph}) AND is_shared = 1`,
    args: ownerIds,
  });
  // 공유가 해제되면(강등/RTDN 비활성) 그 목소리를 참조하던 '타인 소유' 알람은 접근권을 잃으므로
  // sound-only 로 강등한다 — 취소된 목소리가 좀비로 계속 울리지 않도록. (클라는 재동기화 시 반영)
  await db.execute({
    sql: `UPDATE alarms
          SET mode = 'sound-only',
              wake_mode = 'sound_then_voice',
              message_id = NULL,
              voice_profile_id = NULL,
              speaker_id = NULL,
              raw_audio_url = NULL,
              raw_audio_duration_ms = NULL
          WHERE user_id NOT IN (${ph})
            AND (
              voice_profile_id IN (
                SELECT id FROM voice_profiles WHERE user_id IN (${ph})
              )
              OR message_id IN (
                SELECT id FROM messages
                WHERE voice_profile_id IN (
                  SELECT id FROM voice_profiles WHERE user_id IN (${ph})
                )
              )
            )`,
    args: [...ownerIds, ...ownerIds, ...ownerIds],
  });
}

async function expireUnusedVouchersFor(db: DbExecutor, subscriptionId: string): Promise<void> {
  await db.execute({
    sql: `UPDATE voucher_codes SET status = 'expired'
          WHERE issuer_subscription_id = ? AND status = 'issued'`,
    args: [subscriptionId],
  });
}

async function releaseInviteUseForMember(
  db: DbExecutor,
  userPk: string,
  planGroupId: string,
): Promise<void> {
  const redemptionRes = await db.execute({
    sql: `SELECT vr.id AS redemption_id, vr.voucher_id
          FROM voucher_redemptions vr
          JOIN voucher_codes v ON v.id = vr.voucher_id
          JOIN subscriptions s ON s.id = v.issuer_subscription_id
          WHERE vr.user_id = ? AND s.plan_group_id = ?`,
    args: [userPk, planGroupId],
  });

  for (const row of redemptionRes.rows) {
    const redemptionId = String(row.redemption_id);
    const voucherId = String(row.voucher_id);

    await db.execute({
      sql: `DELETE FROM voucher_redemptions WHERE id = ?`,
      args: [redemptionId],
    });

    await db.execute({
      sql: `UPDATE voucher_codes
            SET status = 'issued',
                used_at = NULL
            WHERE id = ?
              AND status = 'used'
              AND (SELECT COUNT(*) FROM voucher_redemptions WHERE voucher_id = ?) < COALESCE(max_uses, 1)`,
      args: [voucherId, voucherId],
    });
  }
}

/**
 * 구독 행 한 건을 취소 상태로 바꾸고, 그 구독이 발급한 미사용 코드를 만료시킨다.
 * 사용자 plan 정리는 여기서 하지 않는다 — 호출자가 그 사용자의 구독 취소를 모두
 * 마친 뒤 syncUserPlanAfterCancel 로 마무리한다(구독별 중복 강등 방지).
 */
async function cancelOneSubscriptionRow(
  db: DbExecutor,
  subscriptionId: string,
  now: Date,
): Promise<void> {
  await db.execute({
    sql: `UPDATE subscriptions
          SET status = 'cancelled',
              canceled_at = ?,
              expires_at = ?,
              updated_at = datetime('now')
          WHERE id = ? AND status = 'active'`,
    args: [now.toISOString(), now.toISOString(), subscriptionId],
  });
  await expireUnusedVouchersFor(db, subscriptionId);
}

/**
 * 구독 취소 후 사용자 plan 을 "실제 남은 활성 구독" 기준으로 재정렬한다 (E2).
 * 부분 취소(/cancel 의 스냅샷 단위 취소, RTDN 스테일/단일 토큰 만료 처리 등)에서
 * 다른 활성 유료 구독이 남아 있으면 free 로 내리지 않고 그 구독의 plan 으로 유지하며,
 * is_shared 해제·타인 알람 강등 같은 음성 접근 정리도 하지 않는다(여전히 유료다).
 * 남은 활성 유료 구독이 없을 때만 free 강등 + 접근 정리를 수행한다.
 */
async function syncUserPlanAfterCancel(
  db: DbExecutor,
  userPk: string,
  options: CancelCleanupOptions = {},
): Promise<void> {
  const remaining = await findActiveSubscriptionsByUserPk(db, userPk);
  // 조회가 starts_at DESC 정렬이므로 가장 최근 유료 구독이 우선된다.
  const paid = remaining.find((s) => PAID_PLAN_TYPES.has(s.planType));
  if (paid) {
    await db.execute({
      sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [planTypeToUserPlan(paid.planType), userPk],
    });
    return;
  }
  await downgradeUserToFree(db, userPk, options);
}

// 결제 해지/만료 흐름의 기본은 "음성 보존"이다. 하드 삭제는 보관 유예(sweep)나
// 계정 삭제(account-deletion) 같은 명시적 경로에서만 deleteVoiceData:true 로 요청한다.
export async function cancelSubscriptionImmediate(
  db: DbExecutor,
  subscription: ActiveSubscription,
  now: Date = new Date(),
  options: CancelCleanupOptions = { deleteVoiceData: false },
): Promise<void> {
  await cancelOneSubscriptionRow(db, subscription.subscriptionId, now);
  await syncUserPlanAfterCancel(db, subscription.userPk, options);

  if (!subscription.planGroupId) return;

  const groupRes = await db.execute({
    sql: `SELECT owner_user_id FROM plan_groups WHERE id = ?`,
    args: [subscription.planGroupId],
  });
  const ownerUserId =
    groupRes.rows.length > 0 ? String(groupRes.rows[0]!.owner_user_id) : null;

  if (ownerUserId !== subscription.userPk) {
    await db.execute({
      sql: `DELETE FROM plan_group_members WHERE plan_group_id = ? AND user_id = ?`,
      args: [subscription.planGroupId, subscription.userPk],
    });
    await releaseInviteUseForMember(db, subscription.userPk, subscription.planGroupId);
    return;
  }

  const memberRes = await db.execute({
    sql: `SELECT user_id, role FROM plan_group_members WHERE plan_group_id = ?`,
    args: [subscription.planGroupId],
  });
  for (const row of memberRes.rows) {
    const memberUserId = String(row.user_id);
    if (memberUserId === subscription.userPk) continue;

    const memberSubRes = await db.execute({
      sql: `SELECT id FROM subscriptions
            WHERE user_id = ? AND status = 'active' AND plan_group_id = ?`,
      args: [memberUserId, subscription.planGroupId],
    });
    for (const subRow of memberSubRes.rows) {
      await cancelOneSubscriptionRow(db, String(subRow.id), now);
    }
    // 멤버 강등에는 소유자의 삭제 옵션(options)을 전파하지 않는다. 취소를 개시하지
    // 않은 멤버의 알람·음성·메시지가 하드 삭제되는 것을 막기 위해 데이터는 보존한다
    // (RTDN deactivate 경로와 동일하게 deleteVoiceData:false). 하드 삭제는 취소를
    // 실제로 개시한 소유자 본인에게만 국한한다.
    await syncUserPlanAfterCancel(db, memberUserId, { deleteVoiceData: false });
    // 소유자 해지로 유료 접근을 잃는 멤버도 소유자와 동일 정책으로 유료 음성 30일
    // 보관을 예약한다 — 예약이 없으면 멤버의 유료 음성이 sweep 대상에서 빠져 영구
    // 잔존한다. 멤버가 자기 결제로 재구독하면 entitle/redeem 경로가 유예를 해제하고,
    // sweep 도 삭제 직전에 활성 유료 구독을 재확인하므로 과삭제 위험은 없다.
    await schedulePaidVoiceRetention(db, memberUserId, now);
  }

  await db.execute({
    sql: `DELETE FROM plan_group_members WHERE plan_group_id = ?`,
    args: [subscription.planGroupId],
  });
}

export async function cancelActiveSubscriptionsForUser(
  db: DbExecutor,
  userPk: string,
  now: Date = new Date(),
  options: CancelCleanupOptions = { deleteVoiceData: false },
): Promise<ActiveSubscription[]> {
  const subscriptions = await findActiveSubscriptionsByUserPk(db, userPk);
  for (const subscription of subscriptions) {
    await cancelSubscriptionImmediate(db, subscription, now, options);
  }
  return subscriptions;
}

export async function leavePlanGroupMember(
  db: DbExecutor,
  params: {
    userPk: string;
    planGroupId: string;
    membershipId: string;
    now?: Date;
  },
): Promise<void> {
  const now = params.now ?? new Date();

  const subscriptionRes = await db.execute({
    sql: `SELECT id FROM subscriptions
          WHERE user_id = ? AND status = 'active' AND plan_group_id = ?`,
    args: [params.userPk, params.planGroupId],
  });

  await db.execute({
    sql: `DELETE FROM plan_group_members WHERE id = ?`,
    args: [params.membershipId],
  });

  for (const row of subscriptionRes.rows) {
    await cancelOneSubscriptionRow(db, String(row.id), now);
  }
  // 그룹 구독 유무와 무관하게 남은 활성 구독 기준으로 plan 을 재정렬한다
  // (다른 유료 구독이 남아 있으면 유지, 없으면 free 강등 + 음성 접근 정리).
  await syncUserPlanAfterCancel(db, params.userPk, { deleteVoiceData: false });
  // 그룹 이탈로 유료 접근을 잃어도 음성은 즉시 삭제하지 않고 30일 보관 유예를 건다.
  await schedulePaidVoiceRetention(db, params.userPk, now);

  await releaseInviteUseForMember(db, params.userPk, params.planGroupId);
}

export async function scheduleCancelAtPeriodEnd(
  db: DbExecutor,
  subscriptionId: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE subscriptions
          SET cancel_at_period_end = 1, next_plan_id = NULL, updated_at = datetime('now')
          WHERE id = ?`,
    args: [subscriptionId],
  });
}

export async function schedulePlanChangeAtPeriodEnd(
  db: DbExecutor,
  subscriptionId: string,
  nextPlanId: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE subscriptions
          SET cancel_at_period_end = 1, next_plan_id = ?, updated_at = datetime('now')
          WHERE id = ?`,
    args: [nextPlanId, subscriptionId],
  });
}

export async function createNewSubscriptionForPlan(
  db: DbExecutor,
  params: {
    userPk: string;
    planId: string;
    planType: string;
    periodDays: number;
    maxMembers: number;
    now: Date;
  },
): Promise<string> {
  const startsAt = params.now;
  const expiresAt = new Date(startsAt.getTime() + params.periodDays * 24 * 60 * 60 * 1000);
  const subscriptionId = crypto.randomUUID();
  let planGroupId: string | null = null;

  if (params.planType === 'family') {
    planGroupId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members)
            VALUES (?, ?, ?, ?)`,
      args: [planGroupId, params.userPk, params.planId, params.maxMembers],
    });
    await db.execute({
      sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
            VALUES (?, ?, ?, 'owner')`,
      args: [crypto.randomUUID(), planGroupId, params.userPk],
    });
  }

  await db.execute({
    sql: `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
          VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    args: [
      subscriptionId,
      params.userPk,
      params.planId,
      planGroupId,
      startsAt.toISOString(),
      expiresAt.toISOString(),
    ],
  });

  await db.execute({
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [planTypeToUserPlan(params.planType), params.userPk],
  });

  if (params.planType === 'family') {
    await issueVoucherCode(db, {
      kind: 'invite',
      planId: params.planId,
      issuerUserId: params.userPk,
      issuerSubscriptionId: subscriptionId,
      issuedAt: startsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      maxUses: plannedMaxUses(params.planType, params.maxMembers),
    });
  }

  return subscriptionId;
}

/**
 * RTDN 유실 대비 reconciliation — 만료 처리 직전에 Play 실상태를 재조회한다.
 *  - 'expire': 정상 만료 진행 (google 결제 아님 / env 미설정 / Play 도 만료 판정)
 *  - 'skip'  : 이번 run 은 건드리지 않음 (Play 가 아직 유효 → 만료를 연장했거나,
 *              일시 장애로 판정 불가 → 다음 run 재시도)
 */
async function reconcileGoogleBeforeExpiry(
  db: Client,
  env: PlayEnv | undefined,
  params: {
    subscriptionId: string;
    userPk: string;
    planType: string;
    expiresAt: string;
    now: Date;
  },
): Promise<'expire' | 'skip'> {
  const txnRes = await db.execute({
    sql: `SELECT provider_transaction_id FROM store_transactions
          WHERE subscription_id = ? AND provider = 'google'`,
    args: [params.subscriptionId],
  });
  if (txnRes.rows.length === 0) return 'expire';
  const purchaseToken = String(txnRes.rows[0]!.provider_transaction_id);

  let subscription: SubscriptionV2Response;
  try {
    subscription = await getPlaySubscriptionV2(env ?? {}, purchaseToken);
  } catch (err) {
    // env 미설정(dev/테스트) — 재조회 없이 현행대로 만료 진행.
    if (err instanceof PlayBillingUnconfiguredError) return 'expire';
    // 일시 장애(네트워크/OAuth/5xx) — 이번 run 은 만료를 보류하고 다음 run 에 재시도.
    // 단 만료 시각이 72시간 넘게 지났으면 조회 실패여도 만료를 강행한다(영구 좀비 방지).
    const expiredMs = new Date(params.expiresAt).getTime();
    const staleLimitMs = params.now.getTime() - 72 * 60 * 60 * 1000;
    const forceExpire = Number.isFinite(expiredMs) && expiredMs <= staleLimitMs;
    logStructured('warn', {
      at: 'billing.expiry.reconcile',
      subscriptionId: params.subscriptionId,
      error: String(err),
      forceExpire,
    });
    return forceExpire ? 'expire' : 'skip';
  }

  const lineItem = subscription.lineItems?.[0];
  const expiryMs = lineItem?.expiryTime ? new Date(lineItem.expiryTime).getTime() : NaN;
  const state = subscription.subscriptionState ?? '';
  // RTDN 경로(decideSubscriptionAction)와 동일 규칙: CANCELED(기간종료 해지 예약)도
  // 만료 전까지는 유료 권한이 유지된다. ENTITLED_STATES(ACTIVE/GRACE)만 보면
  // 기간종료 해지 후 만료 전 구독을 cron 이 조기 강등해 버린다.
  const stillEntitled =
    (ENTITLED_STATES.has(state) || state === 'SUBSCRIPTION_STATE_CANCELED') &&
    Number.isFinite(expiryMs) &&
    expiryMs > params.now.getTime();
  if (!stillEntitled) return 'expire';

  // RTDN(갱신 알림) 유실 — Play 는 아직 유효하다. 만료 처리 대신 Play 권위값으로
  // 연장한다 (applyStoreEntitlement 갱신 분기와 동일 규칙: 구독·스토어 트랜잭션·
  // 공유 코드 만료 연장 + users.plan 유지).
  const expiryIso = new Date(expiryMs).toISOString();
  const autoRenew = lineItem?.autoRenewingPlan?.autoRenewEnabled === true;
  // CANCELED 이거나 autoRenewEnabled=false 면 기간종료 해지가 예약된 상태 —
  // cancel_at_period_end=1 로 세워 만기 도래 시 조용히 만료되게 한다.
  const cancelAtPeriodEnd =
    state === 'SUBSCRIPTION_STATE_CANCELED' || !autoRenew ? 1 : 0;
  await withWriteTransaction(db, async (tx) => {
    await tx.execute({
      sql: `UPDATE subscriptions
            SET expires_at = ?, status = 'active', cancel_at_period_end = ?,
                updated_at = datetime('now')
            WHERE id = ?`,
      args: [expiryIso, cancelAtPeriodEnd, params.subscriptionId],
    });
    await tx.execute({
      sql: `UPDATE voucher_codes SET expires_at = ?
            WHERE issuer_subscription_id = ? AND status IN ('issued', 'used')`,
      args: [expiryIso, params.subscriptionId],
    });
    await tx.execute({
      sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [planTypeToUserPlan(params.planType), params.userPk],
    });
    await tx.execute({
      sql: `UPDATE store_transactions SET expires_at = ?
            WHERE provider = 'google' AND provider_transaction_id = ?`,
      args: [expiryIso, purchaseToken],
    });
  });
  logStructured('info', {
    at: 'billing.expiry.reconcile',
    action: 'extended',
    subscriptionId: params.subscriptionId,
    expiresAt: expiryIso,
    autoRenew,
  });
  return 'skip';
}

export async function processSubscriptionExpiry(
  db: Client,
  env?: PlayEnv,
  now: Date = new Date(),
): Promise<void> {
  const dueRes = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id, s.next_plan_id,
                 s.expires_at, p.plan_type
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.status = 'active'
            AND s.cancel_at_period_end = 1
            AND s.expires_at <= ?`,
    args: [now.toISOString()],
  });
  for (const r of dueRes.rows) {
    const active = {
      subscriptionId: String(r.sub_id),
      userPk: String(r.user_id),
      planId: String(r.plan_id),
      planType: String(r.plan_type),
      planGroupId: (r.plan_group_id as string | null) ?? null,
    };
    const nextPlanId = (r.next_plan_id as string | null) ?? null;

    // 만료 처리 전에 Play 실상태 재조회 — RTDN 을 놓쳐 DB 만료가 뒤처진 경우
    // 즉시 해지 대신 연장한다.
    const decision = await reconcileGoogleBeforeExpiry(db, env, {
      subscriptionId: active.subscriptionId,
      userPk: active.userPk,
      planType: active.planType,
      expiresAt: String(r.expires_at ?? ''),
      now,
    });
    if (decision === 'skip') continue;

    await withWriteTransaction(db, async (tx) => {
      await cancelSubscriptionImmediate(tx, active, now, { deleteVoiceData: false });

      if (!nextPlanId) {
        // 예약취소 만료 — 음성은 즉시 삭제하지 않고 30일 보관 유예를 건다.
        await schedulePaidVoiceRetention(tx, active.userPk, now);
        return;
      }
      const nextPlanRes = await tx.execute({
        sql: `SELECT id, plan_type, period_days, max_members
              FROM plans WHERE id = ? AND is_active = 1`,
        args: [nextPlanId],
      });
      if (nextPlanRes.rows.length === 0) return;

      const nextPlan = nextPlanRes.rows[0]!;
      await createNewSubscriptionForPlan(tx, {
        userPk: active.userPk,
        planId: String(nextPlan.id),
        planType: String(nextPlan.plan_type),
        periodDays: Number(nextPlan.period_days) || 30,
        maxMembers: Number(nextPlan.max_members) || 1,
        now,
      });
    });
  }

  const expiredRes = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id, s.expires_at, p.plan_type
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.status = 'active' AND s.expires_at <= ? AND s.cancel_at_period_end = 0`,
    args: [now.toISOString()],
  });
  for (const r of expiredRes.rows) {
    const subscriptionId = String(r.sub_id);
    const userPk = String(r.user_id);
    const planType = String(r.plan_type);

    const decision = await reconcileGoogleBeforeExpiry(db, env, {
      subscriptionId,
      userPk,
      planType,
      expiresAt: String(r.expires_at ?? ''),
      now,
    });
    if (decision === 'skip') continue;

    await withWriteTransaction(db, async (tx) => {
      await cancelSubscriptionImmediate(
        tx,
        {
          subscriptionId,
          userPk,
          planId: String(r.plan_id),
          planType,
          planGroupId: (r.plan_group_id as string | null) ?? null,
        },
        now,
        { deleteVoiceData: false },
      );
      // 일반 만료도 하드삭제 대신 30일 보관 유예.
      await schedulePaidVoiceRetention(tx, userPk, now);
    });
  }

  // 보관 유예가 끝난 유료 음성 데이터 정리 (같은 cron 주기에서 처리).
  await sweepPaidVoiceRetention(db, now);
}

export { planTypeToUserPlan };
