import type { Client } from '@libsql/client';
import { issueVoucherCode } from './voucher-issue';
import type { DbExecutor } from './transactions';
import { withWriteTransaction } from './transactions';
import {
  deletePaidVoiceDataForUser,
  deleteSensitiveVoiceDataForUser,
  releaseClonedVoicesForUser,
} from './paid-voice-cleanup';
import { logStructured } from './logger';
import {
  ENTITLED_STATES,
  getPlaySubscriptionV2,
  PlayBillingUnconfiguredError,
  type PlayEnv,
  type SubscriptionV2Response,
} from './play-subscriptions';
import { PAID_PLAN_TYPES, planTypeToUserPlan, plannedMaxUses } from '../routes/billing-helpers';
import { sendPlanChangedPush } from './fcm';
import type { Env } from '../types';

// 만료 크론이 FCM(plan_changed) 을 쏘려면 Play env 외에 FIREBASE 설정도 필요하다. index.ts 의 scheduled
// 핸들러가 워커 env(전체)를 넘기므로 런타임엔 존재하며, 타입만 넓혀 준다.
type ExpiryEnv = PlayEnv & Partial<Pick<Env, 'FIREBASE_PROJECT_ID' | 'FIREBASE_SERVICE_ACCOUNT_JSON'>>;

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

/**
 * 해지/만료 후 유료 음성 데이터를 보관하는 유예 기간(일).
 *
 * 주의 — 지금 이 값은 `paid_voice_retention.delete_after` 타임스탬프를 정할 뿐,
 * **실제로 음성 데이터를 지우는 코드는 없다.** sweepPaidVoiceRetention 은 기한이 지난
 * 보관 '장부 행'만 지우고 클론·원본·생성 오디오는 그대로 둔다(정책: 무료 전환 시 삭제하지
 * 않고 잠그기만 한다). 그래서 이 상수를 줄여도 데이터가 더 빨리 사라지지는 않는다.
 *
 * '해지 즉시 클론 삭제 + 원본·생성 오디오만 N일 보관 + 그 안에 재생성 가능' 정책을 실제로
 * 적용하려면 유예 만료 시 deleteSensitiveVoiceDataForUser 를 태우는 배관이 따로 필요하다.
 */
export const PAID_VOICE_RETENTION_DAYS = 3;

/**
 * 유료 음성 보관 유예를 예약(upsert)한다. 반환값은 delete_after ISO 문자열
 * (응답 voice_retention_until 로 그대로 내려줄 수 있게).
 * 재해지 시에는 마지막 해지 시점 기준으로 유예를 다시 잡는다(DO UPDATE) —
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
/**
 * 지금 유료 권한이 살아 있는가 — 보관 만료 삭제 직전의 마지막 안전장치.
 * 활성 구독(만료 전) 또는 users.plan 이 무료가 아니면 유료로 본다. 둘 중 하나만 봐도
 * 대부분 맞지만, 어느 한쪽만 갱신하고 다른 쪽을 놓친 경로가 있어 둘 다 확인한다.
 */
