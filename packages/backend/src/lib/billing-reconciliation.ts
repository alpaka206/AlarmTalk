import type { Client, Row } from '@libsql/client';
import type { Env } from '../types';
import type { DbExecutor } from './transactions';
import { withWriteTransaction } from './transactions';
import {
  APPLE_SUBSCRIPTION_STATUS,
  applePlanKeyFromProductId,
  appleStoreKitConfigFromEnv,
  fetchAppleSubscriptionStatus,
  AppleTransactionNotFoundError,
} from './apple-storekit';
import {
  ENTITLED_STATES,
  getPlaySubscriptionV2,
  googlePaymentAnchor,
  googlePlanKeyFromProductId,
  selectAuthoritativeLineItem,
  isRecoverablePlayState,
} from './play-subscriptions';
import { applyStoreEntitlement, loadPlanByKey } from './store-billing';
import {
  type ActiveSubscription,
  cancelSubscriptionImmediate,
  createNewSubscriptionForPlan,
  hasActivePaidEntitlement,
  notifyBillingStateChanged,
  propagateGroupMemberPlans,
  resolvePlanAfterSuspend,
  schedulePaidVoiceRetention,
} from './billing-cancel';
import { sendPaymentFailedPush } from './fcm';
import { logStructured } from './logger';
import { planTypeToUserPlan } from '../routes/billing-helpers';

export class BillingStateUnavailableError extends Error {
  constructor(
    message = 'Store state could not be verified',
    /** 실제 유효/회복형 증거가 있으면 장애가 길어져도 강제 종료하지 않는다. */
    readonly allowForcedExpiry = true,
  ) {
    super(message);
    this.name = 'BillingStateUnavailableError';
  }
}

/** 더 최신 쓰기가 있는 경우는 시간 경과에 의한 강제 만료 대상도 아니다. */
export class BillingStateChangedError extends BillingStateUnavailableError {
  constructor(message = 'Subscription changed during verification') {
    super(message, false);
  }
}

type StoreState = {
  provider: 'apple' | 'google';
  transactionId: string;
  productId: string;
  planKey: string;
  action: 'entitle' | 'suspend' | 'expire';
  expiresAt: Date | null;
  paidAt: Date | undefined;
  autoRenew: boolean;
};

async function readSubscription(db: DbExecutor, id: string): Promise<Row | undefined> {
  return (
    await db.execute({
      sql: `SELECT s.*, p.key AS plan_key, p.plan_type, p.period_days,
                 g.owner_user_id AS group_owner_id
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          LEFT JOIN plan_groups g ON g.id = s.plan_group_id
          WHERE s.id = ?`,
      args: [id],
    })
  ).rows[0];
}

async function readTransactions(db: DbExecutor, id: string): Promise<Row[]> {
  return (
    await db.execute({
      sql: `SELECT id, provider, provider_transaction_id, product_id, subscription_id,
                 expires_at, last_paid_at FROM store_transactions
          WHERE subscription_id = ? ORDER BY id`,
      args: [id],
    })
  ).rows;
}

