import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { personalPromoCoversFree } from '../lib/personal-promo';
import {
  cancelActiveSubscriptionsForUser,
  cancelSubscriptionImmediate,
  clearPaidVoiceRetention,
  findActiveSubscriptionsByUserPk,
  findStoreTransactionsForSubscriptions,
  scheduleCancelAtPeriodEnd,
  syncPaidVoiceRetention,
  storeCancelProviderOf,
  notifyBillingStateChanged,
} from '../lib/billing-cancel';
import { APPLE_MANAGE_SUBSCRIPTIONS_URL } from '../lib/store-billing';
import { logStructured } from '../lib/logger';
import {
  playCancelSubscription,
  playManageUrl,
  playRevokeSubscription,
} from '../lib/play-subscriptions';
import type { DbExecutor } from '../lib/transactions';
import { withWriteTransaction } from '../lib/transactions';
import { PAID_PLAN_TYPES, planTypeToUserPlan, resolveUserPk } from './billing-helpers';
import { jsonError } from '../lib/api-error';

const billingMutation = new Hono<AppEnv>();

interface BillablePlan {
  id: string;
  key: string;
  name: string;
  plan_type: string;
  period_days: number;
  price_krw: number;
}

interface CreatedSubscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: 'active';
  starts_at: string;
  expires_at: string;
}

function isBillingStubEnabled(env: Partial<AppEnv['Bindings']> | undefined): boolean {
  // production 에서는 BILLING_STUB_ENABLED 값과 무관하게 항상 비활성한다.
  // (env 오설정 하나로 /checkout·/change-plan 이 무결제 유료지급 디스펜서가 되는 것 차단.)
  if (env?.ENVIRONMENT === 'production') return false;
  if (env?.BILLING_STUB_ENABLED === 'true' || env?.BILLING_STUB_ENABLED === '1') return true;
  if (env?.BILLING_STUB_ENABLED === 'false' || env?.BILLING_STUB_ENABLED === '0') return false;
  return env?.ENVIRONMENT !== 'production';
}

function checkoutDisabledResponse() {
  return {
    error: 'Checkout is disabled for this build.',
    error_code: 'CHECKOUT_DISABLED',
  };
}

function normalizeBillablePlan(row: Record<string, unknown>): BillablePlan {
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    plan_type: String(row.plan_type),
    period_days: Number(row.period_days) || 30,
    price_krw: Number(row.price_krw) || 0,
  };
}

function planResponse(plan: BillablePlan) {
  return {
    id: plan.id,
    key: plan.key,
    name: plan.name,
    plan_type: plan.plan_type,
    period_days: plan.period_days,
    price_krw: plan.price_krw,
  };
}

