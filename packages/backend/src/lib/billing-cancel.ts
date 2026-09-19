import type { Client, InStatement } from '@libsql/client';
import { issueVoucherCode } from './voucher-issue';
import type { DbExecutor } from './transactions';
import {
  clonedVoiceReleaseStatements,
  deletePaidVoiceDataForUser,
  deleteSensitiveVoiceDataForUser,
  releaseClonedVoicesForUser,
  type DowngradedAlarm,
} from './paid-voice-cleanup';
import { logStructured } from './logger';
import type { PlayEnv } from './play-subscriptions';
import {
  BillingStateUnavailableError,
  expireSubscriptionIfDue,
  reconcileStoreSubscription,
} from './billing-reconciliation';
import {
  PAID_PLAN_TYPES,
  planTypeToUserPlan,
  plannedMaxUses,
  isGroupPlanType,
} from '../routes/billing-helpers';
import { notifyDowngradedAlarms, sendPlanChangedPush } from './fcm';
import { sendVoiceDeletionWarningPush } from './fcm';
import type { Env } from '../types';

// 만료 크론이 FCM(plan_changed) 을 쏘려면 Play env 외에 FIREBASE 설정도 필요하다. index.ts 의 scheduled
// 핸들러가 워커 env(전체)를 넘기므로 런타임엔 존재하며, 타입만 넓혀 준다.
// 공통 스토어 재조회에는 App Store Server API 자격증명도 필요하다.
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
  /**
   * **기간 종료로 해지가 예약됐는가.** 아직 유료지만 **다음 갱신은 없다.**
   *
   * ⚠ '지금 권한이 있는가' 와 '갱신을 쥐고 있는가' 는 다른 질문이다 —
   * `storeRenewalProvidersOf` 가 이걸 봐야 한다(코덱스 #733 6차).
   */
  cancelAtPeriodEnd: boolean;
  /** 스토어 생존(status)과 별개인 권한 상태. 목록 조회는 항상 이 값을 채운다. */
  entitlementState?: string;
}

export async function findActiveSubscriptionsByUserPk(
  db: DbExecutor,
  userPk: string,
): Promise<ActiveSubscription[]> {
  const res = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id,
                 s.cancel_at_period_end, s.entitlement_state, p.plan_type, p.key AS plan_key
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
    cancelAtPeriodEnd: Number(r.cancel_at_period_end ?? 0) === 1,
    entitlementState: String(r.entitlement_state ?? 'entitled'),
  }));
}

/**
 * 활성 구독에 묶인 스토어 결제 기록.
 *
 * ⚠ 다중 활성 구독이 각각 다른 토큰에 묶인 경우까지 전부 가져온다 — 첫 구독의 토큰만
 * 취소하면 나머지 토큰이 계속 과금된다.
 */
export interface SubscriptionStoreTransaction {
  provider: string;
  purchaseToken: string;
  productId: string;
  /** 어느 구독에 묶였는가 — 호출부가 '갱신 예정인 것' 만 골라 낼 때 쓴다. */
  subscriptionId: string;
}

export async function findStoreTransactionsForSubscriptions(
  db: DbExecutor,
  subscriptionIds: string[],
): Promise<SubscriptionStoreTransaction[]> {
  if (subscriptionIds.length === 0) return [];
  // IN 플레이스홀더는 개발자 고정 조각(값 개수만큼 `?`) — 값은 전부 ?-바인딩.
  const inPh = subscriptionIds.map(() => '?').join(', ');
  const res = await db.execute({
    sql: `SELECT provider, provider_transaction_id, product_id, subscription_id
          FROM store_transactions WHERE subscription_id IN (${inPh})`,
    args: subscriptionIds,
  });
  return res.rows.map((row) => ({
    provider: String(row.provider),
    purchaseToken: String(row.provider_transaction_id),
    productId: String(row.product_id),
    subscriptionId: String(row.subscription_id ?? ''),
  }));
}

/**
 * **해지가 어느 스토어를 거쳐야 하는가.** `POST /billing/cancel` 의 판정과
 * `GET /billing/subscription` 이 앱에 알려 주는 값이 **같은 함수**에서 나와야 한다.
 *
 * ⚠ 앱이 이 판정을 **로컬 스토어 상태로 흉내 내면 안 된다**(코덱스 #732). 아이폰에서
 * 산 옛 구독의 entitlement 가 기기에 남아 있는 채로 지금은 Play 구독을 쓰는 사용자가
 * 있다 — 로컬만 보면 애플 관리 시트를 열고 `/billing/cancel` 을 **부르지 않아**,
 * 사용자는 해지했다고 믿는데 Play 구독이 계속 갱신된다.
 *
 * 애플이 먼저인 이유: 해지 라우트가 활성 구독 중 **하나라도** 애플 결제면 409
 * `STORE_CANCEL_UNSUPPORTED` 로 거절한다(서버가 애플 구독을 끊을 방법이 없다).
 * 이 값은 그 결정의 예고편이므로 같은 우선순위여야 한다.
 *
 * `null` 은 스토어 결제가 아니라는 뜻이다(dev 스텁·프로모·바우처) — 서버 로컬 해지가 된다.
 */
/**
 * **활성 구독에 묶인 스토어 전부** — 지금 이 계정의 갱신을 누가 쥐고 있는가.
 *
 * ⚠ `storeCancelProviderOf` 와 **다른 질문이다.** 그쪽은 "해지가 어느 스토어를 거치나" 라
 * 애플이 있으면 애플로 **접어 버린다**(해지 라우트가 그렇게 판정하므로). 여기서 그 값을
 * 재사용하면 애플·구글이 **함께 살아 있는 계정**이 "애플뿐" 으로 읽혀, Play 가 계속
 * 갱신되는데도 애플 결제를 또 열어 준다(코덱스 #733 3차).
 *
 * ⚠ **해지 예약된 구독은 넣지 말 것**(코덱스 #733 6차). `cancel_at_period_end = 1` 은
 * "아직 유료지만 **다음 갱신은 없다**" 는 뜻이다. 그걸 갱신 주인으로 세면, 안내대로 Play 에서
 * 해지한 사용자가 **남은 기간 내내 애플로 못 산다** — 우리가 하라고 한 일을 했는데 막힌다.
 * 호출부가 `cancelAtPeriodEnd` 인 구독을 빼고 넘긴다.
 *
 * ⚠ **만료로 거르지 않는다.** Play 보류(`ON_HOLD`/`PAUSED`)는 회복형이라 구독 행을
 * `active` 로 남기고 `users.plan` 만 회수하는데, 그 행은 `expires_at` 이 이미 지나 있다.
 * 만료로 거르면 보류 중인 Play 구독이 **보이지 않게 되고**, 그 상태에서 애플로 사면
 * 결제가 복구되는 순간 두 곳에서 청구된다.
 */