function finiteDate(value: string | number | undefined): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function fetchStoreState(
  env: Partial<Env>,
  transaction: Row,
  now: Date,
): Promise<StoreState> {
  const transactionId = String(transaction.provider_transaction_id);
  if (transaction.provider === 'apple') {
    const config = appleStoreKitConfigFromEnv(env);
    if (!config) throw new BillingStateUnavailableError('Apple billing is not configured');
    let status;
    try {
      status = await fetchAppleSubscriptionStatus(transactionId, config);
    } catch (error) {
      if (!(error instanceof AppleTransactionNotFoundError)) throw error;
      return {
        provider: 'apple',
        transactionId,
        productId: String(transaction.product_id),
        planKey: applePlanKeyFromProductId(String(transaction.product_id)) ?? '',
        action: 'expire',
        expiresAt: null,
        paidAt: undefined,
        autoRenew: false,
      };
    }
    const planKey = applePlanKeyFromProductId(status.productId);
    if (!planKey) throw new BillingStateUnavailableError('Unknown Apple subscription product');
    const expiresAt = finiteDate(
      status.status === APPLE_SUBSCRIPTION_STATUS.IN_GRACE_PERIOD
        ? status.gracePeriodExpiresDate
        : status.expiresDate,
    );
    let action: StoreState['action'];
    switch (status.status) {
      case APPLE_SUBSCRIPTION_STATUS.ACTIVE:
      case APPLE_SUBSCRIPTION_STATUS.IN_GRACE_PERIOD:
        if (!expiresAt || expiresAt <= now) throw new BillingStateUnavailableError();
        action = 'entitle';
        break;
      case APPLE_SUBSCRIPTION_STATUS.IN_BILLING_RETRY:
        action = 'suspend';
        break;
      case APPLE_SUBSCRIPTION_STATUS.EXPIRED:
      case APPLE_SUBSCRIPTION_STATUS.REVOKED:
        action = 'expire';
        break;
      default:
        throw new BillingStateUnavailableError('Unknown Apple subscription status');
    }
    const paidAt = finiteDate(status.purchaseDate) ?? undefined;
    if (action === 'entitle' && !paidAt)
      throw new BillingStateUnavailableError('Missing Apple purchase date', false);
    return {
      provider: 'apple',
      transactionId,
      productId: status.productId,
      planKey,
      action,
      expiresAt,
      paidAt,
      // 응답에 갱신 플래그가 없으면 다른 스토어의 구매를 허용하지 않는다.
      autoRenew: status.autoRenewStatus !== 0,
    };
  }
  if (transaction.provider !== 'google') throw new BillingStateUnavailableError('Unknown store');
  const sub = await getPlaySubscriptionV2(env, transactionId);
  const item = selectAuthoritativeLineItem(sub.lineItems);
  const expiresAt = finiteDate(item?.expiryTime);
  const state = sub.subscriptionState ?? '';
  let action: StoreState['action'];
  if (ENTITLED_STATES.has(state) || state === 'SUBSCRIPTION_STATE_CANCELED') {
    if (expiresAt && expiresAt > now) action = 'entitle';
    else if (state === 'SUBSCRIPTION_STATE_CANCELED') action = 'expire';
    else throw new BillingStateUnavailableError();
  } else if (isRecoverablePlayState(state)) action = 'suspend';
  else if (state === 'SUBSCRIPTION_STATE_EXPIRED') action = 'expire';
  else throw new BillingStateUnavailableError('Unknown Play subscription status');
  const productId = item?.productId ?? String(transaction.product_id);
  const planKey = googlePlanKeyFromProductId(productId);
  if (!planKey) {
    throw new BillingStateUnavailableError('Unknown Play subscription product');
  }
  let paidAt: Date | undefined;
  if (action === 'entitle') {
    try {
      paidAt = await googlePaymentAnchor(env, sub, transactionId);
    } catch {
      // 결제일 기록 실패는 방금 확인한 유효 권한의 반증이 아니다.
      throw new BillingStateUnavailableError('Play payment date unavailable', false);
    }
  }
  return {
    provider: 'google',
    transactionId,
    productId,
    planKey,
    action,
    expiresAt,
    paidAt,
    autoRenew:
      state !== 'SUBSCRIPTION_STATE_CANCELED' && item?.autoRenewingPlan?.autoRenewEnabled !== false,
  };
}

function asActive(row: Row): ActiveSubscription {
  return {
    subscriptionId: String(row.id),
    userPk: String(row.user_id),
    planId: String(row.plan_id),
    planKey: String(row.plan_key),
    planType: String(row.plan_type),
    planGroupId: row.plan_group_id == null ? null : String(row.plan_group_id),
    cancelAtPeriodEnd: Number(row.cancel_at_period_end) === 1,
  };
}

