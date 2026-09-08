/**
 * 스토어 결제(Google Play / App Store) entitlement 적용.
 *
 * 각 provider 라우트가 결제를 외부 API 로 검증한 뒤 이 모듈로 구독을 반영한다.
 *  - store_transactions (provider, provider_transaction_id) 유니크로 중복 처리 방지.
 *    같은 사용자가 같은 트랜잭션을 재전송하면 idempotent 하게 만료만 갱신,
 *    다른 사용자가 보낸 트랜잭션이면 409 (영수증 재사용 공격 차단).
 *  - 만료(expiresAt)는 스토어가 권위 — period_days 가 아니라 검증 응답의 만료를 쓴다.
 */
import { issueVoucherCode } from './voucher-issue';
import type { DbExecutor } from './transactions';
import {
  cancelActiveSubscriptionsForUser,
  clearPaidVoiceRetention,
  leavePlanGroupMember,
} from './billing-cancel';
import { planTypeToUserPlan, plannedMaxUses, isGroupPlanType } from '../routes/billing-helpers';

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
      /**
       * 이 전환으로 **그룹에서 나가게 된** 멤버들(정원 축소). 호출부가 트랜잭션 커밋
       * **후** `notifyPlanChanged` 로 알린다 — 아무 말 없이 유료 접근을 잃으면
       * 사용자는 앱이 고장 난 줄 안다.
       */
      demotedUserIds: string[];
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
        // 같은 plan 갱신이라 그룹이 그대로다 — 나간 사람이 없다.
        demotedUserIds: [],
      };
    }
  }

  // ⚠ **그룹형 → 그룹형 전환은 그룹을 이어받는다**(커플 ↔ 가족).
  // 전환은 새 purchaseToken 이라 여기 신규 경로로 오는데, 아래 취소가 소유자 갈래로
  // `disbandOwnedPlanGroup` 을 태우면 **파트너가 쫓겨나고 이미 뿌린 초대 코드가 만료**된다.
  // 가족 → 개인이라면 맞다(그룹을 뒷받침할 결제가 사라진다). 하지만 커플 → 가족은 **더
  // 비싼 걸 산 것**이고, 그 대가가 "파트너 추방 + 코드 폐기 + 통지 없음" 이었다.
  const carryOver = isGroupPlanType(input.plan.plan_type)
    ? await findOwnedGroupToCarryOver(tx, input.userPk)
    : null;

  // 기존 활성 구독을 정리하고 새 구독 생성.
  // 음성 데이터는 보존 (업그레이드/갱신이 다운그레이드 정리를 트리거하면 안 됨).
  await cancelActiveSubscriptionsForUser(tx, input.userPk, input.startsAt, {
    deleteVoiceData: false,
    preserveGroupId: carryOver?.planGroupId ?? null,
  });

  const subscriptionId = crypto.randomUUID();
  let planGroupId: string | null = null;
  const demotedUserIds: string[] = [];

  if (isGroupPlanType(input.plan.plan_type)) {
    if (carryOver) {
      planGroupId = carryOver.planGroupId;
      await tx.execute({
        sql: `UPDATE plan_groups SET plan_id = ?, max_members = ? WHERE id = ?`,
        args: [input.plan.id, input.plan.max_members, planGroupId],
      });
      // 정원이 줄어드는 전환(가족 → 커플)에서는 넘치는 인원을 내보내야 한다.
      // 남길 사람은 **먼저 들어온 순서**로 고른다 — 임의로 고르면 설명할 수 없다.
      demotedUserIds.push(
        ...(await enforceGroupCapacity(tx, {
          planGroupId,
          ownerUserPk: input.userPk,
          maxMembers: input.plan.max_members,
          now: input.startsAt,
        })),
      );
    } else {
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

  if (isGroupPlanType(input.plan.plan_type)) {
    const maxUses = plannedMaxUses(input.plan.plan_type, input.plan.max_members);
    let carriedCodes = 0;
    if (carryOver) {
      // ⚠ **이미 공유한 코드를 죽이지 않는다.** 옛 구독의 코드를 새 구독으로 옮기고
      // 만료·정원만 새 plan 기준으로 고친다. 코드 문자열이 그대로라 카톡으로 뿌려 둔
      // 초대장이 계속 통한다 — 새로 발급하면 소유자가 그걸 알 방법이 없다.
      await tx.execute({
        sql: `UPDATE voucher_codes
              SET issuer_subscription_id = ?, plan_id = ?, expires_at = ?, max_uses = ?
              WHERE issuer_subscription_id = ? AND status IN ('issued', 'used')`,
        args: [
          subscriptionId,
          input.plan.id,
          expiresAtIso,
          maxUses,
          carryOver.subscriptionId,
        ],
      });
      const movedRes = await tx.execute({
        sql: `SELECT COUNT(*) AS n FROM voucher_codes WHERE issuer_subscription_id = ?`,
        args: [subscriptionId],
      });
      carriedCodes = Number(movedRes.rows[0]?.n ?? 0);
    }
    // 옮길 코드가 없었으면(옛 코드가 이미 만료·소진) 새로 발급한다.
    if (carriedCodes === 0) {
      await issueVoucherCode(tx, {
        kind: 'invite',
        planId: input.plan.id,
        issuerUserId: input.userPk,
        issuerSubscriptionId: subscriptionId,
        issuedAt: startsAtIso,
        expiresAt: expiresAtIso,
        maxUses,
      });
    }
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
    demotedUserIds,
  };
}

/**
 * 이 사용자가 **소유**하고 있고 지금 활성 구독이 매달린 그룹 — 전환에서 이어받을 대상.
 *
 * ⚠ **소유자일 때만 이어받는다.** 멤버가 자기 돈으로 상위 plan 을 사면 그건 그 그룹을
 * 물려받는 게 아니라 **자기 그룹을 새로 여는 것**이다(남의 그룹 정원을 내 결제로 바꿔
 * 버리면 안 된다). 그래서 `owner_user_id = ?` 를 조건에 둔다.
 */
async function findOwnedGroupToCarryOver(
  tx: DbExecutor,
  userPk: string,
): Promise<{ planGroupId: string; subscriptionId: string } | null> {
  const res = await tx.execute({
    sql: `SELECT s.id AS subscription_id, s.plan_group_id AS plan_group_id
          FROM subscriptions s
          JOIN plan_groups g ON g.id = s.plan_group_id
          WHERE s.user_id = ?
            AND s.status = 'active'
            AND g.owner_user_id = ?
          ORDER BY s.starts_at DESC
          LIMIT 1`,
    args: [userPk, userPk],
  });
  if (res.rows.length === 0) return null;
  const row = res.rows[0]!;
  return {
    planGroupId: String(row.plan_group_id),
    subscriptionId: String(row.subscription_id),
  };
}

/**
 * 정원이 줄어드는 전환(가족 → 커플)에서 넘치는 멤버를 내보낸다.
 * 반환: 나가게 된 user_id 목록(통지 대상).
 *
 * 남길 사람은 **먼저 들어온 순서**(`joined_at`)로 고른다. 소유자는 언제나 남는다.
 * 임의 순서로 자르면 왜 저 사람이 빠졌는지 설명할 수 없고, 같은 입력에 결과가 달라진다.
 */
async function enforceGroupCapacity(
  tx: DbExecutor,
  params: { planGroupId: string; ownerUserPk: string; maxMembers: number; now: Date },
): Promise<string[]> {
  const res = await tx.execute({
    sql: `SELECT id, user_id FROM plan_group_members
          WHERE plan_group_id = ? AND user_id <> ?
          ORDER BY joined_at ASC, id ASC`,
    args: [params.planGroupId, params.ownerUserPk],
  });
  // 소유자가 한 자리를 쓰므로 멤버가 앉을 수 있는 자리는 정원 - 1.
  const memberSeats = Math.max(0, params.maxMembers - 1);
  const overflow = res.rows.slice(memberSeats);
  const demoted: string[] = [];
  for (const row of overflow) {
    const memberUserPk = String(row.user_id);
    // 자발적 이탈과 같은 정리를 태운다 — 그룹 구독 취소·plan 재정렬·음성 보관 유예·
    // 초대 사용분 반환까지 한 벌로 들어 있다.
    await leavePlanGroupMember(tx, {
      userPk: memberUserPk,
      planGroupId: params.planGroupId,
      membershipId: String(row.id),
      now: params.now,
    });
    demoted.push(memberUserPk);
  }
  return demoted;
}