/**
 * **다른 스토어(애플)가 정말 갱신 중인지 애플에 물어 갱신 상태를 최신화한다.**
 *
 * ⚠ **애플 상태는 가만두면 낡는다**(코덱스 #733 8차). 우리가 받는 App Store 서버 알림이
 * 없고, `applyStoreEntitlement` 의 같은-플랜 갱신 갈래는 `cancel_at_period_end` 를 **0 으로
 * 되돌린다.** 그래서 사용자가 App Store 에서 자동갱신을 껐어도 우리 DB 는 "갱신 중" 으로
 * 남고, 그 상태로 Play 결제를 막으면 **사용자가 할 수 있는 일이 없다** — 이미 껐는데도
 * 막히고, 우리 안내(`다른 스토어에서 먼저 해지하세요`)를 따라도 달라지지 않는다.
 *
 * Play 쪽은 이 문제가 없다 — RTDN 과 해지 라우트가 `cancel_at_period_end` 를 제때 세운다.
 *
 * 확인 실패는 호출부로 전달해 확정을 재시도한다. 미확인 상태를 갱신 중단으로 추정하지 않는다.
 */
export async function refreshCompetingAppleRenewalState(
  db: Client,
  env: Partial<Env> | undefined,
  userPk: string,
): Promise<boolean> {
  const result = await db.execute({
    sql: `SELECT DISTINCT s.id FROM subscriptions s
          JOIN store_transactions t ON t.subscription_id = s.id
          WHERE s.user_id = ? AND s.status = 'active' AND t.provider = 'apple'`,
    args: [userPk],
  });
  for (const row of result.rows) {
    await reconcileStoreSubscription(db, env ?? {}, String(row.id));
  }
  return result.rows.length > 0;
}

export function storeRenewalProvidersOf(
  transactions: readonly SubscriptionStoreTransaction[],
): string[] {
  return Array.from(new Set(transactions.map((txn) => txn.provider))).sort();
}

