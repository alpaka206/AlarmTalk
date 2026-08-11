import type { Client } from '@libsql/client';
import { issueVoucherCode } from './voucher-issue';
import type { DbExecutor } from './transactions';
import { withWriteTransaction } from './transactions';
import {
  deletePaidVoiceDataForUser,
  deleteSensitiveVoiceDataForUser,
  releaseClonedVoicesForUser,
  type DowngradedAlarm,
} from './paid-voice-cleanup';
import { logStructured } from './logger';
import {
  ENTITLED_STATES,
  getPlaySubscriptionV2,
  isRecoverablePlayState,
  PlayBillingUnconfiguredError,
  type PlayEnv,
  type SubscriptionV2Response,
} from './play-subscriptions';
import {
  APPLE_SUBSCRIPTION_STATUS,
  AppleTransactionNotFoundError,
  appleStoreKitConfigFromEnv,
  fetchAppleSubscriptionStatus,
  type AppleSubscriptionStatus,
} from './apple-storekit';
import { PAID_PLAN_TYPES, planTypeToUserPlan, plannedMaxUses, isGroupPlanType } from '../routes/billing-helpers';
import { notifyDowngradedAlarms, sendPlanChangedPush } from './fcm';
import type { Env } from '../types';

// 만료 크론이 FCM(plan_changed) 을 쏘려면 Play env 외에 FIREBASE 설정도 필요하다. index.ts 의 scheduled
// 핸들러가 워커 env(전체)를 넘기므로 런타임엔 존재하며, 타입만 넓혀 준다.
// 애플 재조회(reconcileAppleBeforeExpiry)에는 App Store Server API 자격증명도 필요하다.
type ExpiryEnv = PlayEnv &
  Partial<
    Pick<
      Env,
      | 'FIREBASE_PROJECT_ID'
      | 'FIREBASE_SERVICE_ACCOUNT_JSON'
      | 'APPLE_ISSUER_ID'
      | 'APPLE_KEY_ID'
      | 'APPLE_PRIVATE_KEY'
      | 'APPLE_BUNDLE_ID'
      | 'ENVIRONMENT'
      // iOS 신호 푸시(APNs). 없으면 발송부가 조용히 건너뛴다.
      | 'APNS_KEY_ID'
      | 'APNS_PRIVATE_KEY'
      | 'APPLE_TEAM_ID'
    >
  >;

export interface ActiveSubscription {
  subscriptionId: string;
  userPk: string;
  planId: string;
  /**
   * **행동 분류** — 그룹을 갖는가(`isGroupPlanType`). 커플도 여기서는 'family' 다.
   * 그룹 생성·초대·해체 같은 **구조** 판정에 쓴다.
   */
  planType: string;
  /**
   * **상품** — `personal` / `couple` / `family`.
   *
   * ⚠ 커플과 가족의 **차별점은 여기서 가른다.** 지금은 정원(2 vs 5)만 다르지만,
   * 나중에 커플에만 있는 기능이 생기면 `plan_type` 을 쪼갤 게 아니라 이 값을 본다 —
   * `plan_type` 은 "그룹형인가" 라는 구조 질문이고, 상품 차이는 `key` 의 몫이다.
   * (쪼개면 그룹 경로 전부가 목록 검사가 되고, 한 곳만 빠뜨려도 커플이 조용히 깨진다.)
   */
  planKey: string;
  planGroupId: string | null;
}


export async function findActiveSubscriptionsByUserPk(
  db: DbExecutor,
  userPk: string,
): Promise<ActiveSubscription[]> {
  const res = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id, p.plan_type, p.key AS plan_key
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
    planKey: String(r.plan_key),
    planGroupId: (r.plan_group_id as string | null) ?? null,
  }));
}

