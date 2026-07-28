/**
 * 스토어 결제(Google Play) entitlement 적용.
 *
 * 각 provider 라우트가 결제를 외부 API 로 검증한 뒤 이 모듈로 구독을 반영한다.
 *  - store_transactions (provider, provider_transaction_id) 유니크로 중복 처리 방지.
 *    같은 사용자가 같은 트랜잭션을 재전송하면 idempotent 하게 만료만 갱신,
 *    다른 사용자가 보낸 트랜잭션이면 409 (영수증 재사용 공격 차단).
 *  - 만료(expiresAt)는 스토어가 권위 — period_days 가 아니라 검증 응답의 만료를 쓴다.
 */
import { issueVoucherCode } from './voucher-issue';
import type { DbExecutor } from './transactions';
import { cancelActiveSubscriptionsForUser, clearPaidVoiceRetention } from './billing-cancel';
import { planTypeToUserPlan, plannedMaxUses } from '../routes/billing-helpers';

export type StoreProvider = 'google';

export interface StorePlan {
  id: string;
  key: string;
  name: string;
  plan_type: string;
  period_days: number;
  max_members: number;
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
  /** 감사/디버깅용 원본 페이로드 (민감정보 제외 권장). */
  rawPayload?: string;
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
    }
  | { ok: false; status: 409; errorCode: 'TRANSACTION_OWNED_BY_OTHER_USER' };

export async function loadPlanByKey(db: DbExecutor, planKey: string): Promise<StorePlan | null> {
  const res = await db.execute({
    sql: `SELECT id, key, name, plan_type, period_days, max_members, price_krw
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
    max_members: Number(row.max_members) || 1,
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

/** 트랜잭션 안에서 호출해야 한다 (withWriteTransaction). */
export async function applyStoreEntitlement(
  tx: DbExecutor,
  input: StoreEntitlementInput,
): Promise<StoreEntitlementResult> {
  const startsAtIso = input.startsAt.toISOString();
  const expiresAtIso = input.expiresAt.toISOString();

  const existing = await tx.execute({
    sql: `SELECT user_id, subscription_id FROM store_transactions
          WHERE provider = ? AND provider_transaction_id = ?`,
    args: [input.provider, input.providerTransactionId],
  });

  if (existing.rows.length > 0) {
    const row = existing.rows[0]!;
    if (String(row.user_id) !== input.userPk) {
      return { ok: false, status: 409, errorCode: 'TRANSACTION_OWNED_BY_OTHER_USER' };
    }
    // 같은 사용자의 재전송(갱신 포함) — 기존 구독 만료를 스토어 기준으로 갱신.
    const subscriptionId = (row.subscription_id as string | null) ?? null;
    // plan 이 동일한 재전송/갱신만 "갱신"으로 처리한다. plan 이 바뀐 동일 트랜잭션
    // (예: 동일 purchaseToken 으로 업/다운그레이드)은 아래 신규 구독 경로로
    // 폴백해 구독·plan_group·바우처를 새 plan 으로 교체한다(personal→family 시 그룹/초대 생성,
    // store_transactions 는 (provider, provider_transaction_id) UNIQUE 로 새 구독에 재연결).
    const currentPlanId = subscriptionId
      ? await currentSubscriptionPlanId(tx, subscriptionId)
      : null;
    if (subscriptionId && currentPlanId === input.plan.id) {
      await tx.execute({
        sql: `UPDATE subscriptions
              SET expires_at = ?, status = 'active', cancel_at_period_end = 0,
                  canceled_at = NULL, updated_at = datetime('now')
              WHERE id = ?`,
        args: [expiresAtIso, subscriptionId],
      });
      // 갱신(다음 달 결제 등)으로 구독 만료가 연장되면, 같은 구독에 묶인 공유 코드의
      // 만료도 함께 밀어 코드가 끊기지 않게 한다. 코드 문자열은 그대로 유지되므로
      // 이미 공유한 코드도 다음 기간 동안 계속 유효하다.
      // issued 뿐 아니라 used 도 연장한다: 정원이 찬 상태로 갱신된 뒤 멤버가 이탈하면
      // releaseInviteUseForMember 가 used→issued 로 되돌리는데, 이때 expires_at 은
      // 건드리지 않으므로 옛 만료가 남아 즉시 만료 처리되는 것을 막는다.
      // (expired 코드는 의도적으로 무효화된 것이므로 되살리지 않는다.)
      await tx.execute({
        sql: `UPDATE voucher_codes
              SET expires_at = ?
              WHERE issuer_subscription_id = ? AND status IN ('issued', 'used')`,
        args: [expiresAtIso, subscriptionId],
      });
      await tx.execute({
        sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [planTypeToUserPlan(input.plan.plan_type), input.userPk],
      });
      await tx.execute({
        sql: `UPDATE store_transactions SET expires_at = ? WHERE provider = ? AND provider_transaction_id = ?`,
        args: [expiresAtIso, input.provider, input.providerTransactionId],
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
      };
    }
  }

  // 새 트랜잭션 — 기존 활성 구독을 정리하고 새 구독 생성.
  // 음성 데이터는 보존 (업그레이드/갱신이 다운그레이드 정리를 트리거하면 안 됨).
  await cancelActiveSubscriptionsForUser(tx, input.userPk, input.startsAt, {
    deleteVoiceData: false,
  });

  const subscriptionId = crypto.randomUUID();
  let planGroupId: string | null = null;

  if (input.plan.plan_type === 'family') {
    planGroupId = crypto.randomUUID();
    await tx.execute({
      sql: `INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members)
            VALUES (?, ?, ?, ?)`,
      args: [planGroupId, input.userPk, input.plan.id, input.plan.max_members],
    });
    await tx.execute({
      sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
            VALUES (?, ?, ?, 'owner')`,
      args: [crypto.randomUUID(), planGroupId, input.userPk],
    });
  }

  await tx.execute({
    sql: `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
          VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    args: [subscriptionId, input.userPk, input.plan.id, planGroupId, startsAtIso, expiresAtIso],
  });

  await tx.execute({
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [planTypeToUserPlan(input.plan.plan_type), input.userPk],
  });

  if (input.plan.plan_type === 'family') {
    await issueVoucherCode(tx, {
      kind: 'invite',
      planId: input.plan.id,
      issuerUserId: input.userPk,
      issuerSubscriptionId: subscriptionId,
      issuedAt: startsAtIso,
      expiresAt: expiresAtIso,
      maxUses: plannedMaxUses(input.plan.plan_type, input.plan.max_members),
    });
  }

  await tx.execute({
    sql: `INSERT OR REPLACE INTO store_transactions
            (id, user_id, provider, provider_transaction_id, product_id, plan_key,
             subscription_id, expires_at, raw_payload)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  };
}