export function storeCancelProviderOf(
  transactions: readonly SubscriptionStoreTransaction[],
): 'apple' | 'google' | null {
  if (transactions.some((txn) => txn.provider === 'apple')) return 'apple';
  if (transactions.some((txn) => txn.provider === 'google')) return 'google';
  return null;
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
 * ⚠ **이 값을 줄이면 데이터가 그만큼 빨리 영구 삭제된다.** 예전 주석은 "지우는 코드가
 * 없다 / 스윕은 장부 행만 지운다" 고 적혀 있었으나 **코드와 달랐다**(2026-09-01 정정).
 * `sweepPaidVoiceRetention` 은 기한이 지난 사용자마다 `deleteSensitiveVoiceDataForUser`
 * 를 태워 `voice_profiles`·`voice_uploads`·`generated_audio_assets`·`messages` 를 지우고
 * R2·ElevenLabs 오브젝트를 삭제 큐에 넣는다 — 되돌릴 수 없다.
 *
 * 무료 전환 **시점**에는 지우지 않는다. 그때는 제공자 클론만 반납하고(`evicted_*` 표식)
 * 유예 동안 데이터를 살려 두며, 그 사이 다시 유료가 되면 원본으로 재클론해 돌아온다
 * (`recloneEvictedVoiceProfile`). 스윕도 삭제 직전에 `hasActivePaidEntitlement` 로 한 번
 * 더 확인한다.
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
export async function hasActivePaidEntitlement(db: DbExecutor, userPk: string): Promise<boolean> {
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
 * `syncPaidVoiceRetention` 을 **문장 둘**로 — 묶음(`batch`) 안에서 쓰려고 둔다.
 *
 * 유료 판정을 JS 가 아니라 **실행 시점의 SQL** 로 한다. 같은 묶음의 앞 문장(구독 취소·등급
 * 변경)이 반영된 상태를 봐야 `syncPaidVoiceRetention` 과 같은 답이 나온다.
 * 조건은 `hasActivePaidEntitlement` 와 **같아야 한다** — 한쪽만 고치지 말 것
 * (`test/group-disband-batch.test.ts` 가 두 경로를 같은 상태에서 대조한다).
 * 둘 중 정확히 하나만 적용된다: 유료면 기한을 지우고, 아니면 기한을 건다(upsert).
 */
export function retentionSyncStatements(userPk: string, now: Date): InStatement[] {
  const paid = `((SELECT COUNT(*) FROM subscriptions
                   WHERE user_id = ? AND status = 'active'
                     AND datetime(expires_at) > datetime('now')) > 0
                 OR (COALESCE((SELECT plan FROM users WHERE id = ?), 'free') <> 'free'
                     AND trim(COALESCE((SELECT plan FROM users WHERE id = ?), 'free')) <> ''))`;
  const deleteAfter = new Date(
    now.getTime() + PAID_VOICE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  return [
    {
      sql: `DELETE FROM paid_voice_retention WHERE user_id = ? AND ${paid}`,
      args: [userPk, userPk, userPk, userPk],
    },
    {
      // INSERT … SELECT 에 upsert 를 붙일 때는 SELECT 에 WHERE 가 있어야 파싱이 모호하지 않다.
      sql: `INSERT INTO paid_voice_retention (user_id, delete_after)
            SELECT ?, ? WHERE NOT ${paid}
            ON CONFLICT(user_id) DO UPDATE SET delete_after = excluded.delete_after`,
      args: [userPk, deleteAfter, userPk, userPk, userPk],
    },
  ];
}

/**
 * 즉시 해지·그룹 해체·개별 이탈의 보관 상태는 같은 규칙이다.
 * 같은 쓰기 트랜잭션에서 구독 취소·plan 재계산 뒤 호출한다. 유료 계정에게 남은
 * 유예 행은 곧 거짓 삭제 예고가 되므로 스윕까지 기다리지 않고 지운다.
 * 반환값은 응답의 삭제 기한이다 — 남은 유료 권한이 있으면 기한도 없다.
 */
export async function syncPaidVoiceRetention(
  db: DbExecutor,
  userPk: string,
  now: Date,
): Promise<string | null> {
  if (await hasActivePaidEntitlement(db, userPk)) {
    await clearPaidVoiceRetention(db, userPk);
    return null;
  }
  return schedulePaidVoiceRetention(db, userPk, now);
}

/**
 * 만료된(delete_after 경과) 유료 음성 보관 행을 거둔다.
 *
 * ⚠ **이 스윕은 하드삭제를 한다**(2026-08-31 정정 — 예전 주석은 "삭제하지 않고 잠글 뿐"
 * 이라고 적혀 있었으나 코드와 달랐다). 유예가 지나면 `deleteSensitiveVoiceDataForUser` 가
 * `voice_profiles`·`voice_uploads`·`generated_audio_assets`·`messages` 를 지우고 R2·
 * ElevenLabs 오브젝트를 삭제 큐에 넣는다.
 *
 * 무료 전환 **시점**에는 지우지 않는다 — 그때는 제공자 클론만 반납하고(`elevenlabs_voice_id`
 * 를 비우고 `evicted_*` 표식을 남긴다) 데이터는 유예 동안 살려 둔다. 그 사이 다시 유료가
 * 되면 원본으로 재클론해 그대로 돌아온다(`recloneEvictedVoiceProfile`).
 * 삭제 직전에 `hasActivePaidEntitlement` 로 한 번 더 확인하므로, 유예 중 재구독했으면
 * 보관 행만 지우고 데이터는 남는다.
 * (계정 삭제 같은 명시 경로는 여전히 deletePaidVoiceDataForUser 로 직접 삭제한다.)
 */
export async function sweepPaidVoiceRetention(
  db: Client,
  now: Date = new Date(),
): Promise<{
  targets: DowngradedAlarm[];
  cleanedUserPks: string[];
  voiceAccessRevokedUserIds: string[];
}> {
  // 이 정리로 강등된 알람들 — 호출자가 커밋 후 신호를 보낸다.
  const downgraded = new Map<string, DowngradedAlarm>();
  // 실제로 음성 데이터를 정리한 사용자들. 알람 행을 못 찾아도 이 계정에는 접근권 상실을
  // 알려야 한다(서버에 아직 동기화되지 않은 로컬 알람이 있을 수 있다).
  const cleanedUserPks: string[] = [];
  const voiceAccessRevokedUserIds = new Set<string>();
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
      const revocation = await deleteSensitiveVoiceDataForUser(
        db,
        userPk,
        await resolveUserLoginId(db, userPk),
      );
      for (const target of revocation.downgradedAlarms) downgraded.set(target.alarmId, target);
      for (const id of revocation.voiceAccessRevokedUserIds) voiceAccessRevokedUserIds.add(id);
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
  return {
    targets: Array.from(downgraded.values()),
    cleanedUserPks,
    voiceAccessRevokedUserIds: Array.from(voiceAccessRevokedUserIds),
  };
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
  for (const stmt of revokeVoiceAccessStatements(ownerIds)) await db.execute(stmt);
}

/**
 * 무료가 된 사람의 **목소리 접근 정리** 두 문장 — `downgradeUserToFree` 와 묶음 경로(그룹
 * 해체)가 같은 문장을 쓴다.
 *
 * 공유를 끄고, 그 목소리를 참조하던 '타인 소유' 알람을 sound-only 로 강등한다 — 취소된
 * 목소리가 좀비로 계속 울리지 않도록. (클라는 재동기화 시 반영)
 */
function revokeVoiceAccessStatements(ownerIds: string[]): InStatement[] {
  const ph = ownerIds.map(() => '?').join(',');
  return [
    {
      sql: `UPDATE voice_profiles SET is_shared = 0 WHERE user_id IN (${ph}) AND is_shared = 1`,
      args: ownerIds,
    },
    {
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
    },
  ];
}

/** 반드시 쓰기 트랜잭션 안에서 호출한다. 활성 근거 없는 등급의 복구도 강등 전체를 수행한다. */
export async function repairOrphanedPaidPlan(
  db: DbExecutor,
  userPk: string,
  now: Date = new Date(),
): Promise<string[]> {
  const repaired = await db.execute({
    sql: `UPDATE users SET plan = 'free', updated_at = datetime('now')
          WHERE id = ? AND plan <> 'free' AND NOT EXISTS (
            SELECT 1 FROM subscriptions WHERE user_id = ? AND status = 'active'
          ) RETURNING id`,
    args: [userPk, userPk],
  });
  if (repaired.rows.length === 0) return [];
  await downgradeUserToFree(db, userPk, { deleteVoiceData: false });
  await schedulePaidVoiceRetention(db, userPk, now);
  const affected = new Set([userPk]);
  // 활성 소유자 구독이 없으므로 남은 소유 그룹에도 지불 근거가 없다.
  const groups = await db.execute({
    sql: 'SELECT id FROM plan_groups WHERE owner_user_id = ?',
    args: [userPk],
  });
  for (const group of groups.rows) {
    for (const member of await disbandOwnedPlanGroup(db, userPk, String(group.id), now)) {
      affected.add(member);
    }
  }
  return [...affected];
}

function expireUnusedVouchersStatement(subscriptionId: string): InStatement {
  return {
    sql: `UPDATE voucher_codes SET status = 'expired'
          WHERE issuer_subscription_id = ? AND status = 'issued'`,
    args: [subscriptionId],
  };
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
  for (const stmt of cancelSubscriptionRowStatements(subscriptionId, now, keepVouchers)) {
    await db.execute(stmt);
  }
}

/** `cancelOneSubscriptionRow` 의 문장들 — 묶음 경로(그룹 해체)도 같은 문장을 쓴다. */
function cancelSubscriptionRowStatements(
  subscriptionId: string,
  now: Date,
  keepVouchers = false,
): InStatement[] {
  const stmts: InStatement[] = [
    {
      sql: `UPDATE subscriptions
            SET status = 'cancelled',
                canceled_at = ?,
                expires_at = ?,
                updated_at = datetime('now')
            WHERE id = ? AND status = 'active'`,
      args: [now.toISOString(), now.toISOString(), subscriptionId],
    },
  ];
  if (!keepVouchers) stmts.push(expireUnusedVouchersStatement(subscriptionId));
  return stmts;
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
  const paid = strongestPaidSubscription(remaining);
  if (paid) {
    await db.execute({
      sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [planTypeToUserPlan(paid.planType), userPk],
    });
    return;
  }
  if (remaining.some((s) => PAID_PLAN_TYPES.has(s.planType))) {
    // 보류·미확인 구독은 회복 가능하다. 다른 구독의 종료가 공유 구조까지 영구 정리하지 않는다.
    await resolvePlanAfterSuspend(db, userPk, []);
  } else {
    await downgradeUserToFree(db, userPk, options);
  }
}

export function strongestPaidSubscription<
  T extends Pick<ActiveSubscription, 'planType' | 'entitlementState'>,
>(subscriptions: T[]): T | undefined {
  // 시작일은 같은 등급 안에서만 의미가 있다. 새 개인 구독이 공유 권한을 덮으면 안 된다.
  const entitled = subscriptions.filter((s) => s.entitlementState === 'entitled');
  return (
    entitled.find((s) => isGroupPlanType(s.planType)) ??
    entitled.find((s) => PAID_PLAN_TYPES.has(s.planType))
  );
}

/**
 * suspend(ON_HOLD/PAUSED) 전용 plan 재정렬 (E). 매핑(정지된) 구독을 제외한 다른 활성 유료
 * 구독이 남아 있으면 그 plan 을 유지하고, 없을 때만 free 로 내린다 — deactivate 경로
 * (syncUserPlanAfterCancel)의 E2(잔여 유료 구독 유지)와 대칭.
 *
 * deactivate 와 달리 ON_HOLD/PAUSED 는 결제 복구로 되살아날 수 있는 회복형 상태라,
 * is_shared 해제·타인 알람 강등 같은 음성 접근 정리는 하지 않는다(그룹·공유 구조 보존).
 * 소유자 users.plan 만 보수적으로 회수하며, 결제가 복구되면 entitle 가 users.plan 을 원복한다.
 * 매핑 구독은 active로 보존하고 entitlement_state에 보류를 기록한다. 이후 다른 구독의
 * 해지·환불에서도 이 제외가 유지되며, 스토어가 복구를 확인한 경로만 표식을 해제한다.
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
  if (excluded.size) {
    const placeholders = [...excluded].map(() => '?').join(', ');
    await db.execute({
      sql: `UPDATE subscriptions SET entitlement_state = 'suspended', updated_at = datetime('now')
            WHERE user_id = ? AND status = 'active' AND id IN (${placeholders})`,
      args: [userPk, ...excluded],
    });
  }
  const remaining = await findActiveSubscriptionsByUserPk(db, userPk);
  const paid = strongestPaidSubscription(remaining);
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
 * @param suspend `true` 면 그룹 구독의 보류를 저장하고 재계산(→ 대개 free),
 *                `false` 면 확인된 이 그룹의 보류만 해제하고 재계산한다.
 * @returns 실제로 plan 이 바뀐 멤버들의 userPk (알림 대상).
 */
export async function propagateGroupMemberPlans(
  db: DbExecutor,
  planGroupId: string,
  ownerUserPk: string,
  suspend: boolean,
): Promise<string[]> {
  // ⚠ **멤버 수와 무관하게 왕복 두 번이다**(2026-09-20). 예전에는 멤버마다 등급 조회 ×2 ·
  //   구독 조회 · 보류 표식 · 재계산을 따로 왕복했다(멤버 넷이면 20번 넘게). 이 함수는
  //   **가족 소유자의 갱신 확정마다** 돈다(`extendStoreGroupPeriod`) — 그 요청이 워커
  //   subrequest 한도(~50)에 걸리면 롤백되고 재시도해도 같은 자리에서 죽는다.
  //   결과는 예전과 같다: 쓰기 문장과 순서는 멤버별 경로(`resolvePlanAfterSuspend`)를
  //   그대로 옮긴 것이고, 등급은 **같은 규칙**(`strongestPaidSubscription`)으로 이 쓰기가
  //   만들 상태에서 계산한다. 미리 읽는 것은 멤버 자신의 행뿐이라 앞 멤버의 쓰기에 영향받지
  //   않는다. 결과 고정 테스트: `test/group-disband-batch.test.ts`.
  const members = `SELECT user_id FROM plan_group_members WHERE plan_group_id = ? AND user_id != ?`;
  const [memberRes, userRes, subRes] = await db.batch([
    { sql: members, args: [planGroupId, ownerUserPk] },
    { sql: `SELECT id, plan FROM users WHERE id IN (${members})`, args: [planGroupId, ownerUserPk] },
    {
      sql: `SELECT s.id, s.user_id, s.plan_group_id, s.entitlement_state, p.plan_type
            FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
            WHERE s.status = 'active' AND s.user_id IN (${members})
            ORDER BY s.starts_at DESC`,
      args: [planGroupId, ownerUserPk],
    },
  ]);

  const planOf = new Map(userRes!.rows.map((r) => [String(r.id), String(r.plan ?? 'free')]));
  const writes: InStatement[] = [];
  const affected: string[] = [];
  for (const row of memberRes!.rows) {
    const memberPk = String(row.user_id);
    const planBefore = planOf.get(memberPk) ?? 'free';
    const memberSubs = subRes!.rows.filter((r) => String(r.user_id) === memberPk);
    const inGroup = (sub: (typeof memberSubs)[number]) =>
      ((sub.plan_group_id as string | null) ?? null) === planGroupId;

    // 보류: 이 그룹에 묶인 멤버 구독을 **제외**하고 재계산한다. 멤버가 자기 개인 구독을
    // 따로 샀다면 그건 그대로 남는다. 한 멤버가 같은 그룹에 활성 구독을 둘 이상 갖는 일은
    // 없지만, 있어도 **전부** 제외해야 한다 — 하나만 빼면 나머지가 유료로 남는다.
    // 복구: 이 그룹만 entitled로 되돌린다. 다른 구독에 남은 보류·미확인은 계속 제외한다.
    if (suspend) {
      const groupSubIds = memberSubs.filter(inGroup).map((sub) => String(sub.id));
      if (groupSubIds.length) {
        writes.push({
          sql: `UPDATE subscriptions SET entitlement_state = 'suspended', updated_at = datetime('now')
                WHERE user_id = ? AND status = 'active' AND id IN (${groupSubIds.map(() => '?').join(', ')})`,
          args: [memberPk, ...groupSubIds],
        });
      }
    } else {
      writes.push({
        sql: `UPDATE subscriptions SET entitlement_state = 'entitled', updated_at = datetime('now')
              WHERE user_id = ? AND plan_group_id = ? AND status = 'active'`,
        args: [memberPk, planGroupId],
      });
    }
    // 위 쓰기가 만들 상태에서 등급을 고른다(`resolvePlanAfterSuspend` 의 재계산).
    const remaining = memberSubs
      .filter((sub) => sub.plan_type !== null && sub.plan_type !== undefined)
      .map((sub) => ({
        planType: String(sub.plan_type),
        entitlementState: inGroup(sub)
          ? suspend
            ? 'suspended'
            : 'entitled'
          : String(sub.entitlement_state ?? 'entitled'),
      }));
    const paid = strongestPaidSubscription(remaining);
    const planNext = paid ? planTypeToUserPlan(paid.planType) : 'free';
    writes.push(setUserPlanStatement(memberPk, planNext));
    // 행이 없는 사용자는 갱신이 아무 일도 하지 않는다 — 예전처럼 'free' 로 읽는다.
    const planAfter = planOf.has(memberPk) ? planNext : 'free';
    // ⚠ **바뀐 사람만 알린다.** 안 바뀐 멤버(자기 결제가 따로 있는 사람)에게
    // "결제가 실패했어요" 를 보내면 자기 카드에 문제가 생긴 줄 안다.
    if (planBefore !== planAfter) affected.push(memberPk);
  }
  if (writes.length) await db.batch(writes);
  return affected;
}

/**
 * 소유 그룹 해체: 소유자를 제외한 멤버들의 그룹 연동 구독을 취소하고 plan 을 재정렬한 뒤
 * 멤버 행을 전부 지운다. cancelSubscriptionImmediate 의 소유자 경로와, 그룹 연결이 빠진
 * 구독(스크립트 부여/레거시)을 위한 방어 스윕이 공유한다.
 * 반환: 그룹에서 나간(소유자 제외) 멤버 user_id 목록 — 독립 유료 이용권이 남아도
 * 그룹 접근 변경은 plan_changed로 동기화한다. 삭제 예고는 실제 무료가 된 멤버만 받는다.
 */
async function disbandOwnedPlanGroup(
  db: DbExecutor,
  ownerUserPk: string,
  planGroupId: string,
  now: Date,
): Promise<string[]> {
  // ⚠ **멤버 수와 무관하게 왕복 두 번이다 — 읽기 한 번, 쓰기 한 번**(2026-09-20).
  //   예전에는 멤버마다 조회·취소·강등·클론 반납·보관 기한을 따로 왕복해, 멤버 넷인 가족
  //   그룹 하나를 해체하는 데 40번 넘게 오갔다. 워커 한 실행의 subrequest 는 ~50 이라
  //   해체를 품은 요청(가족 → 개인 전환, 체인 넘겨받기, 만료)이 한도에 걸려 **롤백되고,
  //   재시도해도 같은 자리에서 죽었다.**
  //   결과는 예전과 같다: 쓰기 문장과 그 순서는 멤버별 경로(`cancelOneSubscriptionRow` →
  //   `syncUserPlanAfterCancel` → `syncPaidVoiceRetention`)를 그대로 옮긴 것이고, 미리 읽은
  //   값은 **이 해체가 건드리지 않는 것**(멤버의 다른 구독·로그인 id·클론 id)뿐이다. 앞 문장에
  //   기대는 판정(보관 기한)은 SQL 로 실행 시점에 한다(`retentionSyncStatements`).
  //   결과 고정 테스트: `test/group-disband-batch.test.ts`(도입 때 예전 구현과 무작위 상태
  //   1,200회를 대조해 불일치 0 을 확인했다).
  const members = `SELECT user_id FROM plan_group_members WHERE plan_group_id = ? AND user_id <> ?`;
  const [memberRes, subRes, userRes, voiceRes] = await db.batch([
    { sql: members, args: [planGroupId, ownerUserPk] },
    {
      // LEFT JOIN — 취소 대상은 플랜 행과 무관하게 전부다(예전 멤버별 조회에 JOIN 이 없었다).
      // 등급 계산은 `findActiveSubscriptionsByUserPk` 처럼 플랜이 있는 행만 본다.
      sql: `SELECT s.id AS sub_id, s.user_id, s.plan_group_id, s.entitlement_state, p.plan_type
            FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
            WHERE s.status = 'active' AND s.user_id IN (${members})
            ORDER BY s.starts_at DESC`,
      args: [planGroupId, ownerUserPk],
    },
    {
      sql: `SELECT id, google_id FROM users WHERE id IN (${members})`,
      args: [planGroupId, ownerUserPk],
    },
    {
      // 클론의 주인 id 는 PK 이거나 로그인 id(google_id)다 — 둘 다 모은다.
      sql: `SELECT user_id, elevenlabs_voice_id FROM voice_profiles
            WHERE elevenlabs_voice_id IS NOT NULL
              AND user_id IN (
                SELECT user_id FROM plan_group_members WHERE plan_group_id = ? AND user_id <> ?
                UNION
                SELECT u.google_id FROM users u
                JOIN plan_group_members m ON m.user_id = u.id
                WHERE m.plan_group_id = ? AND m.user_id <> ? AND u.google_id IS NOT NULL
              )`,
      args: [planGroupId, ownerUserPk, planGroupId, ownerUserPk],
    },
  ]);

  const loginIdOf = new Map(
    userRes!.rows.map((r) => [String(r.id), (r.google_id as string | null) ?? null]),
  );
  const writes: InStatement[] = [];
  const disbanded: string[] = [];
  for (const row of memberRes!.rows) {
    const memberUserId = String(row.user_id);
    if (memberUserId === ownerUserPk) continue;
    writes.push(
      ...memberDetachWrites(
        memberUserId,
        {
          subs: subRes!.rows.filter((r) => String(r.user_id) === memberUserId),
          loginId: loginIdOf.get(memberUserId) ?? null,
          voices: voiceRes!.rows,
        },
        planGroupId,
        now,
      ),
    );
    disbanded.push(memberUserId);
  }
  writes.push({
    sql: `DELETE FROM plan_group_members WHERE plan_group_id = ?`,
    args: [planGroupId],
  });
  await db.batch(writes);
  return disbanded;
}

/**
 * 멤버 한 명을 그룹에서 떼어 낼 때의 **쓰기 문장** — 해체(`disbandOwnedPlanGroup`)와
 * 이탈(`leavePlanGroupMembers`)이 같이 쓴다. 읽기는 호출부가 미리 모아 넘긴다
 * (멤버의 활성 구독·로그인 id·클론 id — 이 쓰기가 바꾸지 않는 값들이다).
 *
 * 순서와 문장은 멤버별 경로 그대로다:
 * 1) 이 그룹에 묶인 멤버 구독 취소(`cancelOneSubscriptionRow`)
 * 2) 남은 구독으로 등급 재계산(`syncUserPlanAfterCancel`) — 무료면 클론 반납·공유 해제·타인
 *    알람 강등(`downgradeUserToFree` 의 음성 보존 갈래). 멤버에게는 소유자의 삭제 옵션을
 *    전파하지 않는다 — 취소를 개시하지 않은 멤버의 데이터는 보존한다.
 * 3) 보관 기한(`syncPaidVoiceRetention`) — 앞 문장이 반영된 상태를 SQL 로 본다.
 */
function memberDetachWrites(
  memberUserId: string,
  snapshot: {
    /** 멤버의 **활성** 구독(`sub_id`·`plan_group_id`·`entitlement_state`·`plan_type`). */
    subs: Array<Record<string, unknown>>;
    loginId: string | null;
    /** 클론 행(`user_id`·`elevenlabs_voice_id`) — 다른 사람 것이 섞여 있어도 된다. */
    voices: Array<Record<string, unknown>>;
  },
  planGroupId: string,
  now: Date,
): InStatement[] {
  const writes: InStatement[] = [];
  const inGroup = (sub: Record<string, unknown>) =>
    ((sub.plan_group_id as string | null) ?? null) === planGroupId;
  for (const sub of snapshot.subs) {
    if (inGroup(sub)) writes.push(...cancelSubscriptionRowStatements(String(sub.sub_id), now));
  }
  // `findActiveSubscriptionsByUserPk` 처럼 플랜 행이 있는 것만 등급 계산에 넣는다.
  const remaining = snapshot.subs
    .filter((sub) => !inGroup(sub))
    .filter((sub) => sub.plan_type !== null && sub.plan_type !== undefined)
    .map((sub) => ({
      planType: String(sub.plan_type),
      entitlementState: String(sub.entitlement_state ?? 'entitled'),
    }));
  const paid = strongestPaidSubscription(remaining);
  if (paid) {
    writes.push(setUserPlanStatement(memberUserId, planTypeToUserPlan(paid.planType)));
  } else if (remaining.some((sub) => PAID_PLAN_TYPES.has(sub.planType))) {
    // 보류·미확인 구독은 회복 가능하다(`resolvePlanAfterSuspend(…, [])` 와 같은 결과 — 남은
    // 것 중 권한 있는 유료가 없으니 free 다). 공유 구조는 정리하지 않는다.
    writes.push(setUserPlanStatement(memberUserId, 'free'));
  } else {
    const ownerIds = Array.from(
      new Set([memberUserId, snapshot.loginId].filter((x): x is string => Boolean(x))),
    );
    const providerVoiceIds = snapshot.voices
      .filter((r) => ownerIds.includes(String(r.user_id)))
      .map((r) => r.elevenlabs_voice_id as string);
    writes.push(setUserPlanStatement(memberUserId, 'free'));
    writes.push(...clonedVoiceReleaseStatements(ownerIds, providerVoiceIds));
    writes.push(...revokeVoiceAccessStatements(ownerIds));
  }
  writes.push(...retentionSyncStatements(memberUserId, now));
  return writes;
}

/** `downgradeUserToFree`·`syncUserPlanAfterCancel` 가 쓰는 것과 같은 등급 갱신 문장. */
function setUserPlanStatement(userPk: string, plan: string): InStatement {
  return {
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [plan, userPk],
  };
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
    const ownerUserId = groupRes.rows.length > 0 ? String(groupRes.rows[0]!.owner_user_id) : null;

    if (ownerUserId !== subscription.userPk) {
      await db.execute({
        sql: `DELETE FROM plan_group_members WHERE plan_group_id = ? AND user_id = ?`,
        args: [subscription.planGroupId, subscription.userPk],
      });
      await releaseInviteUseForMember(db, subscription.userPk, subscription.planGroupId);
      return Array.from(affected);
    }

    for (const m of await disbandOwnedPlanGroup(
      db,
      subscription.userPk,
      subscription.planGroupId,
      now,
    )) {
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
): Promise<string[]> {
  const subscriptions = await findActiveSubscriptionsByUserPk(db, userPk);
  const affected = new Set<string>();
  for (const subscription of subscriptions) {
    for (const id of await cancelSubscriptionImmediate(db, subscription, now, options))
      affected.add(id);
  }
  // 호출부가 커밋 후 알릴 수 있도록 그룹 해체로 영향받은 사람도 버리지 않는다.
  return [...affected];
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
  await leavePlanGroupMembers(db, {
    planGroupId: params.planGroupId,
    members: [{ userPk: params.userPk, membershipId: params.membershipId }],
    now: params.now ?? new Date(),
  });
}

/**
 * 멤버 여럿을 그룹에서 내보낸다 — **멤버 수와 무관하게 읽기 한 번 + 쓰기 한 번**.
 *
 * 정원 축소(가족 → 커플)가 멤버 셋을 한 요청에서 내보내는데, 예전에는 사람마다 이탈 정리를
 * 따로 왕복해(멤버당 ~17) 워커 subrequest 한도(~50)를 넘겼다 — 결제 확정이 롤백되고
 * 재시도해도 같은 자리에서 죽었다(2026-09-20 실측 106).
 *
 * 멤버마다 순서는 예전 이탈 그대로다: 멤버십 삭제 → 그룹 구독 취소·등급 재계산·보관 기한
 * (`memberDetachWrites`) → 초대 사용분 반환(`releaseInviteUseForMember`). 그룹 구독 유무와
 * 무관하게 남은 활성 구독 기준으로 plan 을 재정렬한다(다른 유료 구독이 남아 있으면 유지,
 * 없으면 free 강등 + 음성 접근 정리).
 */
export async function leavePlanGroupMembers(
  db: DbExecutor,
  params: {
    planGroupId: string;
    members: Array<{ userPk: string; membershipId: string }>;
    now: Date;
  },
): Promise<void> {
  const { planGroupId, members, now } = params;
  if (members.length === 0) return;
  const userPks = Array.from(new Set(members.map((m) => m.userPk)));
  const ph = userPks.map(() => '?').join(', ');
  const [subRes, userRes, voiceRes, redemptionRes] = await db.batch([
    {
      // LEFT JOIN — 취소 대상은 플랜 행과 무관하게 전부다(예전 조회에 JOIN 이 없었다).
      sql: `SELECT s.id AS sub_id, s.user_id, s.plan_group_id, s.entitlement_state, p.plan_type
            FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
            WHERE s.status = 'active' AND s.user_id IN (${ph})
            ORDER BY s.starts_at DESC`,
      args: userPks,
    },
    { sql: `SELECT id, google_id FROM users WHERE id IN (${ph})`, args: userPks },
    {
      // 클론의 주인 id 는 PK 이거나 로그인 id(google_id)다 — 둘 다 모은다.
      // 사용자 행이 없어도 PK 로 적힌 클론은 모은다(예전 `releaseClonedVoicesForUser` 와 같다).
      sql: `SELECT user_id, elevenlabs_voice_id FROM voice_profiles
            WHERE elevenlabs_voice_id IS NOT NULL
              AND (user_id IN (${ph})
                   OR user_id IN (SELECT google_id FROM users WHERE id IN (${ph}) AND google_id IS NOT NULL))`,
      args: [...userPks, ...userPks],
    },
    {
      sql: `SELECT vr.id AS redemption_id, vr.voucher_id, vr.user_id
            FROM voucher_redemptions vr
            JOIN voucher_codes v ON v.id = vr.voucher_id
            JOIN subscriptions s ON s.id = v.issuer_subscription_id
            WHERE vr.user_id IN (${ph}) AND s.plan_group_id = ?`,
      args: [...userPks, planGroupId],
    },
  ]);
  const loginIdOf = new Map(
    userRes!.rows.map((r) => [String(r.id), (r.google_id as string | null) ?? null]),
  );
  const writes: InStatement[] = [];
  for (const member of members) {
    writes.push({ sql: `DELETE FROM plan_group_members WHERE id = ?`, args: [member.membershipId] });
    writes.push(
      ...memberDetachWrites(
        member.userPk,
        {
          subs: subRes!.rows.filter((r) => String(r.user_id) === member.userPk),
          loginId: loginIdOf.get(member.userPk) ?? null,
          voices: voiceRes!.rows,
        },
        planGroupId,
        now,
      ),
    );
    // 초대 사용분 반환(`releaseInviteUseForMember`) — 코드의 남은 사용 수는 실행 시점에 센다.
    for (const r of redemptionRes!.rows.filter((row) => String(row.user_id) === member.userPk)) {
      writes.push(
        { sql: `DELETE FROM voucher_redemptions WHERE id = ?`, args: [String(r.redemption_id)] },
        {
          sql: `UPDATE voucher_codes
                SET status = 'issued',
                    used_at = NULL
                WHERE id = ?
                  AND status = 'used'
                  AND (SELECT COUNT(*) FROM voucher_redemptions WHERE voucher_id = ?) < COALESCE(max_uses, 1)`,
          args: [String(r.voucher_id), String(r.voucher_id)],
        },
      );
    }
  }
  await db.batch(writes);
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

/** 크론과 결제 전 조회는 같은 스토어 판정·쓰기 경로를 사용한다. */
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
): Promise<'expire' | 'skip'> {
  // 그룹 멤버의 수명은 소유자가 정한다. 보류·조회 실패 중에도 멤버십은 남겨 둔다.
  const owner = await db.execute({
    sql: `SELECT 1 FROM subscriptions member
          JOIN plan_groups g ON g.id = member.plan_group_id
          JOIN subscriptions owner ON owner.plan_group_id = g.id AND owner.user_id = g.owner_user_id
          WHERE member.id = ? AND member.user_id <> g.owner_user_id AND owner.status = 'active'`,
    args: [params.subscriptionId],
  });
  if (owner.rows.length) return 'skip';
  try {
    const result = await reconcileStoreSubscription(
      db,
      env ?? {},
      params.subscriptionId,
      params.now,
    );
    return result === 'applied' ? 'skip' : 'expire';
  } catch (error) {
    // DB 오류는 만료 근거가 아니다. 권위 조회 실패만 72시간 유예 후 기존 만료 정책을 따른다.
    if (!(error instanceof BillingStateUnavailableError)) throw error;
    if (!error.allowForcedExpiry) return 'skip';
    const expiredMs = new Date(params.expiresAt).getTime();
    const forceExpire =
      Number.isFinite(expiredMs) && expiredMs <= params.now.getTime() - 72 * 60 * 60 * 1000;
    logStructured('warn', {
      at: 'billing.expiry.reconcile',
      subscriptionId: params.subscriptionId,
      error: String(error),
      forceExpire,
    });
    return forceExpire ? 'expire' : 'skip';
  }
}

/**
 * 강등/플랜변경으로 영향받은 사용자들에게 plan_changed 푸시(즉시성 목적). FIREBASE 설정이
 * 없거나(dev/테스트) 대상이 없으면 no-op. 실패해도 호출부 흐름을 깨지 않게 격리(로깅만).
 * **반드시 DB 트랜잭션 커밋 '후'에** 호출한다 — FCM 은 네트워크 I/O 라 tx 안에서 쏘면 안 된다.
 * (정확성은 클라 로컬 폴백[앱 시작 재조회 + 울림 시점 게이트]이 보장 — 푸시는 즉시성만.)
 */
/**
 * **목소리 삭제 예고를 보낸다.** 보관 유예가 걸린 사용자에게만 간다.
 *
 * ⚠ **트랜잭션 밖에서 부른다** — FCM 은 tx 안에서 쏘지 않는다(`notifyPlanChanged` 와 같은 규칙).
 * 그래서 예약(`schedulePaidVoiceRetention`)과 같은 자리에 둘 수 없고, 커밋 뒤에 부른다.
 *
 * 유예 행이 없는 사용자는 조용히 건너뛴다 — 강등이라고 다 삭제 예고가 붙는 게 아니다
 * (결제 보류는 유예를 걸지 않으므로 여기서 자연히 빠진다).
 */
export async function notifyVoiceDeletionScheduled(
  db: Client,
  env: ExpiryEnv | undefined,
  userIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return;
  const hasFirebase = Boolean(env?.FIREBASE_PROJECT_ID && env?.FIREBASE_SERVICE_ACCOUNT_JSON);
  const hasApns = Boolean(env?.APNS_KEY_ID && env?.APNS_PRIVATE_KEY && env?.APPLE_TEAM_ID);
  if (!hasFirebase && !hasApns) return;

  // ⚠ **조회까지 try 안에 둔다**(2026-09-20). 이 함수는 커밋 **뒤**에 돈다 — 여기서 던지면
  //   이미 저장된 결제·해지가 500 으로 보이고, 앱은 실패로 읽어 다시 시도한다. 그 재시도는
  //   바뀐 것이 없어 알림을 다시 보내지도 않는다. 알림은 즉시성일 뿐 정확성은 재조회가 맡는다.
  try {
    const ph = unique.map(() => '?').join(', ');
    const res = await db.execute({
      sql: `SELECT user_id FROM paid_voice_retention WHERE user_id IN (${ph})`,
      args: unique,
    });
    const scheduled = res.rows.map((r) => String(r.user_id));
    if (scheduled.length === 0) return;
    await sendVoiceDeletionWarningPush(db, env as ExpiryEnv, {
      userPks: scheduled,
      retentionDays: PAID_VOICE_RETENTION_DAYS,
    });
  } catch (err) {
    // ⚠ 알림 실패로 강등·예약을 되돌리지 않는다 — 데이터는 이미 정리됐다.
    logStructured('error', {
      at: 'billing.notify_voice_deletion',
      action: 'PUSH_FAILED',
      error: String(err),
    });
  }
}

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

/** 권한 변경과 그 변경으로 생긴 삭제 유예는 커밋 후 함께 통지한다. */
export async function notifyBillingStateChanged(
  db: Client,
  env: ExpiryEnv | undefined,
  userIds: string[],
): Promise<void> {
  await notifyPlanChanged(db, env, userIds);
  await notifyVoiceDeletionScheduled(db, env, userIds);
}

/**
 * 한 번의 워커 실행에서 처리할 만료 구독 수.
 *
 * ⚠ **상한이 없으면 subrequest 한도에 걸려 틱 전체가 죽는다**(2026-09-18). 만료 한 건마다
 * 스토어 재조회(외부 fetch)와 여러 DB 왕복이 붙는데, 한 실행의 subrequest 는 ~50 개다.
 * 밀린 건은 다음 틱(5분)이 이어서 처리한다 — 순서는 그룹 소유자 우선으로 고정돼 있어
 * 나눠 처리해도 결과가 같다.
 */
const EXPIRY_BATCH_LIMIT = 5;

export async function processSubscriptionExpiry(
  db: Client,
  env?: ExpiryEnv,
  now: Date = new Date(),
): Promise<void> {
  const notifyUserPks = new Set<string>();
  const due = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.expires_at, p.plan_type
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.status = 'active' AND julianday(s.expires_at) <= julianday(?)
          ORDER BY CASE WHEN EXISTS (
            SELECT 1 FROM plan_groups g WHERE g.id = s.plan_group_id AND g.owner_user_id = s.user_id
          ) THEN 0 ELSE 1 END, s.id
          LIMIT ?`,
    args: [now.toISOString(), EXPIRY_BATCH_LIMIT],
  });
  for (const row of due.rows) {
    const subscriptionId = String(row.sub_id);
    const decision = await reconcileStoreBeforeExpiry(db, env, {
      subscriptionId,
      userPk: String(row.user_id),
      planType: String(row.plan_type),
      expiresAt: String(row.expires_at),
      now,
    });
    if (decision === 'skip') continue;
    // 외부 조회 동안 갱신·전환된 행은 쓰기 트랜잭션에서 다시 검사한다.
    const affected = await expireSubscriptionIfDue(db, subscriptionId, String(row.expires_at), now);
    for (const id of affected) notifyUserPks.add(id);
  }

  // 보관 유예가 끝난 유료 음성 데이터 정리 (같은 cron 주기에서 처리).
  const sweptVoiceData = await sweepPaidVoiceRetention(db, now);

  // 강등된 사용자에게 plan_changed 푸시 — 클라가 '강등 시점'에 유료 목소리 알람을 기본 알람으로
  // 변환하게 한다(백그라운드 여도). 과다발송해도 클라가 재조회로 확인.
  // ⚠ 푸시는 **DB 쓰기가 끝난 뒤에** 쏜다(RTDN 갈래와 같은 규칙) — 네트워크 I/O 이고,
  // 실패해도 흐름을 깨지 않는다. 정확성은 클라의 재조회가 보장하고 푸시는 즉시성만 맡는다.
  await notifyPlanChanged(db, env, Array.from(notifyUserPks));
  // 유예가 걸린 사람에게만 **눈에 보이는** 삭제 예고를 보낸다(위 신호는 전부 무음이다).
  await notifyVoiceDeletionScheduled(db, env, Array.from(notifyUserPks));

  // 보관 정리가 서버에서 바꾼 '알람 행'은 plan_changed 로는 안 따라온다 — 이유는
  // notifyDowngradedAlarms 참고. 강등된 알람마다 알람 동기화 신호를 보낸다.
  await notifyDowngradedAlarms(
    db,
    env,
    sweptVoiceData.targets,
    sweptVoiceData.voiceAccessRevokedUserIds,
  );
}