type CancelCleanupOptions = {
  deleteVoiceData?: boolean;
  /**
   * **해체하지 않고 넘겨줄 소유 그룹** — 그룹형 plan 사이 전환(커플 ↔ 가족)에서 쓴다.
   *
   * ⚠ **이게 없으면 업그레이드가 그룹을 부순다.** 전환은 새 purchaseToken 이라
   * `applyStoreEntitlement` 의 신규 구독 경로를 타고, 거기서 기존 활성 구독을 취소하는데
   * 소유자 갈래는 `disbandOwnedPlanGroup` 으로 **멤버를 전부 내쫓고 초대 코드까지
   * 만료**시킨다. 가족 → 개인 다운그레이드라면 맞는 동작이지만(그룹을 뒷받침할 결제가
   * 사라지므로), 커플 → 가족은 **더 비싼 걸 산 것**인데 파트너가 쫓겨났다.
   * 이 값이 주어진 그룹은 멤버·코드를 그대로 두고 새 구독에 다시 매단다.
   */
  preserveGroupId?: string | null;
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
): Promise<{ targets: DowngradedAlarm[]; cleanedUserPks: string[] }> {
  // 이 정리로 강등된 알람들 — 호출자가 커밋 후 신호를 보낸다.
  const downgraded = new Map<string, DowngradedAlarm>();
  // 실제로 음성 데이터를 정리한 사용자들. 알람 행을 못 찾아도 이 계정에는 접근권 상실을
  // 알려야 한다(서버에 아직 동기화되지 않은 로컬 알람이 있을 수 있다).
  const cleanedUserPks: string[] = [];
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
    // 한 사용자에서 실패해도 나머지를 버리지 않는다. 예외가 위로 새면 호출부가
    // notifyDowngradedAlarms 까지 못 가서, 이미 정리·마커 삭제까지 끝난 앞 사용자들의
    // 알림이 통째로 사라진다 — 마커가 없으니 다음 크론이 복구할 수도 없다.
    // 실패한 사용자는 마커를 그대로 둬(아래 clear 를 건너뛴다) 다음 크론이 다시 시도한다.
    try {
      const affected = await deleteSensitiveVoiceDataForUser(
        db,
        userPk,
        await resolveUserLoginId(db, userPk),
      );
      for (const target of affected) downgraded.set(target.alarmId, target);
      cleanedUserPks.push(userPk);
      await clearPaidVoiceRetention(db, userPk);
    } catch (err) {
      logStructured('error', {
        at: 'billing.paid_voice_retention_sweep',
        action: 'RETENTION_CLEANUP_FAILED',
        error: String(err),
      });
    }
  }
  return { targets: Array.from(downgraded.values()), cleanedUserPks };
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
  /**
   * 이어받는 그룹의 구독이면 **코드를 만료시키지 않는다.** 만료시키면 이미 카톡으로
   * 뿌린 초대 코드가 조용히 죽어, 소유자는 새 코드를 다시 찾아 재초대해야 한다.
   * 새 구독으로 다시 매다는 일은 호출부(`applyStoreEntitlement`)가 한다.
   */
  keepVouchers = false,
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
  if (!keepVouchers) await expireUnusedVouchersFor(db, subscriptionId);
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
  /**
   * 제외할 구독 id. **여러 개를 한 번에 넘겨야 한다** — 예전에는 문자열 하나만 받아서,
   * 한 사람이 같은 그룹에 활성 구독을 둘 이상 가지면 마지막 것만 제외되고 나머지가
   * 유료로 남아 **강등이 안 됐다**(주석은 '전부 제외한다' 였는데 코드가 반대였다).
   */
  excludeSubscriptionIds: string | readonly string[],
): Promise<string | null> {
  const excluded = new Set(
    typeof excludeSubscriptionIds === 'string' ? [excludeSubscriptionIds] : excludeSubscriptionIds,
  );
  const remaining = await findActiveSubscriptionsByUserPk(db, userPk);
  // 조회가 starts_at DESC 정렬이므로 가장 최근 유료 구독이 우선된다. 매핑(정지된) 구독은 제외.
  const paid = remaining.find(
    (s) => !excluded.has(s.subscriptionId) && PAID_PLAN_TYPES.has(s.planType),
  );
  await db.execute({
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [paid ? planTypeToUserPlan(paid.planType) : 'free', userPk],
  });
  return paid ? paid.planType : null;
}

