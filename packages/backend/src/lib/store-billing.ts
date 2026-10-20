/**
 * 스토어 결제(Google Play / App Store) entitlement 적용.
 *
 * 각 provider 라우트가 결제를 외부 API 로 검증한 뒤 이 모듈로 구독을 반영한다.
 *  - store_transactions (provider, provider_transaction_id) 유니크로 중복 처리 방지.
 *    같은 사용자가 같은 트랜잭션을 재전송하면 idempotent 하게 만료만 갱신,
 *    다른 사용자가 보낸 트랜잭션이면 409 (영수증 재사용 공격 차단).
 *  - 만료(expiresAt)는 스토어가 권위 — period_days 가 아니라 검증 응답의 만료를 쓴다.
 */
import type { DbExecutor } from './transactions';
import {
  cancelActiveSubscriptionsForUser,
  cancelSubscriptionImmediate,
  clearPaidVoiceRetention,
  findActiveSubscriptionsByUserPk,
  syncPaidVoiceRetention,
  resolvePlanAfterSuspend,
} from './billing-cancel';
import { planTypeToUserPlan } from '../routes/billing-helpers';

// 'apple' 은 마이그레이션 #96 이 store_transactions.provider CHECK 에 되돌린 값이다.
// applyStoreEntitlement 자체는 원래부터 provider-agnostic 이라 로직 변경이 없다.
type StoreProvider = 'google' | 'apple';

/**
 * App Store 구독 관리 화면. **해지는 여기서만 된다.**
 *
 * ⚠ Apple 의 자동갱신 구독은 **서버가 해지할 수 없다.** Google Play 에는
 * `purchases.subscriptions.cancel` 이 있지만 App Store Server API 에는 대응물이 없고,
 * 사용자가 직접 이 화면(또는 StoreKit `AppStore.showManageSubscriptions`)에서 끊어야 한다.
 * 그래서 `POST /billing/cancel` 은 애플 결제 구독을 **거절**한다 — 로컬만 취소하면
 * 사용자는 권한을 잃은 채 Apple 에 계속 과금된다.
 */
export const APPLE_MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

export interface StorePlan {
  id: string;
  key: string;
  name: string;
  plan_type: string;
  period_days: number;
  price_krw: number;
}

export interface StoreEntitlementInput {
  userPk: string;
  provider: StoreProvider;
  /** provider 별 고유 트랜잭션 식별자 (Google purchaseToken). */
  providerTransactionId: string;
  productId: string;
  plan: StorePlan;
  startsAt: Date;
  expiresAt: Date;
  /** 권한 변경을 실제 반영하는 시각. 삭제 유예는 과거 구매일이 아니라 여기서 시작한다. */
  appliedAt?: Date;
  /**
   * **스토어가 알려 준 이 결제의 시각.** 생략하면 검증된 startsAt을 쓴다.
   *
   * 탈퇴 시 결제기록 보존 기한을 '거래일' 부터 세는 근거다(`account-deletion.ts`).
   * 애플은 `purchaseDate`, 구글은 최신 성공 주문의 Orders API `processedEvent.eventTime`.
   * 현재 시각·만료·유예 연장 시각은 결제일의 대용품이 아니다.
   */
  lastPaidAt?: Date;
  /** 감사/디버깅용 원본 페이로드 (민감정보 제외 권장). */
  rawPayload?: string;
  /**
   * **스토어가 이 체인의 _지금_ 결제를 호출자 것으로 찍어 줬는가**(애플: 체인의 가장 최근
   * 트랜잭션의 `appAccountToken` 이 호출자).
   *
   * true 면 구독 체인의 소유권을 호출자에게 옮긴다 — **우리 DB 에 누가 주인으로 적혀
   * 있든, 그 기간이 남아 있든.** 주인은 스토어가 정하고 `store_transactions.user_id` 는
   * "마지막으로 본 주인" 일 뿐이다(`docs/spec/billing-lifecycle.md` 「애플 결제 확정」).
   * 애플은 한 App Store 계정의 구독을 같은 체인(`originalTransactionId`)으로 잇기 때문에,
   * 같은 애플 계정으로 B 계정이 결제하면 **B 의 표식이 박힌 트랜잭션이 옛 체인 id 로**
   * 올라온다. 이걸 DB 를 근거로 막으면 돈은 나갔는데 권한이 안 붙는다(2026-09-19 운영 재현).
   *
   * ⚠ 호출부는 **앱이 보낸 트랜잭션이 아니라 스토어에 되물은 최신 트랜잭션**으로 이 값을
   * 정해야 한다. 옛 트랜잭션의 표식으로 true 를 주면, 이미 다른 계정에게 넘어간 체인을
   * 앞 주인이 옛 영수증으로 도로 가져간다.
   */
  purchaserVerified?: boolean;
  /**
   * **기간 한정 개인 플랜이 지금 원시 free 를 덮는가** — 호출부가 `personalPromoCoversFree(env,
   * appliedAt)` 로 푼 값. 이 결제로 무료가 되는 사람(체인을 넘겨준 앞 주인)의 보관 판정에 쓴다.
   * ⚠ 필수다 — 빠뜨려 원시로 판정되면 기간 중에 거짓 삭제 예고가 나간다.
   */
  promoCoversFree: boolean;
}