/** 스토어 I/O 는 락 밖, 상태 확인과 모든 파생 쓰기는 같은 쓰기 트랜잭션 안이다. */
export async function reconcileStoreSubscription(
  db: Client,
  env: Partial<Env>,
  subscriptionId: string,
  now = new Date(),
): Promise<'applied' | 'not_store'> {
  const before = await readSubscription(db, subscriptionId);
  if (!before || before.status !== 'active') return 'not_store';
  const transactions = await readTransactions(db, subscriptionId);
  if (transactions.length === 0) return 'not_store';
  const checked = await Promise.allSettled(transactions.map((t) => fetchStoreState(env, t, now)));
  const states = checked.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const failures = checked.filter((result) => result.status === 'rejected');
  const entitled = states
    .filter((state) => state.action === 'entitle')
    .sort((a, b) => b.expiresAt!.getTime() - a.expiresAt!.getTime())[0];
  if (!entitled && failures.length) {
    const protectedEvidence =
      states.some((state) => state.action === 'suspend') ||
      failures.some(
        (failure) =>
          failure.reason instanceof BillingStateUnavailableError &&
          !failure.reason.allowForcedExpiry,
      );
    throw new BillingStateUnavailableError('Store verification incomplete', !protectedEvidence);
  }
  const notifications = await withWriteTransaction(db, async (tx) => {
    const current = await readSubscription(tx, subscriptionId);
    const currentTransactions = await readTransactions(tx, subscriptionId);
    // 조회 중 새 플랜으로 교체되거나 더 최신 갱신이 반영됐으면 옛 응답은 재시도한다.
    if (
      JSON.stringify(current) !== JSON.stringify(before) ||
      JSON.stringify(currentTransactions) !== JSON.stringify(transactions)
    ) {
      throw new BillingStateChangedError('Subscription changed during verification');
    }
    const active = asActive(before);
    const ownerBefore = (
      await tx.execute({
        sql: 'SELECT plan FROM users WHERE id = ?',
        args: [active.userPk],
      })
    ).rows[0]?.plan;
    // 과거 데이터가 한 구독에 여러 스토어를 묶었어도 하나라도 살아 있으면 종료하지 않는다.
    if (entitled) {
      const hasOtherLiveEvidence = states.some(
        (state) => state !== entitled && state.action !== 'expire',
      );
      if (entitled.planKey !== before.plan_key && (failures.length || hasOtherLiveEvidence)) {
        // applyStoreEntitlement의 교체는 선택한 영수증만 새 구독에 연결한다.
        // 모두 조회에 성공해도 다른 유효/보류 증빙은 취소된 행에 남겨서는 안 된다.
        // 같은 스토어·같은 새 플랜·자동갱신 해제도 잔여 권한을 버릴 근거가 아니다.
        throw new BillingStateUnavailableError(
          'Plan replacement needs every other receipt to be terminated',
          false,
        );
      }
      const plan = await loadPlanByKey(tx, entitled.planKey);
      if (!plan) throw new BillingStateUnavailableError('Subscription plan is unavailable', false);
      const result = await applyStoreEntitlement(tx, {
        userPk: active.userPk,
        provider: entitled.provider,
        providerTransactionId: entitled.transactionId,
        productId: entitled.productId,
        plan,
        startsAt: entitled.paidAt ?? now,
        appliedAt: now,
        lastPaidAt: entitled.paidAt,
        expiresAt: entitled.expiresAt!,
      });
      if (!result.ok) throw new BillingStateUnavailableError(result.errorCode, false);
      const newId = result.subscription.id;
      const renewalMayContinue =
        failures.length > 0 || states.some((s) => s.action !== 'expire' && s.autoRenew);
      await tx.execute({
        sql: `UPDATE subscriptions SET cancel_at_period_end = ? WHERE id = ?`,
        args: [renewalMayContinue ? 0 : 1, newId],
      });
      const affected = new Set(result.planChangedUserIds);
      if (
        Date.parse(String(before.expires_at)) !== Date.parse(result.subscription.expires_at) ||
        ownerBefore !== planTypeToUserPlan(plan.plan_type) ||
        active.cancelAtPeriodEnd !== !renewalMayContinue
      ) {
        affected.add(active.userPk);
      }
      return { changed: [...affected], hold: null };
    }
    if (states.some((s) => s.action === 'suspend')) {
      await resolvePlanAfterSuspend(tx, active.userPk, subscriptionId);
      const members = active.planGroupId
        ? await propagateGroupMemberPlans(tx, active.planGroupId, active.userPk, true)
        : [];
      const ownerAfter = (
        await tx.execute({
          sql: 'SELECT plan FROM users WHERE id = ?',
          args: [active.userPk],
        })
      ).rows[0]?.plan;
      return {
        changed: [],
        hold: {
          ownerUserPk: ownerBefore !== ownerAfter ? active.userPk : null,
          memberUserPks: members,
        },
      };
    }
    const changed = await terminateSubscription(tx, before, now);
    return { changed, hold: null };
  });
  await notifyBillingStateChanged(db, env, notifications.changed);
  const hold = notifications.hold;
  const hasPush =
    (env.FIREBASE_PROJECT_ID && env.FIREBASE_SERVICE_ACCOUNT_JSON) ||
    (env.APNS_KEY_ID && env.APNS_PRIVATE_KEY && env.APPLE_TEAM_ID);
  if (hasPush && hold && (hold.ownerUserPk || hold.memberUserPks.length)) {
    try {
      await sendPaymentFailedPush(db, env, hold);
    } catch (error) {
      logStructured('warn', { at: 'billing.reconcile.hold_push', error: String(error) });
    }
  }
  return 'applied';
}