/**
 * 보류/복구를 **그룹 멤버 전체에 전파**한다. 소유자는 호출부가 따로 처리한다.
 *
 * ⚠ **왜 필요한가.** `resolvePlanAfterSuspend` 는 인자로 받은 **한 사람**만 처리한다.
 * 그래서 소유자 결제가 밀려도 멤버들의 `users.plan` 은 유료 그대로였다 — 소유자는
 * 돈을 안 내는데 가족·커플 멤버 전원이 최대 30일(Play 계정보류)간 유료 기능을 계속
 * 썼다. 게다가 멤버 화면에는 공유 목소리가 멀쩡히 보이는데 그걸로 새 알람을 만들면
 * 404 로 막혀서(소유자 플랜 게이트), **보이는데 안 되는** 상태가 됐다.
 *
 * ⚠ **그룹 구조는 건드리지 않는다.** `plan_group_members` 와 멤버의 `subscriptions`
 * 행은 그대로 둔다 — 결제가 복구되면 재초대 없이 그대로 살아나야 한다. 카드 하나
 * 만료됐다고 가족 다섯 명을 다시 초대하게 만들 수는 없다.
 *
 * ⚠ **멤버가 자기 개인 구독을 따로 가진 경우를 지켜야 한다.** 그래서 값을 직접
 * 대입하지 않고 `resolvePlanAfterSuspend` 를 그대로 재사용한다 — 그 함수가 남은 활성
 * 구독에서 plan 을 다시 계산하므로, 자기 결제가 있으면 그 등급이 유지된다.
 *
 * 커플도 같은 경로다(`isGroupPlanType` 주석 참조 — 커플은 정원 2명짜리 그룹이다).
 *
 * @param suspend `true` 면 그룹 구독을 제외하고 재계산(→ 대개 free),
 *                `false` 면 제외 없이 재계산(→ 그룹 플랜으로 복구).
 * @returns 실제로 plan 이 바뀐 멤버들의 userPk (알림 대상).
 */