async function createPaidSubscription(
  db: DbExecutor,
  params: {
    userPk: string;
    plan: BillablePlan;
    startsAt: Date;
  },
): Promise<CreatedSubscription> {
  const startsAtIso = params.startsAt.toISOString();
  const expiresAt = new Date(
    params.startsAt.getTime() + params.plan.period_days * 24 * 60 * 60 * 1000,
  );
  const expiresAtIso = expiresAt.toISOString();
  const subscriptionId = crypto.randomUUID();

  await db.execute({
    sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
          VALUES (?, ?, ?, 'active', ?, ?)`,
    args: [subscriptionId, params.userPk, params.plan.id, startsAtIso, expiresAtIso],
  });

  await db.execute({
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [planTypeToUserPlan(params.plan.plan_type), params.userPk],
  });

  // 재구독(스텁 결제 성공) — 예약된 유료 음성 보관 삭제를 해제한다.
  await clearPaidVoiceRetention(db, params.userPk);

  return {
    id: subscriptionId,
    user_id: params.userPk,
    plan_id: params.plan.id,
    status: 'active',
    starts_at: startsAtIso,
    expires_at: expiresAtIso,
  };
}

billingMutation.post('/checkout', async (c) => {
  if (!isBillingStubEnabled(c.env)) {
    return c.json(checkoutDisabledResponse(), 409);
  }

  const db = getDB(c.env);

  const body = await c.req
    .json<{ plan_key?: unknown; gift?: unknown }>()
    .catch((): { plan_key?: unknown; gift?: unknown } => ({
      plan_key: undefined,
      gift: undefined,
    }));

  // ⚠ **선물 결제(`gift: true`)는 2026-10-14 에 없앴다 — 되살리지 말 것**(App Store 심사 지침 3.1.1,
  //   두 번째 반려 — `routes/code.ts` 머리말). 받는 사람이 코드를 쳐서 유료 기능을 여는 선물 코드를
  //   찍어 내던 갈래다 — dev 스텁이라도 남겨 두면 발급 경로가 하나 살아 있는 셈이라, 아무것도 읽기
  //   전에 거절한다. 할인·무료 이용은 스토어 오퍼 코드로 준다.
  if (body.gift === true) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'Gift checkout is no longer available');
  }

  const planKey = typeof body.plan_key === 'string' ? body.plan_key.trim() : '';
  if (!planKey) {
    return c.json({ error: 'plan_key is required', error_code: 'PLAN_KEY_REQUIRED' }, 400);
  }

  const planRes = await db.execute({
    sql: `SELECT id, key, name, plan_type, period_days, price_krw, is_active
          FROM plans WHERE key = ?`,
    args: [planKey],
  });
  if (planRes.rows.length === 0) {
    return c.json({ error: 'Plan not found', error_code: 'PLAN_NOT_FOUND' }, 400);
  }
  const plan = planRes.rows[0]!;
  if (Number(plan.is_active) !== 1) {
    return c.json({ error: 'Plan is inactive', error_code: 'PLAN_INACTIVE' }, 400);
  }

  const planType = String(plan.plan_type);
  if (!PAID_PLAN_TYPES.has(planType)) {
    return c.json({ error: 'Free plan is not billable', error_code: 'FREE_NOT_BILLABLE' }, 400);
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const billablePlan = normalizeBillablePlan(plan);
  const subscription = await withWriteTransaction(db, async (tx) => {
    const startsAt = new Date();
    await cancelActiveSubscriptionsForUser(tx, userPk, startsAt, { deleteVoiceData: false });

    return createPaidSubscription(tx, {
      userPk,
      plan: billablePlan,
      startsAt,
    });
  });

  return c.json({
    success: true,
    checkout_stub: true,
    subscription,
    plan: planResponse(billablePlan),
  });
});

// ⚠ **운영자가 코드를 찍어 내던 dev 라우트 `POST /billing/test-codes` 는 2026-10-14 에 지웠다 — 되살리지 말 것.**
//   App Store 심사 지침 3.1.1 이 '코드로 유료 기능을 연다' 를 두 번 반려했다(1.2.11 프로모 코드, 1.2.12 선물
//   코드 — `routes/code.ts` 머리말). 테스트 계정의 이용권은 `scripts/apply-dev-plan.ts` 로, 할인·무료 이용은
//   스토어 오퍼 코드로 준다.

// MARK: - POST /billing/cancel
//
// 구독 해지. mode=at_period_end(기간종료 해지) | immediate(즉시 해지·비례 환불).
// 스토어(Google Play) 결제 구독이면 **Play 성공을 확인하기 전에는 로컬 DB·음성
// 데이터를 절대 변경하지 않는다** — Play 호출 실패 시 502 + manage_url 로 스토어
// 직접 관리 화면을 안내한다.
// 어느 경로든 즉시 해지 시 유료 음성은 하드삭제 대신 보관 유예(PAID_VOICE_RETENTION_DAYS)를 건다.
billingMutation.post('/cancel', async (c) => {
  const body = await c.req
    .json<{ mode?: unknown }>()
    .catch((): { mode?: unknown } => ({ mode: undefined }));
  // mode 화이트리스트: 누락/오타가 조용히 immediate(= Play revoke + 비례 환불)로
  // 떨어지면 의도치 않은 환불·즉시 권한 상실이 생기므로 두 값 외에는 400 으로 거절한다.
  // (Android 클라는 항상 명시적으로 "at_period_end" | "immediate" 를 보낸다.)
  const mode = body.mode;
  if (mode !== 'at_period_end' && mode !== 'immediate') {
    return c.json(
      {
        error: 'mode must be "at_period_end" or "immediate"',
        error_code: 'INVALID_CANCEL_MODE',
      },
      400,
    );
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const db = getDB(c.env);
  const activeSubscriptions = await findActiveSubscriptionsByUserPk(db, userPk);
  const active = activeSubscriptions[0] ?? null;
  if (!active) {
    return c.json(
      { error: 'No active subscription', error_code: 'NO_ACTIVE_SUBSCRIPTION' },
      404,
    );
  }

  // 활성 구독들이 어느 스토어 결제에 묶여 있는지 확인. 없으면 dev 스텁/프로모
  // 구독이므로 서버 로컬 해지만 수행한다. 다중 활성 구독이 각각 다른 Play 토큰에 묶인
  // 엣지 케이스까지 전부 조회한다 — 첫 구독 토큰만 취소하면 나머지 토큰이 계속 과금된다.
  // (IN 플레이스홀더는 개발자 고정 조각 — 값은 전부 ?-바인딩.)
  const subIds = activeSubscriptions.map((s) => s.subscriptionId);
  const storeTxns = await findStoreTransactionsForSubscriptions(db, subIds);

  // ⚠ **애플 결제 구독은 서버가 해지할 수 없다 — 여기서 막는다.**
  //
  // App Store Server API 에는 Play 의 `purchases.subscriptions.cancel` 에 해당하는
  // 것이 없다. 자동갱신 구독은 사용자가 App Store 구독 관리 화면에서 직접 끊어야 한다.
  // 그런데 아래 Play 처리는 `provider === 'google'` 만 보므로, 애플 트랜잭션은 스토어
  // 호출 없이 **로컬 DB 만 취소**되고 200 이 나갔다 — 앱은 "이용권을 해지했어요" 를
  // 띄우는데 **Apple 은 계속 과금한다.** 권한은 잃고 돈은 나가는, 가장 나쁜 조합이다.
  //
  // Play 실패 갈래와 같은 모양으로 낸다(무변경 + manage_url). 안드로이드 클라의
  // `STORE_MANAGE_REQUIRED_CODES` 에 이미 이 코드가 들어 있고, iOS 는 이 코드를 받으면
  // StoreKit 관리 시트를 연다.
  // ⚠ 판정은 `storeCancelProviderOf` 하나다 — `GET /billing/subscription` 이 앱에
  // 알려 주는 값이 여기서 나오는 답과 **같아야** 한다(두 곳에 적으면 갈라진다).
  if (storeCancelProviderOf(storeTxns) === 'apple') {
    return c.json(
      {
        error: 'App Store subscriptions must be cancelled in the App Store',
        error_code: 'STORE_CANCEL_UNSUPPORTED',
        manage_url: APPLE_MANAGE_SUBSCRIPTIONS_URL,
      },
      409,
    );
  }

  // 같은 토큰이 여러 구독 행에 걸쳐 있어도 Play 호출은 토큰당 한 번만 한다.
  const googleTxns = new Map<string, { purchaseToken: string; productId: string }>();
  for (const txn of storeTxns) {
    if (txn.provider === 'google') googleTxns.set(txn.purchaseToken, txn);
  }

  const now = new Date();

  if (mode === 'at_period_end') {
    // Play 자동갱신 해제가 먼저다. 모든 토큰이 성공해야만 DB 를 바꾼다 — 하나라도
    // 실패하면 502 + DB 무변경. 로컬만 예약취소 상태가 되면 Play 는 다음 결제일에
    // 그대로 과금해 상태가 갈라진다. 이미 성공한 토큰이 있어도 안전하다:
    // play-subscriptions.ts 의 수렴 처리(이미 취소된 토큰 재시도는 성공 간주) 덕에
    // 사용자가 재시도하면 성공분은 그대로 성공으로 수렴해 전체가 완결된다.
    for (const txn of googleTxns.values()) {
      try {
        await playCancelSubscription(c.env, txn.purchaseToken);
      } catch (err) {
        logStructured('error', { at: 'billing.cancel.play_cancel', error: String(err) });
        return c.json(
          {
            error: 'Failed to cancel the Google Play subscription',
            error_code: 'PLAY_CANCEL_FAILED',
            manage_url: playManageUrl(txn.productId, c.env.ANDROID_PACKAGE_NAME),
          },
          502,
        );
      }
    }
    await withWriteTransaction(db, async (tx) => {
      for (const subscription of activeSubscriptions) {
        await scheduleCancelAtPeriodEnd(tx, subscription.subscriptionId);
      }
    });
    return c.json({ success: true, mode, subscription_id: active.subscriptionId });
  }

  // immediate — google 결제면 모든 토큰의 Play revoke(비례 환불) 성공을 먼저 확인한다.
  // 실패 시 DB 무변경은 at_period_end 와 동일 — 성공분은 수렴 처리로 재시도가 안전하다.
  for (const txn of googleTxns.values()) {
    try {
      await playRevokeSubscription(c.env, txn.purchaseToken);
    } catch (err) {
      logStructured('error', { at: 'billing.cancel.play_revoke', error: String(err) });
      return c.json(
        {
          error: 'Failed to revoke the Google Play subscription',
          error_code: 'PLAY_REVOKE_FAILED',
          manage_url: playManageUrl(txn.productId, c.env.ANDROID_PACKAGE_NAME),
        },
        502,
      );
    }
  }

  // 기간 한정 개인 플랜이 덮는 동안에는 무료가 돼도 보관을 걸지 않는다(응답 기한도 null).
  const promoCoversFree = personalPromoCoversFree(c.env, now);
  const voiceRetentionUntil = await withWriteTransaction(db, async (tx) => {
    // 트랜잭션 안에서 '사용자 전체 활성 구독'을 다시 조회해 취소하지 않는다 — Play
    // 호출 동안 새 결제 confirm 으로 생긴 활성 구독은 위 revoke 대상이 아니었으므로
    // Play 에선 그대로 유지된다. DB 만 취소하면 상태가 갈라지므로, Play 성공을 확인한
    // 스냅샷(activeSubscriptions)의 구독만 취소하고 새 구독은 건드리지 않는다.
    // (plan 재정렬은 cancelSubscriptionImmediate 내부에서 남은 활성 구독 기준으로 처리)
    for (const subscription of activeSubscriptions) {
      await cancelSubscriptionImmediate(tx, subscription, now, { deleteVoiceData: false });
    }
    // 즉시 해지여도 음성은 보관 유예(PAID_VOICE_RETENTION_DAYS) 동안 남는다 —
    // '지금 삭제'는 /voice-data/delete-now 로 분리.
    // 새 결제가 살아남으면 유예·응답 기한도 없다. 스윕까지 기다리면 그 전에 거짓
    // 삭제 예고가 나가므로 plan 재계산과 같은 트랜잭션에서 보관 상태를 결정한다.
    return syncPaidVoiceRetention(tx, userPk, now, promoCoversFree);
  });
  // 해지한 당사자에게 plan_changed 푸시(커밋 후). 해지 직후가 예고를 보낼 자리다 — 3일 뒤
  // 지워진다는 걸 지금 말해야 되돌릴 시간이 있다.
  await notifyBillingStateChanged(db, c.env, [userPk]);
  return c.json({
    success: true,
    mode,
    subscription_id: active.subscriptionId,
    voice_retention_until: voiceRetentionUntil,
  });
});

// 정책 변경: 무료 전환 시 유료 음성 데이터를 삭제하지 않고 보존·잠금하므로,
// 사용자 즉시 삭제(POST /billing/voice-data/delete-now)는 제거했다. 데이터는 다시 유료가 되면
// 그대로 복구된다. (명시적 개별 삭제는 DELETE /voice/:id, 계정 삭제는 회원 탈퇴 경로.)

export default billingMutation;