/** 외부 조회 이후 로컬 만료를 적용할 때도 최신 행과 그룹 소유자의 수명을 다시 검사한다. */
export async function expireSubscriptionIfDue(
  db: Client,
  id: string,
  expectedExpiry: string,
  now: Date,
  allowStore = true,
): Promise<string[]> {
  return withWriteTransaction(db, async (tx) => {
    const current = await readSubscription(tx, id);
    if (
      !current ||
      current.status !== 'active' ||
      String(current.expires_at) !== expectedExpiry ||
      !Number.isFinite(Date.parse(expectedExpiry)) ||
      new Date(expectedExpiry) > now
    )
      return [];
    if (current.group_owner_id && current.group_owner_id !== current.user_id) {
      const owner = await tx.execute({
        sql: `SELECT 1 FROM subscriptions WHERE user_id = ? AND plan_group_id = ? AND status = 'active'`,
        args: [String(current.group_owner_id), String(current.plan_group_id)],
      });
      if (owner.rows.length) return [];
    }
    if (!allowStore && (await readTransactions(tx, id)).length)
      throw new BillingStateChangedError();
    return terminateSubscription(tx, current, now);
  });
}

/** 로컬/스토어 종료가 공유하는 후속 전환. 만기 전 환불은 예약 플랜을 당겨 주지 않는다. */
async function terminateSubscription(tx: DbExecutor, current: Row, now: Date): Promise<string[]> {
  const active = asActive(current);
  const due =
    Number.isFinite(Date.parse(String(current.expires_at))) &&
    new Date(String(current.expires_at)) <= now;
  const ids = await cancelSubscriptionImmediate(tx, active, now, { deleteVoiceData: false });
  const nextPlan =
    due && Number(current.cancel_at_period_end) === 1 && current.next_plan_id
      ? (
          await tx.execute({
            sql: `SELECT id, plan_type, period_days, max_members FROM plans WHERE id = ? AND is_active = 1`,
            args: [String(current.next_plan_id)],
          })
        ).rows[0]
      : undefined;
  if (nextPlan) {
    await createNewSubscriptionForPlan(tx, {
      userPk: active.userPk,
      planId: String(nextPlan.id),
      planType: String(nextPlan.plan_type),
      periodDays: Number(nextPlan.period_days),
      maxMembers: Number(nextPlan.max_members),
      now,
    });
  } else if (!(await hasActivePaidEntitlement(tx, active.userPk))) {
    await schedulePaidVoiceRetention(tx, active.userPk, now);
  }
  return ids;
}

/** 결제 전에는 해당 계정과 그 계정에 이용권을 공유한 소유자의 상태까지 확인한다. */
export async function reconcileBillingPreflight(
  db: Client,
  env: Partial<Env>,
  userPk: string,
  now = new Date(),
): Promise<void> {
  const candidates = await db.execute({
    sql: `SELECT s.id FROM subscriptions s
          LEFT JOIN plan_groups g ON g.id = s.plan_group_id
          WHERE s.status = 'active' AND (s.user_id = ? OR s.user_id IN (
            SELECT g.owner_user_id FROM plan_groups g
            JOIN plan_group_members m ON m.plan_group_id = g.id WHERE m.user_id = ?
          )) ORDER BY CASE WHEN g.owner_user_id = s.user_id THEN 0 ELSE 1 END, s.id`,
    args: [userPk, userPk],
  });
  for (const row of candidates.rows) {
    const id = String(row.id);
    if ((await reconcileStoreSubscription(db, env, id, now)) === 'applied') continue;
    const current = await readSubscription(db, id);
    const affected = current
      ? await expireSubscriptionIfDue(db, id, String(current.expires_at), now, false)
      : [];
    await notifyBillingStateChanged(db, env, affected);
  }
}