export async function propagateGroupMemberPlans(
  db: DbExecutor,
  planGroupId: string,
  ownerUserPk: string,
  suspend: boolean,
): Promise<string[]> {
  const memberRes = await db.execute({
    sql: `SELECT user_id FROM plan_group_members WHERE plan_group_id = ? AND user_id != ?`,
    args: [planGroupId, ownerUserPk],
  });

  const affected: string[] = [];
  for (const row of memberRes.rows) {
    const memberPk = String(row.user_id);

    const before = await db.execute({
      sql: `SELECT plan FROM users WHERE id = ?`,
      args: [memberPk],
    });
    const planBefore = before.rows.length > 0 ? String(before.rows[0]!.plan ?? 'free') : 'free';

    // 보류: 이 그룹에 묶인 멤버 구독을 **제외**하고 재계산한다. 멤버가 자기 개인
    // 구독을 따로 샀다면 그건 그대로 남는다.
    // 복구: 제외 없이 재계산 — 그룹 구독이 다시 잡혀 원래 등급으로 돌아온다.
    if (suspend) {
      const memberSubRes = await db.execute({
        sql: `SELECT id FROM subscriptions
              WHERE user_id = ? AND status = 'active' AND plan_group_id = ?`,
        args: [memberPk, planGroupId],
      });
      // 한 멤버가 같은 그룹에 활성 구독을 둘 이상 갖는 일은 없지만, 있어도 **전부**
      // 제외해야 한다 — 하나만 빼면 나머지가 유료로 남아 강등이 안 된다.
      // 행이 없으면 빈 배열이라 '제외 없이 재계산' 과 같은 뜻이 된다(방어적).
      await resolvePlanAfterSuspend(
        db,
        memberPk,
        memberSubRes.rows.map((r) => String(r.id)),
      );
    } else {
      await resolvePlanAfterSuspend(db, memberPk, []);
    }

    const after = await db.execute({
      sql: `SELECT plan FROM users WHERE id = ?`,
      args: [memberPk],
    });
    const planAfter = after.rows.length > 0 ? String(after.rows[0]!.plan ?? 'free') : 'free';
    // ⚠ **바뀐 사람만 알린다.** 안 바뀐 멤버(자기 결제가 따로 있는 사람)에게
    // "결제가 실패했어요" 를 보내면 자기 카드에 문제가 생긴 줄 안다.
    if (planBefore !== planAfter) affected.push(memberPk);
  }
  return affected;
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
  const preservedGroupId = options.preserveGroupId ?? null;
  const preservingThisSub =
    preservedGroupId !== null && subscription.planGroupId === preservedGroupId;
  await cancelOneSubscriptionRow(db, subscription.subscriptionId, now, preservingThisSub);
  // 이어받는 전환에서는 사용자가 곧바로 새 유료 구독을 갖는다 — 여기서 free 로 떨구면
  // 그 사이 상태가 free 로 찍히고, 멤버 plan 전파도 free 기준으로 돈다.
  if (!preservingThisSub) {
    await syncUserPlanAfterCancel(db, subscription.userPk, options);
  }

  if (subscription.planGroupId && !preservingThisSub) {
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
    (s) => isGroupPlanType(s.planType) && !s.planGroupId,
  );
  const ownedGroups = await db.execute({
    sql: `SELECT id FROM plan_groups WHERE owner_user_id = ?`,
    args: [subscription.userPk],
  });
  for (const row of ownedGroups.rows) {
    const groupId = String(row.id);
    if (groupId === subscription.planGroupId) continue;
    // 이어받기로 넘길 그룹은 방어 스윕에서도 건드리지 않는다.
    if (groupId === preservedGroupId) continue;
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

  if (isGroupPlanType(params.planType)) {
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

  if (isGroupPlanType(params.planType)) {
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
): Promise<'expire' | 'skip' | 'suspend'> {
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
  if (!stillEntitled) {
    // ⚠ **ON_HOLD/PAUSED 를 'expire' 로 보내면 그룹이 해체된다.** RTDN 이 보류로
    // 그룹을 보존해도, 구독 행은 status='active' + 옛 expires_at 으로 남아 이 크론의
    // 만료 쿼리에 **바로 걸린다**(5분 주기). 그러면 `cancelSubscriptionImmediate` →
    // `disbandOwnedPlanGroup` 이 멤버십을 통째로 지우고, 결제가 복구돼도 초대 코드까지
    // 만료돼 **가족·커플이 영구히 깨진다.** 판정은 RTDN 과 같은 헬퍼를 쓴다.
    // ⚠ `!stillEntitled` **이후에만** 갈라야 한다 — 앞에 두면 '기간종료 해지 예약 +
    //    만료 미래'(CANCELED)까지 보류로 새어 나간다.
    return isRecoverablePlayState(state) ? 'suspend' : 'expire';
  }

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
 * 애플 결제 구독의 만료 재조회. `reconcileGoogleBeforeExpiry` 의 애플 판.
 *
 * ⚠ **이게 없으면 돈은 내는데 기능을 잃는다.** 애플에는 Play 의 RTDN 에 해당하는
 * 서버 알림을 우리가 받는 라우트가 없고(App Store Server Notifications 미구현),
 * 구독 연장은 **앱이 전경으로 올라올 때** iOS 가 `resyncEntitlements` 로 알려 주는 게
 * 전부였다. 알람 앱은 안 열어도 울리므로 한 달 넘게 안 여는 사용자가 흔한데, 그 사이
 * 5분마다 도는 만료 크론이 `expires_at` 을 지나 **무료로 강등**시킨다 —
 * 목소리 알람이 잠기고(applyFreePlanVoiceLock) 애플은 계속 청구한다.
 *
 * 그래서 구글과 **같은 모양**으로 만료 직전 스토어에 되묻는다.
 */
async function reconcileAppleBeforeExpiry(
  db: Client,
  env: ExpiryEnv | undefined,
  params: {
    subscriptionId: string;
    userPk: string;
    planType: string;
    expiresAt: string;
    now: Date;
  },
): Promise<'expire' | 'skip' | 'suspend'> {
  const txnRes = await db.execute({
    sql: `SELECT provider_transaction_id FROM store_transactions
          WHERE subscription_id = ? AND provider = 'apple'`,
    args: [params.subscriptionId],
  });
  if (txnRes.rows.length === 0) return 'expire';

  // env 미설정(dev/테스트) — 재조회 없이 현행대로 만료 진행(구글과 같은 규칙).
  const config = appleStoreKitConfigFromEnv(env ?? {});
  if (!config) return 'expire';

  const originalTransactionId = String(txnRes.rows[0]!.provider_transaction_id);
  let status: AppleSubscriptionStatus;
  try {
    status = await fetchAppleSubscriptionStatus(originalTransactionId, config);
  } catch (err) {
    // 구독이 애플에 아예 없다 → 만료가 맞다.
    if (err instanceof AppleTransactionNotFoundError) return 'expire';
    // 일시 장애 — 이번 run 은 보류하고 다음 run 에 재시도. 단 만료가 72시간 넘게
    // 지났으면 강행한다(영구 좀비 방지). 구글 갈래와 같은 규칙이다.
    const expiredMs = new Date(params.expiresAt).getTime();
    const forceExpire =
      Number.isFinite(expiredMs) && expiredMs <= params.now.getTime() - 72 * 60 * 60 * 1000;
    logStructured('warn', {
      at: 'billing.expiry.reconcile.apple',
      subscriptionId: params.subscriptionId,
      error: String(err),
      forceExpire,
    });
    return forceExpire ? 'expire' : 'skip';
  }

  // ⚠ ACTIVE 만 보면 안 된다. 결제 재시도(3)와 유예기간(4)도 **아직 권한이 있다** —
  // 카드가 잠깐 막힌 사용자를 그 자리에서 무료로 떨어뜨리면, 결제가 통과한 뒤에도
  // 알람은 이미 잠긴 채다. 구글 갈래가 CANCELED 를 살려 두는 것과 같은 취지다.
  // ⚠ **재시도(3)와 유예(4)는 다르다.** 유예는 애플이 **명시적으로 접근을 허용**하는
  // 기간이라 그대로 유료다. 재시도는 유예가 끝났거나 애초에 유예를 안 걸어 둔 상태로,
  // 결제가 실패한 채 카드만 다시 긁고 있는 것이다 — 구글의 ON_HOLD 에 해당한다.
  // 정책(사용자 확정): **결제 실패 보류 기간에는 free.** 그래서 3 은 권한에서 뺀다.
  const entitledStatuses: number[] = [
    APPLE_SUBSCRIPTION_STATUS.ACTIVE,
    APPLE_SUBSCRIPTION_STATUS.IN_GRACE_PERIOD,
  ];
  const expiryMs = status.expiresDate ?? NaN;
  const stillEntitled =
    entitledStatuses.includes(status.status) &&
    Number.isFinite(expiryMs) &&
    expiryMs > params.now.getTime();
  if (!stillEntitled) {
    // ⚠ **재시도는 회복형이라 'expire' 로 보내면 안 된다.** expire 는 그룹을 해체하고
    // 멤버를 전원 떼어내는 종료 처리라, 카드가 며칠 막힌 것으로 가족 다섯 명이
    // 재초대 대상이 된다. 권한만 회수하고 구조는 남기는 'suspend' 로 보낸다
    // (구글의 ON_HOLD 갈래와 같은 취급).
    return status.status === APPLE_SUBSCRIPTION_STATUS.IN_BILLING_RETRY ? 'suspend' : 'expire';
  }

  // 애플이 아직 유효하다고 한다 — 만료 대신 애플 권위값으로 연장한다.
  // 자동갱신이 꺼져 있으면(사용자가 App Store 에서 해지) 기간종료 해지 예약 상태로 세운다.
  const expiryIso = new Date(expiryMs).toISOString();
  const cancelAtPeriodEnd = status.autoRenewStatus === 0 ? 1 : 0;
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
            WHERE provider = 'apple' AND provider_transaction_id = ?`,
      args: [expiryIso, originalTransactionId],
    });
  });
  logStructured('info', {
    at: 'billing.expiry.reconcile.apple',
    action: 'extended',
    subscriptionId: params.subscriptionId,
    expiresAt: expiryIso,
    status: status.status,
  });
  return 'skip';
}

/**
 * 만료 직전 **스토어에 되묻는다.** 결제 스토어에 따라 갈라진다.
 *
 * ⚠ 새 스토어를 붙이면 **여기에 갈래를 추가해야 한다.** 빠뜨리면 그 스토어 구독은
 * 재조회 없이 만료된다 — 애플이 정확히 그 상태였다(구글 갈래만 있어서, 애플 결제는
 * 스토어에 묻지도 않고 강등됐다).
 */
async function reconcileStoreBeforeExpiry(
  db: Client,
  env: ExpiryEnv | undefined,
  params: {
    subscriptionId: string;
    userPk: string;
    planType: string;
    expiresAt: string;
    now: Date;
  },
): Promise<'expire' | 'skip' | 'suspend'> {
  const google = await reconcileGoogleBeforeExpiry(db, env, params);
  // ⚠ **'expire' 일 때만 애플에 물어본다.** 'skip'(아직 유효)과 'suspend'(보류)는
  // 구글이 내린 확정 판정이라 그대로 돌려줘야 한다. 예전에는 'skip' 만 단락시켜서,
  // 구글이 'suspend' 를 내도 애플 갈래가 다시 돌고 애플 트랜잭션이 없어 'expire' 로
  // 덮였다 — 보류가 통째로 무효가 되는 자리였다.
  if (google !== 'expire') return google;
  // 구글 트랜잭션이 없어 'expire' 가 나왔을 수 있다 — 애플도 물어본다.
  // (한 구독이 두 스토어에 동시에 묶이는 일은 없으므로 순서는 무해하다.)
  return reconcileAppleBeforeExpiry(db, env, params);
}

/**
 * 강등/플랜변경으로 영향받은 사용자들에게 plan_changed 푸시(즉시성 목적). FIREBASE 설정이
 * 없거나(dev/테스트) 대상이 없으면 no-op. 실패해도 호출부 흐름을 깨지 않게 격리(로깅만).
 * **반드시 DB 트랜잭션 커밋 '후'에** 호출한다 — FCM 은 네트워크 I/O 라 tx 안에서 쏘면 안 된다.
 * (정확성은 클라 로컬 폴백[앱 시작 재조회 + 울림 시점 게이트]이 보장 — 푸시는 즉시성만.)
 */
export async function notifyPlanChanged(
  db: Client,
  env: ExpiryEnv | undefined,
  userIds: string[],
): Promise<void> {
  // ⚠ **Firebase 값만 뽑아 넘기지 말 것.** 예전에는 두 필드만 새 객체로 만들어 넘겼는데,
  // 그러면 APNs 설정(`APNS_*`·`APPLE_TEAM_ID`·`APPLE_BUNDLE_ID`)이 통째로 떨어져
  // **iOS 기기에는 신호가 영영 안 간다** — 강등/복구가 반영되지 않는다.
  // env 를 그대로 넘기고, 어느 쪽 키가 없든 발송부가 알아서 건너뛴다.
  //
  // ⚠ 게이트도 Firebase 로만 걸면 안 된다. iOS 전용 사용자에게 보낼 때
  // Firebase 가 비어 있다고 전체를 막으면 APNs 까지 같이 죽는다.
  const hasFirebase = Boolean(env?.FIREBASE_PROJECT_ID && env?.FIREBASE_SERVICE_ACCOUNT_JSON);
  const hasApns = Boolean(env?.APNS_KEY_ID && env?.APNS_PRIVATE_KEY && env?.APPLE_TEAM_ID);
  if ((!hasFirebase && !hasApns) || userIds.length === 0) {
    return;
  }
  try {
    await sendPlanChangedPush(db, env as ExpiryEnv, userIds);
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
                 s.expires_at, p.plan_type, p.key AS plan_key
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
      planKey: String(r.plan_key),
      planGroupId: (r.plan_group_id as string | null) ?? null,
    };
    const nextPlanId = (r.next_plan_id as string | null) ?? null;

    // 만료 처리 전에 Play 실상태 재조회 — RTDN 을 놓쳐 DB 만료가 뒤처진 경우
    // 즉시 해지 대신 연장한다.
    const decision = await reconcileStoreBeforeExpiry(db, env, {
      subscriptionId: active.subscriptionId,
      userPk: active.userPk,
      planType: active.planType,
      expiresAt: String(r.expires_at ?? ''),
      now,
    });
    if (decision === 'skip') continue;
    // ⚠ **보류는 종료가 아니다.** 권한(소유자+멤버 plan)만 회수하고 그룹·구독 행은
    // 남긴다 — 결제가 복구되면 재초대 없이 살아나야 한다(구글 ON_HOLD 와 같은 취급).
    if (decision === 'suspend') {
      await resolvePlanAfterSuspend(db, active.userPk, active.subscriptionId);
      if (active.planGroupId) {
        await propagateGroupMemberPlans(db, active.planGroupId, active.userPk, true);
      }
      continue;
    }

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
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id, s.expires_at, p.plan_type, p.key AS plan_key
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.status = 'active' AND s.expires_at <= ? AND s.cancel_at_period_end = 0`,
    args: [now.toISOString()],
  });
  for (const r of expiredRes.rows) {
    const subscriptionId = String(r.sub_id);
    const userPk = String(r.user_id);
    const planType = String(r.plan_type);

    const decision = await reconcileStoreBeforeExpiry(db, env, {
      subscriptionId,
      userPk,
      planType,
      expiresAt: String(r.expires_at ?? ''),
      now,
    });
    if (decision === 'skip') continue;
    // 보류 — 권한만 회수하고 그룹은 남긴다(위 갈래와 같은 이유).
    if (decision === 'suspend') {
      await resolvePlanAfterSuspend(db, userPk, subscriptionId);
      const groupId = (r.plan_group_id as string | null) ?? null;
      if (groupId) await propagateGroupMemberPlans(db, groupId, userPk, true);
      continue;
    }

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
          planKey: String(r.plan_key),
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
  const sweptVoiceData = await sweepPaidVoiceRetention(db, now);

  // 강등된 사용자에게 plan_changed 푸시 — 클라가 '강등 시점'에 유료 목소리 알람을 기본 알람으로
  // 변환하게 한다(백그라운드 여도). 과다발송해도 클라가 재조회로 확인.
  await notifyPlanChanged(db, env, Array.from(notifyUserPks));

  // 보관 정리가 서버에서 바꾼 '알람 행'은 plan_changed 로는 안 따라온다 — 이유는
  // notifyDowngradedAlarms 참고. 강등된 알람마다 알람 동기화 신호를 보낸다.
  await notifyDowngradedAlarms(db, env, sweptVoiceData.targets, sweptVoiceData.cleanedUserPks);
}

export { planTypeToUserPlan };