export type StoreEntitlementResult =
  | {
      ok: true;
      subscription: {
        id: string;
        plan_id: string;
        plan_key: string;
        status: 'active';
        starts_at: string;
        expires_at: string;
      };
      /**
       * 이 전환으로 **스냅샷을 다시 읽어야 하는** 사람들. 호출부가 트랜잭션 커밋 **후**
       * `notifyBillingStateChanged` 로 알린다.
       *
       * - **구매자** — 같은 상품 복구·갱신으로 실제 유효 등급이 바뀐 경우.
       * - **앞 주인** — 스토어가 체인을 호출자 것으로 찍어 구독을 넘겨받은 경우(`purchaserVerified`).
       */
      planChangedUserIds: string[];
    }
  | {
      ok: false;
      status: 409;
      errorCode:
        'TRANSACTION_OWNED_BY_OTHER_USER' | 'CROSS_STORE_RENEWAL_ACTIVE' | 'SUBSCRIPTION_EXPIRED';
    };

export async function loadPlanByKey(db: DbExecutor, planKey: string): Promise<StorePlan | null> {
  const res = await db.execute({
    sql: `SELECT id, key, name, plan_type, period_days, price_krw
          FROM plans WHERE key = ? AND is_active = 1`,
    args: [planKey],
  });
  if (res.rows.length === 0) return null;
  const row = res.rows[0]!;
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    plan_type: String(row.plan_type),
    period_days: Number(row.period_days) || 30,
    price_krw: Number(row.price_krw) || 0,
  };
}

async function currentSubscriptionPlanId(
  tx: DbExecutor,
  subscriptionId: string,
): Promise<string | null> {
  const res = await tx.execute({
    sql: `SELECT plan_id FROM subscriptions WHERE id = ?`,
    args: [subscriptionId],
  });
  return res.rows.length > 0 ? String(res.rows[0]!.plan_id) : null;
}

/**
 * **다른 스토어가 아직 갱신을 쥐고 있는가** — 있으면 그 provider 를 돌려준다.
 *
 * ⚠ **해지 예약된 구독은 세지 않는다.** `cancel_at_period_end = 1` 은 "아직 유료지만 다음
 * 갱신은 없다" 는 뜻이라, 그걸 막으면 안내대로 해지한 사용자가 남은 기간 내내 못 산다.
 *
 * ⚠ **만료로는 거르지 않는다.** Play 보류(`ON_HOLD`/`PAUSED`)는 구독 행을 살려 두고
 * `users.plan` 만 회수하는데 그 행은 `expires_at` 이 지나 있다 — 그런데 결제가 복구되면
 * Play 는 다시 청구한다.
 */