async function hasActivePaidEntitlement(db: DbExecutor, userPk: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM subscriptions
              WHERE user_id = ? AND status = 'active'
                AND datetime(expires_at) > datetime('now')) AS active_subs,
            (SELECT plan FROM users WHERE id = ?) AS plan`,
    args: [userPk, userPk],
  });
  const row = res.rows[0];
  if (!row) return false;
  const activeSubs = Number(row.active_subs ?? 0);
  const plan = (row.plan as string | null) ?? 'free';
  return activeSubs > 0 || (plan !== 'free' && plan.trim() !== '');
}

export async function clearPaidVoiceRetention(db: DbExecutor, userPk: string): Promise<void> {
  await db.execute({
    sql: `DELETE FROM paid_voice_retention WHERE user_id = ?`,
    args: [userPk],
  });
}

/**
 * 만료된(delete_after 경과) 유료 음성 보관 행을 거둔다.
 * 정책 변경: 무료 전환 시 유료 음성 데이터를 더 이상 삭제하지 않는다 — 데이터는 그대로 보존하고
 * 무료인 동안 사용을 잠글 뿐이며, 다시 유료가 되면 그대로 풀린다(잠금은 users.plan 에서 파생).
 * 그래서 이 스윕은 하드삭제를 하지 않고, 유예가 지난 보관 행만 정리하는 청소부로 남는다.
 * (계정 삭제 같은 명시 경로는 여전히 deletePaidVoiceDataForUser 로 직접 삭제한다.)
 */
export async function sweepPaidVoiceRetention(
  db: Client,
  now: Date = new Date(),
): Promise<string[]> {
  // 이 정리로 알람이 강등된 사용자들 — 호출자가 plan_changed 푸시 대상에 넣는다.
  const downgraded = new Set<string>();
  // 유예가 끝난 사용자의 남은 음성 데이터(원본 업로드·생성 오디오)를 정리한다.
  // 클론 자체는 해지 시점에 이미 반납했다(releaseClonedVoicesForUser).
  const due = await db.execute({
    sql: `SELECT user_id FROM paid_voice_retention WHERE delete_after <= ?`,
    args: [now.toISOString()],
  });
  for (const row of due.rows) {
    const userPk = String(row.user_id);
    // 삭제 직전에 '지금도 무료인가'를 다시 본다. 보관 행은 해지 시점에 깔리는데, 그 뒤
    // 바우처 리딤·프로모 구독처럼 보관 행을 지우지 않고 권한만 살리는 경로가 있고,
    // 그룹 탈퇴는 다른 유료 구독이 남아 있어도 보관을 걸 수 있다. 그대로 지우면 지금
    // 돈을 내고 있는 사용자의 목소리를 영구 삭제하게 된다.
    if (await hasActivePaidEntitlement(db, userPk)) {
      await clearPaidVoiceRetention(db, userPk);
      continue;
    }
    const affected = await deleteSensitiveVoiceDataForUser(
      db,
      userPk,
      await resolveUserLoginId(db, userPk),
    );
    for (const id of affected) downgraded.add(id);
    await clearPaidVoiceRetention(db, userPk);
  }
  return Array.from(downgraded);
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
  // 무료로 내려간 시점에 제공자 클론을 반납한다 — 유료 슬롯을 붙들고 있을 이유가 없다.
  // 원본 업로드는 남으므로, 보관 유예 안에 재구독하면 재클론으로 그대로 돌아온다.
  await releaseClonedVoicesForUser(db, userPk, loginId);
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
              voice_profile_id = NULL
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

/**
 * suspend(ON_HOLD/PAUSED) 전용 plan 재정렬 (E). 매핑(정지된) 구독을 제외한 다른 활성 유료
 * 구독이 남아 있으면 그 plan 을 유지하고, 없을 때만 free 로 내린다 — deactivate 경로
 * (syncUserPlanAfterCancel)의 E2(잔여 유료 구독 유지)와 대칭.
 *
 * deactivate 와 달리 ON_HOLD/PAUSED 는 결제 복구로 되살아날 수 있는 회복형 상태라,
 * is_shared 해제·타인 알람 강등 같은 음성 접근 정리는 하지 않는다(그룹·공유 구조 보존).
 * 소유자 users.plan 만 보수적으로 회수하며, 결제가 복구되면 entitle 가 users.plan 을 원복한다.
 * (매핑 구독은 suspend 에서 취소하지 않아 여전히 active 이므로 subscriptionId 로 명시 제외한다.)
 * 반환값: 유지된 plan_type(없으면 null — free 로 내림).
 */
export async function resolvePlanAfterSuspend(
  db: DbExecutor,
  userPk: string,
  excludeSubscriptionId: string,
): Promise<string | null> {
  const remaining = await findActiveSubscriptionsByUserPk(db, userPk);
  // 조회가 starts_at DESC 정렬이므로 가장 최근 유료 구독이 우선된다. 매핑(정지된) 구독은 제외.
  const paid = remaining.find(
    (s) => s.subscriptionId !== excludeSubscriptionId && PAID_PLAN_TYPES.has(s.planType),
  );
  await db.execute({
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [paid ? planTypeToUserPlan(paid.planType) : 'free', userPk],
  });
  return paid ? paid.planType : null;
}

/**
 * 소유 그룹 해체: 소유자를 제외한 멤버들의 그룹 연동 구독을 취소하고 plan 을 재정렬한 뒤
 * 멤버 행을 전부 지운다. cancelSubscriptionImmediate 의 소유자 경로와, 그룹 연결이 빠진
 * 구독(스크립트 부여/레거시)을 위한 방어 스윕이 공유한다.
 * 반환: 강등된(소유자 제외) 멤버 user_id 목록 — 호출부가 plan_changed 통지 대상에 넣도록.
 */
async function disbandOwnedPlanGroup(
  db: DbExecutor,
  ownerUserPk: string,
  planGroupId: string,
  now: Date,
): Promise<string[]> {
  const disbanded: string[] = [];
  const memberRes = await db.execute({
    sql: `SELECT user_id, role FROM plan_group_members WHERE plan_group_id = ?`,
    args: [planGroupId],
  });
  for (const row of memberRes.rows) {
    const memberUserId = String(row.user_id);
    if (memberUserId === ownerUserPk) continue;

    const memberSubRes = await db.execute({
      sql: `SELECT id FROM subscriptions
            WHERE user_id = ? AND status = 'active' AND plan_group_id = ?`,
      args: [memberUserId, planGroupId],
    });
    for (const subRow of memberSubRes.rows) {
      await cancelOneSubscriptionRow(db, String(subRow.id), now);
    }
    // 멤버 강등에는 소유자의 삭제 옵션(options)을 전파하지 않는다. 취소를 개시하지
    // 않은 멤버의 알람·음성·메시지가 하드 삭제되는 것을 막기 위해 데이터는 보존한다
    // (RTDN deactivate 경로와 동일하게 deleteVoiceData:false). 하드 삭제는 취소를
    // 실제로 개시한 소유자 본인에게만 국한한다.
    await syncUserPlanAfterCancel(db, memberUserId, { deleteVoiceData: false });
    // 소유자 해지로 유료 접근을 잃는 멤버도 소유자와 동일 정책으로 유료 음성 보관
    // 보관을 예약한다 — 예약이 없으면 멤버의 유료 음성이 sweep 대상에서 빠져 영구
    // 잔존한다. 멤버가 자기 결제로 재구독하면 entitle/redeem 경로가 유예를 해제하고,
    // sweep 도 삭제 직전에 활성 유료 구독을 재확인하므로 과삭제 위험은 없다.
    await schedulePaidVoiceRetention(db, memberUserId, now);
    disbanded.push(memberUserId);
  }

  await db.execute({
    sql: `DELETE FROM plan_group_members WHERE plan_group_id = ?`,
    args: [planGroupId],
  });
  return disbanded;
}

// 결제 해지/만료 흐름의 기본은 "음성 보존"이다. 하드 삭제는 보관 유예(sweep)나
// 계정 삭제(account-deletion) 같은 명시적 경로에서만 deleteVoiceData:true 로 요청한다.
export async function cancelSubscriptionImmediate(
  db: DbExecutor,
  subscription: ActiveSubscription,
  now: Date = new Date(),
  options: CancelCleanupOptions = { deleteVoiceData: false },
): Promise<string[]> {
  // plan_changed 통지 대상: 취소 당사자 + 소유 그룹 해체로 함께 강등되는 멤버들.
  // (호출자가 트랜잭션 커밋 '후' notifyPlanChanged 로 푸시 — FCM 은 tx 안에서 쏘지 않는다.)
  const affected = new Set<string>([subscription.userPk]);
  await cancelOneSubscriptionRow(db, subscription.subscriptionId, now);
  await syncUserPlanAfterCancel(db, subscription.userPk, options);

  if (subscription.planGroupId) {
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
      return Array.from(affected);
    }

    for (const m of await disbandOwnedPlanGroup(db, subscription.userPk, subscription.planGroupId, now)) {
      affected.add(m);
    }
  }

  // 방어 스윕: 소유자 구독에 plan_group_id 연결이 없던 상태(스크립트 부여/레거시)에서 해지하면
  // 위 그룹 처리 전체가 스킵돼, 지불 주체 없는 소유 그룹이 잔존하고 멤버들이 그룹 게이트
  // (공유 목소리/가족 알람/클립 ACL)를 무기한 통과한다. 소유 그룹은 '그룹을 뒷받침할 수 있는'
  // 구독이 남아 있을 때만 유지한다 — personal 은 그룹을 만들 수 없으므로 유지 근거가 못 된다
  // (Codex #611 P1). 유지 조건: 소유자의 남은 활성 구독이 그 그룹에 직접 연결돼 있거나,
  // 그룹 연결이 빈(레거시) family 타입(커플 포함) 활성 구독이 남아 있는 경우.
  const remaining = await findActiveSubscriptionsByUserPk(db, subscription.userPk);
  const hasUnlinkedGroupCapablePlan = remaining.some(
    (s) => s.planType === 'family' && !s.planGroupId,
  );
  const ownedGroups = await db.execute({
    sql: `SELECT id FROM plan_groups WHERE owner_user_id = ?`,
    args: [subscription.userPk],
  });
  for (const row of ownedGroups.rows) {
    const groupId = String(row.id);
    if (groupId === subscription.planGroupId) continue;
    const backedByOwnerSub = remaining.some((s) => s.planGroupId === groupId);
    if (backedByOwnerSub || hasUnlinkedGroupCapablePlan) continue;
    for (const m of await disbandOwnedPlanGroup(db, subscription.userPk, groupId, now)) {
      affected.add(m);
    }
  }
  return Array.from(affected);
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
  // 그룹 이탈로 유료 접근을 잃어도 음성은 즉시 삭제하지 않고 보관 유예를 건다.
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
  // 새 구독이 생겼으면 남아 있던 보관 유예를 푼다 — 유예가 만기되어 유료 사용자의 음성이
  // 지워지는 일이 없도록. (sweep 이 삭제 직전에 한 번 더 확인하지만, 원장을 정확히 두는 게
  // 먼저다.)
  await clearPaidVoiceRetention(db, params.userPk);
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

/**
 * 강등/플랜변경으로 영향받은 사용자들에게 plan_changed 푸시(즉시성 목적). FIREBASE 설정이
 * 없거나(dev/테스트) 대상이 없으면 no-op. 실패해도 호출부 흐름을 깨지 않게 격리(로깅만).
 * **반드시 DB 트랜잭션 커밋 '후'에** 호출한다 — FCM 은 네트워크 I/O 라 tx 안에서 쏘면 안 된다.
 * (정확성은 클라 로컬 폴백[앱 시작 재조회 + 울림 시점 게이트]이 보장 — 푸시는 즉시성만.)
 */
export async function notifyPlanChanged(
  db: Client,
  env: Partial<Pick<Env, 'FIREBASE_PROJECT_ID' | 'FIREBASE_SERVICE_ACCOUNT_JSON'>> | undefined,
  userIds: string[],
): Promise<void> {
  if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_SERVICE_ACCOUNT_JSON || userIds.length === 0) {
    return;
  }
  try {
    await sendPlanChangedPush(
      db,
      {
        FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID,
        FIREBASE_SERVICE_ACCOUNT_JSON: env.FIREBASE_SERVICE_ACCOUNT_JSON,
      },
      userIds,
    );
  } catch (err) {
    logStructured('error', {
      at: 'billing.plan_changed_push',
      action: 'PLAN_CHANGED_PUSH_FAILED',
      error: String(err),
    });
  }
}

export async function processSubscriptionExpiry(
  db: Client,
  env?: ExpiryEnv,
  now: Date = new Date(),
): Promise<void> {
  // 무료로 강등된 사용자(소유자 + 가족 멤버) — 이후 FCM(plan_changed)으로 통지해 클라가 '강등 시점'에
  // 알람을 변환하게 한다.
  const notifyUserPks = new Set<string>();
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

    // 소유자 구독이 만료/변경되면(무료 강등뿐 아니라 개인플랜 예약 전환 포함) 소유 그룹이 해체돼
    // 멤버가 강등된다. cancelSubscriptionImmediate 가 취소 당사자+해체 멤버를 반환하므로 그대로
    // 통지 대상에 넣는다(과다통지는 클라가 재조회로 무시).
    const affected = await withWriteTransaction(db, async (tx) => {
      const ids = await cancelSubscriptionImmediate(tx, active, now, { deleteVoiceData: false });

      if (!nextPlanId) {
        // 예약취소 만료 — 음성은 즉시 삭제하지 않고 보관 유예를 건다(PAID_VOICE_RETENTION_DAYS).
        await schedulePaidVoiceRetention(tx, active.userPk, now);
        return ids;
      }
      const nextPlanRes = await tx.execute({
        sql: `SELECT id, plan_type, period_days, max_members
              FROM plans WHERE id = ? AND is_active = 1`,
        args: [nextPlanId],
      });
      if (nextPlanRes.rows.length === 0) return ids;

      const nextPlan = nextPlanRes.rows[0]!;
      await createNewSubscriptionForPlan(tx, {
        userPk: active.userPk,
        planId: String(nextPlan.id),
        planType: String(nextPlan.plan_type),
        periodDays: Number(nextPlan.period_days) || 30,
        maxMembers: Number(nextPlan.max_members) || 1,
        now,
      });
      return ids;
    });
    for (const id of affected) notifyUserPks.add(id);
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

    // 일반 만료도 소유자면 그룹 해체 → 멤버 강등. cancelSubscriptionImmediate 반환값(당사자+해체
    // 멤버)을 그대로 통지 대상에 넣는다.
    const affected = await withWriteTransaction(db, async (tx) => {
      const ids = await cancelSubscriptionImmediate(
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
      // 일반 만료도 하드삭제 대신 보관 유예(PAID_VOICE_RETENTION_DAYS).
      await schedulePaidVoiceRetention(tx, userPk, now);
      return ids;
    });
    for (const id of affected) notifyUserPks.add(id);
  }

  // 보관 유예가 끝난 유료 음성 데이터 정리 (같은 cron 주기에서 처리).
  // 이 정리는 플랜 변경 3일 뒤에 도는데, 그때 강등되는 알람의 주인(공유 목소리·가족알람
  // 수신자 포함)은 이번 주기의 만료 대상이 아니라 notifyUserPks 에 없다. 그대로 두면 이미
  // 오디오를 캐시해 둔 백그라운드 수신자가 다음 앱 시작/주기 동기화까지 지워진 녹음으로
  // 계속 울린다 — 그사이 알람이 먼저 울릴 수 있다. 반환된 대상을 푸시에 함께 태운다.
  for (const id of await sweepPaidVoiceRetention(db, now)) notifyUserPks.add(id);

  // 강등된 사용자에게 plan_changed 푸시 — 클라가 '강등 시점'에 유료 목소리 알람을 기본 알람으로
  // 변환하게 한다(백그라운드 여도). 과다발송해도 클라가 재조회로 확인.
  await notifyPlanChanged(db, env, Array.from(notifyUserPks));
}

export { planTypeToUserPlan };