async function findCrossStoreRenewalProvider(
  tx: DbExecutor,
  userPk: string,
  provider: string,
): Promise<string | null> {
  const res = await tx.execute({
    sql: `SELECT DISTINCT t.provider
          FROM store_transactions t
          JOIN subscriptions s ON s.id = t.subscription_id
          WHERE s.user_id = ?
            AND s.status = 'active'
            AND s.cancel_at_period_end = 0
            AND t.provider <> ?`,
    args: [userPk, provider],
  });
  return res.rows.length > 0 ? String(res.rows[0]!.provider) : null;
}

/** 트랜잭션 안에서 호출해야 한다 (withWriteTransaction). */
export async function applyStoreEntitlement(
  tx: DbExecutor,
  input: StoreEntitlementInput,
): Promise<StoreEntitlementResult> {
  const startsAtIso = input.startsAt.toISOString();
  let expiresAtIso = input.expiresAt.toISOString();
  const lastPaidAtIso = (input.lastPaidAt ?? input.startsAt).toISOString();
  const appliedAt = input.appliedAt ?? new Date();

  // 소유권을 넘겨받으면서 권한이 바뀐 계정(앞 주인) — 커밋 뒤 스냅샷을 다시 읽으라고 알릴 대상이다.
  const transferAffected: string[] = [];

  const existing = await tx.execute({
    sql: `SELECT user_id, subscription_id, last_paid_at, expires_at,
                 (SELECT plan FROM users WHERE id = store_transactions.user_id) AS user_plan
          FROM store_transactions
          WHERE provider = ? AND provider_transaction_id = ?`,
    args: [input.provider, input.providerTransactionId],
  });

  if (existing.rows.length > 0) {
    const row = existing.rows[0]!;
    if (String(row.user_id) !== input.userPk) {
      // ⚠ **스토어가 지금 결제를 호출자 것으로 찍었으면 넘겨준다 — 우리 DB 의 기간은 보지
      //   않는다**(위 `purchaserVerified` 주석 참조). 예전에는 "앞 주인의 기간이 끝났을 때만"
      //   이었는데, 그 기간은 **사본**이다: A 가 구독 중인 폰에서 B 가 상위 플랜을 사면
      //   애플은 B 에게 청구하고 같은 체인으로 올려 보낸다. 거기서 409 를 내면 돈은 나가고
      //   권한은 안 붙는다. 스토어가 호출자 것이라고 하지 않았으면 예전처럼 막는다.
      const previousOwner = String(row.user_id);
      if (input.purchaserVerified !== true) {
        return { ok: false, status: 409, errorCode: 'TRANSACTION_OWNED_BY_OTHER_USER' };
      }
      // 앞 주인의 **그 구독만** 정리한다(다른 스토어의 멀쩡한 구독은 건드리지 않는다).
      // 아직 살아 있는 행이면 정상 해지를 태운다 — 행만 `cancelled` 로 바꾸면 앞 주인의 등급이
      // 다시 계산되지 않아 지불 근거 없이 유료로 읽힌다. 음성은 보존한다.
      const previousSubscriptionId = (row.subscription_id as string | null) ?? null;
      const previousActive = previousSubscriptionId
        ? (await findActiveSubscriptionsByUserPk(tx, previousOwner)).find(
            (sub) => sub.subscriptionId === previousSubscriptionId,
          )
        : undefined;
      if (previousActive) {
        await cancelSubscriptionImmediate(tx, previousActive, appliedAt, {
          deleteVoiceData: false,
        });
        // 즉시 해지와 같은 규칙 — 무료가 됐으면 목소리 보관 기한을 건다. 남은 유료 권한이
        // 있으면 기한을 지운다(`syncPaidVoiceRetention`).
        await syncPaidVoiceRetention(tx, previousOwner, appliedAt, input.promoCoversFree);
      } else {
        // ⚠ 여기서는 보관 기한을 다시 걸지 않는다 — 만료 크론이 이미 걸었고, 다시 부르면
        //   기한이 오늘부터로 **연장**된다(스펙: 재조회로 유예를 연장하지 않는다).
        // 이미 끝난 행(만료 크론이 먼저 지나갔다)이다 — 등급만 남은 구독에서 다시 계산한다.
        const previousPlanType = await resolvePlanAfterSuspend(tx, previousOwner, []);
        await tx.execute({
          sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
          args: [previousPlanType ? planTypeToUserPlan(previousPlanType) : 'free', previousOwner],
        });
      }
      transferAffected.push(previousOwner);
      // 아래 '새 구매' 갈래로 내려간다 — `INSERT OR REPLACE` 가 체인의 주인을 호출자로 바꾼다.
    } else {
    // 늦게 도착한 이전 결제가 새 상품·기간을 되돌리지 못하게 한다.
    if (row.last_paid_at && Date.parse(String(row.last_paid_at)) > Date.parse(lastPaidAtIso)) {
      return { ok: false, status: 409, errorCode: 'SUBSCRIPTION_EXPIRED' };
    }
    // 같은 사용자의 재전송(갱신 포함) — 기존 구독 만료를 스토어 기준으로 갱신.
    const subscriptionId = (row.subscription_id as string | null) ?? null;
    // plan 이 동일한 재전송/갱신만 "갱신"으로 처리한다. plan 이 바뀐 동일 트랜잭션은 아래 신규
    // 구독 경로로 폴백해 구독을 새 plan 으로 교체한다(store_transactions 는
    // (provider, provider_transaction_id) UNIQUE 로 새 구독에 재연결).
    const currentPlanId = subscriptionId
      ? await currentSubscriptionPlanId(tx, subscriptionId)
      : null;
    if (subscriptionId && currentPlanId === input.plan.id) {
      if (row.expires_at && Date.parse(String(row.expires_at)) > Date.parse(expiresAtIso)) {
        expiresAtIso = new Date(String(row.expires_at)).toISOString();
      }
      await tx.execute({
        sql: `UPDATE subscriptions
              SET expires_at = CASE WHEN julianday(?) > julianday(expires_at) THEN ? ELSE expires_at END,
                  status = 'active', entitlement_state = 'entitled', cancel_at_period_end = 0,
                  canceled_at = NULL, updated_at = datetime('now')
              WHERE id = ?`,
        args: [expiresAtIso, expiresAtIso, subscriptionId],
      });
      // 등급은 남은 유효 구독 전체에서 다시 고른다(다른 경로와 같은 `resolvePlanAfterSuspend`).
      const effectivePlanType = await resolvePlanAfterSuspend(tx, input.userPk, []);
      const effectiveUserPlan = effectivePlanType ? planTypeToUserPlan(effectivePlanType) : 'free';
      await tx.execute({
        // 재전송·유예 연장과 실제 결제는 다르다. 검증된 결제일이 새로울 때만 앵커를 옮긴다.
        sql: `UPDATE store_transactions
              SET last_paid_at = CASE
                    WHEN last_paid_at IS NULL OR julianday(?) > julianday(last_paid_at) THEN ?
                    ELSE last_paid_at
                  END,
                  expires_at = CASE WHEN expires_at IS NULL OR julianday(?) > julianday(expires_at) THEN ? ELSE expires_at END,
                  raw_payload = COALESCE(?, raw_payload)
              WHERE provider = ? AND provider_transaction_id = ?`,
        args: [
          lastPaidAtIso,
          lastPaidAtIso,
          expiresAtIso,
          expiresAtIso,
          input.rawPayload ?? null,
          input.provider,
          input.providerTransactionId,
        ],
      });
      // 갱신/복구로 유료가 이어지면 예약된 유료 음성 보관 삭제를 해제한다.
      await clearPaidVoiceRetention(tx, input.userPk);
      return {
        ok: true,
        subscription: {
          id: subscriptionId,
          plan_id: input.plan.id,
          plan_key: input.plan.key,
          status: 'active',
          starts_at: startsAtIso,
          expires_at: expiresAtIso,
        },
        // 같은 plan 이어도 보류 복구로 등급이 바뀔 수 있다.
        planChangedUserIds: String(row.user_plan) !== effectiveUserPlan ? [input.userPk] : [],
      };
    }
    }
  }

  // ⚠ **교차 스토어 배타성은 여기서 본다 — 라우트가 아니라**(코덱스 #733 6차).
  //   라우트에서 미리 보면 두 스토어의 확정이 **동시에** 들어올 때 둘 다 "경쟁자 없음" 으로
  //   읽고 지나간다. 그러면 쓰기만 직렬화되어 먼저 쓴 로컬 행이 취소되고, **바깥의 두 구독은
  //   그대로 갱신된다** — 아무도 409 를 못 받는다. 같은 트랜잭션 안에서 봐야 한 쪽이 진다.
  //   여기에 두면 **두 스토어가 대칭**이 된다(구글 확정도 같은 함수를 탄다).
  //
  // ⚠ **자리가 여기인 이유**: 위쪽 갈래(이미 우리가 아는 트랜잭션의 재전송·갱신)는 막으면
  //   안 된다. 이미 팔린 구독의 갱신을 거절하면 **돈은 나가는데 권한이 끊긴다.** 막을 것은
  //   **새 구매**뿐이다. 같은 스토어 안의 등급 변경도 막지 않는다(스토어가 처리하는 정상 경로).
  const crossStore = await findCrossStoreRenewalProvider(tx, input.userPk, input.provider);
  if (crossStore) {
    return { ok: false, status: 409, errorCode: 'CROSS_STORE_RENEWAL_ACTIVE' };
  }

  // 기존 활성 구독을 정리하고 새 구독 생성.
  // 음성 데이터는 보존 (업그레이드/갱신이 다운그레이드 정리를 트리거하면 안 됨).
  await cancelActiveSubscriptionsForUser(tx, input.userPk, appliedAt, { deleteVoiceData: false });

  const subscriptionId = crypto.randomUUID();

  await tx.execute({
    sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
          VALUES (?, ?, ?, 'active', ?, ?)`,
    args: [subscriptionId, input.userPk, input.plan.id, startsAtIso, expiresAtIso],
  });

  await tx.execute({
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [planTypeToUserPlan(input.plan.plan_type), input.userPk],
  });

  await tx.execute({
    // ⚠ **`last_paid_at` 을 여기서 적는다**(코덱스 #734 5차). 나중에 `created_at`(체인 최초
    //   시각)이나 `expires_at - period_days`(달력 달이라 며칠 어긋난다)로 되짚으려 하지 말 것.
    //   탈퇴 시 결제기록 보존 기한을 '거래일' 부터 세는 근거가 이 값이다.
    sql: `INSERT OR REPLACE INTO store_transactions
            (id, user_id, provider, provider_transaction_id, product_id, plan_key,
             subscription_id, expires_at, raw_payload, last_paid_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      input.userPk,
      input.provider,
      input.providerTransactionId,
      input.productId,
      input.plan.key,
      subscriptionId,
      expiresAtIso,
      input.rawPayload ?? null,
      lastPaidAtIso,
    ],
  });

  // 재구독(신규 트랜잭션)으로 유료가 되살아나면 예약된 유료 음성 보관 삭제를 해제한다.
  await clearPaidVoiceRetention(tx, input.userPk);

  return {
    ok: true,
    subscription: {
      id: subscriptionId,
      plan_id: input.plan.id,
      plan_key: input.plan.key,
      status: 'active',
      starts_at: startsAtIso,
      expires_at: expiresAtIso,
    },
    planChangedUserIds: transferAffected,
  };
}
