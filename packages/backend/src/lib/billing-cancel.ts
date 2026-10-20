import type { Client, InStatement } from '@libsql/client';
import { withWriteTransaction, type DbExecutor } from './transactions';
import {
  clonedVoiceReleaseStatements,
  deletePaidVoiceDataForUser,
  deleteSensitiveVoiceDataForUser,
  type DowngradedAlarm,
} from './paid-voice-cleanup';
import { logStructured } from './logger';
import type { PlayEnv } from './play-subscriptions';
import {
  BillingStateUnavailableError,
  expireSubscriptionIfDue,
  reconcileStoreSubscription,
} from './billing-reconciliation';
import { PAID_PLAN_TYPES, planTypeToUserPlan } from '../routes/billing-helpers';
import { notifyDowngradedAlarms, sendBillingStateSignals, sendPlanChangedPush } from './fcm';
import { sendVoiceDeletionWarningPush } from './fcm';
import { resolvePersonalPromo } from './personal-promo';
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
      // 기간 한정 개인 플랜 — 보관 판정(`promoCoversFree`).
      | 'PERSONAL_PROMO_STARTS_AT'
      | 'PERSONAL_PROMO_ENDS_AT'
    >
  >;

export interface ActiveSubscription {
  subscriptionId: string;
  userPk: string;
  planId: string;
  /** **행동 분류**(`plans.plan_type`) — 유료인가를 가른다(`PAID_PLAN_TYPES`). */
  planType: string;
  /** **상품**(`plans.key`) — 지금은 `personal` 하나다. */
  planKey: string;
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
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id,
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
 * `null` 은 스토어 결제가 아니라는 뜻이다(dev 스텁·프로모) — 서버 로컬 해지가 된다.
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

/** 구독 취소·무료 강등이 받는 것 — 음성 데이터를 지우는가 하나다. */
type DowngradeOptions = {
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

/** 보관 기한 스윕이 한 틱에 정리하는 사람 수 — 워커 subrequest 한도(~50) 안에 들게. */
const SWEEP_BATCH_LIMIT = 2;

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
  await db.execute(paidVoiceRetentionUpsertStatement(userPk, deleteAfter));
  return deleteAfter;
}

/**
 * 보관 기한을 **정해진 시각으로** 거는(upsert) 문장 — `schedulePaidVoiceRetention` 과 기간 한정
 * 개인 플랜 종료 전환(`lib/personal-promo-end.ts`, 기한을 끝 + 3일로 미리 정한다)이
 * 같은 문장을 쓴다.
 */
export function paidVoiceRetentionUpsertStatement(
  userPk: string,
  deleteAfterIso: string,
): InStatement {
  return {
    sql: `INSERT INTO paid_voice_retention (user_id, delete_after)
          VALUES (?, ?)
          ON CONFLICT(user_id) DO UPDATE SET delete_after = excluded.delete_after`,
    args: [userPk, deleteAfterIso],
  };
}

/**
 * 지금 유료 권한이 살아 있는가 — 보관 만료 삭제 직전의 마지막 안전장치.
 * 활성 구독(만료 전) 또는 users.plan 이 무료가 아니면 유료로 본다. 둘 중 하나만 봐도
 * 대부분 맞지만, 어느 한쪽만 갱신하고 다른 쪽을 놓친 경로가 있어 둘 다 확인한다.
 *
 * **기간 한정 개인 플랜도 유료로 친다**(`promoCoversFree`) — 원시 plan 이 정확히 `'free'` 인
 * 계정만 덮는다(행 없음·`null` 은 덮지 않는다). 기간 중에는 새 보관이 걸리지 않고, 시작 전부터
 * 걸려 있던 보관은 스윕이 지우지 않고 풀어 준다. 종료 뒤에는 `transitionPersonalPromoEnd`(`lib/personal-promo-end.ts`)가
 * 다시 건다.
 */
export async function hasActivePaidEntitlement(
  db: DbExecutor,
  userPk: string,
  promoCoversFree: boolean,
): Promise<boolean> {
  const res = await db.execute(paidEntitlementStatement(userPk));
  return isPaidEntitlementRow(res.rows[0], promoCoversFree);
}

/**
 * [hasActivePaidEntitlement] 의 **조회 문장** — 여러 사람을 한 묶음(`batch`)으로 물을 때
 * (보관 스윕 묶음, `lib/personal-promo-end.ts`) 같은 문장을 쓴다. 판정은 [isPaidEntitlementRow].
 */
export function paidEntitlementStatement(userPk: string): InStatement {
  return {
    sql: `SELECT
            (SELECT COUNT(*) FROM subscriptions
              WHERE user_id = ? AND status = 'active'
                AND datetime(expires_at) > datetime('now')) AS active_subs,
            (SELECT plan FROM users WHERE id = ?) AS plan`,
    args: [userPk, userPk],
  };
}

/** [paidEntitlementStatement] 결과 행 하나로 유료 여부를 판정한다(행이 없으면 무료). */
export function isPaidEntitlementRow(
  row: Record<string, unknown> | undefined,
  promoCoversFree: boolean,
): boolean {
  if (!row) return false;
  const activeSubs = Number(row.active_subs ?? 0);
  const rawPlan = row.plan as string | null;
  if (promoCoversFree === true && rawPlan === 'free') return true;
  const plan = rawPlan ?? 'free';
  return activeSubs > 0 || (plan !== 'free' && plan.trim() !== '');
}

export async function clearPaidVoiceRetention(db: DbExecutor, userPk: string): Promise<void> {
  await db.execute({
    sql: `DELETE FROM paid_voice_retention WHERE user_id = ?`,
    args: [userPk],
  });
}

/**
 * 즉시 해지·소유권 이전·등급 복구의 보관 상태는 같은 규칙이다.
 * 같은 쓰기 트랜잭션에서 구독 취소·plan 재계산 뒤 호출한다. 유료 계정에게 남은
 * 유예 행은 곧 거짓 삭제 예고가 되므로 스윕까지 기다리지 않고 지운다.
 * 반환값은 응답의 삭제 기한이다 — 남은 유료 권한이 있으면 기한도 없다.
 */
export async function syncPaidVoiceRetention(
  db: DbExecutor,
  userPk: string,
  now: Date,
  /** 기간 한정 개인 플랜이 지금 원시 free 를 덮는가 — `hasActivePaidEntitlement` 에 그대로 넘긴다. */
  promoCoversFree: boolean,
): Promise<string | null> {
  if (await hasActivePaidEntitlement(db, userPk, promoCoversFree)) {
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
  now: Date,
  /**
   * 기간 한정 개인 플랜이 지금 원시 free 를 덮는가. 덮으면 원시 free 사용자의 보관 행은
   * **지우지 않고 풀어 준다**(삭제 직전 재확인이 유료로 본다) — 종료 뒤 전환이 다시 건다.
   */
  promoCoversFree: boolean,
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
  // 클론 자체는 해지 시점에 이미 반납했다(`downgradeUserToFree` → `clonedVoiceReleaseStatements`).
  // ⚠ **한 틱에 몇 명만, 기한이 먼저 온 순서로**(2026-09-20). 워커 한 실행의 subrequest 는
  //   ~50 이고 한 사람을 지우는 데 스무 번 남짓 왕복한다 — 제한 없이 다 돌면 뒤 사람들과
  //   이 크론의 나머지(알림)가 한도에 걸린다. 남은 사람은 다음 틱(5분)이 잇는다.
  const due = await db.execute({
    sql: `SELECT user_id FROM paid_voice_retention WHERE delete_after <= ?
          ORDER BY delete_after, user_id LIMIT ?`,
    args: [now.toISOString(), SWEEP_BATCH_LIMIT],
  });
  for (const row of due.rows) {
    const userPk = String(row.user_id);
    // 한 사용자에서 실패해도 나머지를 버리지 않는다. 예외가 위로 새면 호출부가
    // notifyDowngradedAlarms 까지 못 가서, 이미 정리·마커 삭제까지 끝난 앞 사용자들의
    // 알림이 통째로 사라진다 — 마커가 없으니 다음 크론이 복구할 수도 없다.
    // 실패한 사용자는 마커를 그대로 둬(트랜잭션이 통째로 롤백된다) 다음 크론이 다시 시도한다.
    try {
      // ⚠ **한 사람의 정리는 한 트랜잭션이다**(2026-09-20). 예전에는 문장마다 따로 커밋해,
      //   중간에 끊기면 삭제 큐에는 올렸는데 행은 반쯤 남은 상태가 됐다 — 다음 틱의 큐 비우기가
      //   "아직 참조 중" 으로 보고 큐 행만 지워, **파일이 영영 안 지워지고 큐에도 없는** 누수가
      //   났다(실측: 24개 중 3개). 지금은 끊기면 전부 되돌아가 다음 틱이 처음부터 한다.
      const revocation = await withWriteTransaction(db, async (tx) => {
        // 삭제 직전에 '지금도 무료인가'를 다시 본다. 보관 행은 해지 시점에 깔리는데, 그 뒤
        // 보관 행을 지우지 않고 권한만 되살아나는 경우가 있다(기간 한정 개인 플랜 — 시작 전부터
        // 걸려 있던 보관은 여기서 풀어 준다). 그대로 지우면 지금 유료인 사용자의 목소리를 영구
        // 삭제하게 된다.
        if (await hasActivePaidEntitlement(tx, userPk, promoCoversFree)) {
          await clearPaidVoiceRetention(tx, userPk);
          return null;
        }
        const result = await deleteSensitiveVoiceDataForUser(
          tx,
          userPk,
          await resolveUserLoginId(tx, userPk),
        );
        await clearPaidVoiceRetention(tx, userPk);
        return result;
      });
      if (!revocation) continue;
      for (const target of revocation.downgradedAlarms) downgraded.set(target.alarmId, target);
      for (const id of revocation.voiceAccessRevokedUserIds) voiceAccessRevokedUserIds.add(id);
      cleanedUserPks.push(userPk);
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
  options: DowngradeOptions = {},
): Promise<void> {
  if (options.deleteVoiceData === true) {
    await db.execute(setUserPlanStatement(userPk, 'free'));
    await deletePaidVoiceDataForUser(db, userPk, await resolveUserLoginId(db, userPk));
    return;
  }
  // ⚠ **읽기 한 번 + 쓰기 한 번**(2026-09-20). 예전에는 등급·로그인 id·클론 조회·클론마다
  //   적재·반납을 한 문장씩 왕복해, 해지·만료·환불 요청의 쓰기 트랜잭션이 워커 subrequest
  //   한도(~50)에 다가갔다. 읽는 값(로그인 id·클론 id)은 이 쓰기가 바꾸지 않는다.
  // voice_profiles.user_id 는 로그인 id(google_id)로 저장되기도 하므로 PK(userPk)와 로그인 id 를
  // 모두 매칭한다(deletePaidVoiceDataForUser 와 동일 — 한쪽만 쓰면 일반 케이스를 놓쳐 클론
  // 반납이 누락된다).
  const [userRes, voiceRes] = await db.batch([
    { sql: `SELECT google_id FROM users WHERE id = ? LIMIT 1`, args: [userPk] },
    {
      sql: `SELECT elevenlabs_voice_id FROM voice_profiles
            WHERE elevenlabs_voice_id IS NOT NULL
              AND (user_id = ? OR user_id = (SELECT google_id FROM users WHERE id = ?))`,
      args: [userPk, userPk],
    },
  ]);
  const loginId = (userRes!.rows[0]?.google_id as string | null | undefined) ?? null;
  await db.batch(
    freeDowngradeWrites(
      userPk,
      loginId,
      voiceRes!.rows.map((r) => r.elevenlabs_voice_id as string),
    ),
  );
}

/**
 * `downgradeUserToFree` 의 **음성 보존 갈래 쓰기 문장** — 읽기(로그인 id·클론 id)는 호출부가
 * 미리 모아 넘긴다. 여러 사람을 한 묶음으로 내리는 경로(기간 한정 개인 플랜 종료 전환 —
 * `lib/personal-promo-end.ts`)가 **같은 문장**을 쓴다.
 */
export function freeDowngradeWrites(
  userPk: string,
  loginId: string | null,
  providerVoiceIds: Array<string | null | undefined>,
): InStatement[] {
  const ownerIds = Array.from(new Set([userPk, loginId].filter((x): x is string => Boolean(x))));
  return [
    setUserPlanStatement(userPk, 'free'),
    // 무료로 내려간 시점에 제공자 클론을 반납한다 — 유료 슬롯을 붙들고 있을 이유가 없다.
    // 원본 업로드는 남으므로, 보관 유예 안에 재구독하면 재클론으로 그대로 돌아온다.
    ...clonedVoiceReleaseStatements(ownerIds, providerVoiceIds),
  ];
}

/**
 * 반드시 쓰기 트랜잭션 안에서 호출한다. 활성 근거 없는 등급의 복구도 강등 전체를 수행한다.
 *
 * ⚠ **복구 조건은 원시 plan 이다**(`plan <> 'free'`) — 기간 한정 개인 플랜은 DB 에 쓰지 않으므로
 * 여기 닿지 않는다. 보관 기한만 `syncPaidVoiceRetention` 으로 판정해, 기간 중 복구된 계정에
 * 거짓 삭제 예고를 걸지 않는다(프로모가 꺼져 있으면 예전과 같이 예약된다 — 방금 free 로
 * 내렸고 활성 구독이 없다).
 */
export async function repairOrphanedPaidPlan(
  db: DbExecutor,
  userPk: string,
  now: Date,
  promoCoversFree: boolean,
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
  await syncPaidVoiceRetention(db, userPk, now, promoCoversFree);
  return [userPk];
}

/**
 * 구독 행 한 건을 취소 상태로 바꾼다.
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
}

/**
 * 구독 취소 후 사용자 plan 을 "실제 남은 활성 구독" 기준으로 재정렬한다 (E2).
 * 부분 취소(/cancel 의 스냅샷 단위 취소, RTDN 스테일/단일 토큰 만료 처리 등)에서
 * 다른 활성 유료 구독이 남아 있으면 free 로 내리지 않고 그 구독의 plan 으로 유지하며,
 * 클론 반납도 하지 않는다(여전히 유료다).
 * 남은 활성 유료 구독이 없을 때만 free 강등 + 클론 반납을 수행한다.
 */
async function syncUserPlanAfterCancel(
  db: DbExecutor,
  userPk: string,
  options: DowngradeOptions = {},
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
    // 보류·미확인 구독은 회복 가능하다. 다른 구독의 종료로 클론을 반납하지 않는다.
    await resolvePlanAfterSuspend(db, userPk, []);
  } else {
    await downgradeUserToFree(db, userPk, options);
  }
}

/** 권한이 살아 있는(`entitled`) 유료 구독 중 첫 행 — 호출부가 시작일 역순으로 넘긴다. */
export function strongestPaidSubscription<
  T extends Pick<ActiveSubscription, 'planType' | 'entitlementState'>,
>(subscriptions: T[]): T | undefined {
  return subscriptions.find(
    (s) => s.entitlementState === 'entitled' && PAID_PLAN_TYPES.has(s.planType),
  );
}

/**
 * suspend(ON_HOLD/PAUSED) 전용 plan 재정렬 (E). 매핑(정지된) 구독을 제외한 다른 활성 유료
 * 구독이 남아 있으면 그 plan 을 유지하고, 없을 때만 free 로 내린다 — deactivate 경로
 * (syncUserPlanAfterCancel)의 E2(잔여 유료 구독 유지)와 대칭.
 *
 * deactivate 와 달리 ON_HOLD/PAUSED 는 결제 복구로 되살아날 수 있는 회복형 상태라,
 * 클론 반납 같은 정리는 하지 않는다. users.plan 만 보수적으로 회수하며, 결제가 복구되면
 * entitle 가 users.plan 을 원복한다.
 * 매핑 구독은 active로 보존하고 entitlement_state에 보류를 기록한다. 이후 다른 구독의
 * 해지·환불에서도 이 제외가 유지되며, 스토어가 복구를 확인한 경로만 표식을 해제한다.
 * 반환값: 유지된 plan_type(없으면 null — free 로 내림).
 */
export async function resolvePlanAfterSuspend(
  db: DbExecutor,
  userPk: string,
  /**
   * 제외할 구독 id. **여러 개를 한 번에 넘겨야 한다** — 예전에는 문자열 하나만 받아서,
   * 한 사람이 활성 구독을 둘 이상 가지면 마지막 것만 제외되고 나머지가 유료로 남아
   * **강등이 안 됐다**(주석은 '전부 제외한다' 였는데 코드가 반대였다).
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

/** `downgradeUserToFree`·`syncUserPlanAfterCancel` 가 쓰는 것과 같은 등급 갱신 문장. */
function setUserPlanStatement(userPk: string, plan: string): InStatement {
  return {
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [plan, userPk],
  };
}

// 결제 해지/만료 흐름의 기본은 "음성 보존"이다. 하드 삭제는 보관 유예(sweep)나
// 계정 삭제(account-deletion) 같은 명시적 경로에서만 deleteVoiceData:true 로 요청한다.
// 등급이 바뀌는 사람은 구독 주인 하나다 — 호출부가 트랜잭션 커밋 '후' 그 사람에게 알린다
// (FCM 은 tx 안에서 쏘지 않는다).
export async function cancelSubscriptionImmediate(
  db: DbExecutor,
  subscription: ActiveSubscription,
  now: Date,
  options: DowngradeOptions,
): Promise<void> {
  await cancelOneSubscriptionRow(db, subscription.subscriptionId, now);
  await syncUserPlanAfterCancel(db, subscription.userPk, options);
}

export async function cancelActiveSubscriptionsForUser(
  db: DbExecutor,
  userPk: string,
  now: Date,
  options: DowngradeOptions,
): Promise<void> {
  for (const subscription of await findActiveSubscriptionsByUserPk(db, userPk)) {
    await cancelSubscriptionImmediate(db, subscription, now, options);
  }
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

  await db.execute({
    sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
          VALUES (?, ?, ?, 'active', ?, ?)`,
    args: [
      subscriptionId,
      params.userPk,
      params.planId,
      startsAt.toISOString(),
      expiresAt.toISOString(),
    ],
  });

  await db.execute({
    sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [planTypeToUserPlan(params.planType), params.userPk],
  });

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

/**
 * 권한 변경과 그 변경으로 생긴 삭제 유예는 커밋 후 **한 번에** 통지한다
 * (`sendBillingStateSignals` — 토큰 조회·OAuth 한 번, 안드로이드 중복 신호 없음).
 *
 * 예고는 **유예 행이 있는 사람만** 받는다 — 전원을 넘겨도 아직 유료인 사람은 알아서 빠진다.
 * ⚠ **던지지 않는다.** 커밋 뒤에 돈다 — 여기서 던지면 저장된 결제·해지가 500 으로 보인다.
 */
export async function notifyBillingStateChanged(
  db: Client,
  env: ExpiryEnv | undefined,
  userIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return;
  const hasFirebase = Boolean(env?.FIREBASE_PROJECT_ID && env?.FIREBASE_SERVICE_ACCOUNT_JSON);
  const hasApns = Boolean(env?.APNS_KEY_ID && env?.APNS_PRIVATE_KEY && env?.APPLE_TEAM_ID);
  if (!hasFirebase && !hasApns) return;
  try {
    const res = await db.execute({
      sql: `SELECT user_id FROM paid_voice_retention WHERE user_id IN (${unique.map(() => '?').join(', ')})`,
      args: unique,
    });
    await sendBillingStateSignals(db, env as ExpiryEnv, {
      planChangedUserIds: unique,
      deletionWarningUserPks: res.rows.map((r) => String(r.user_id)),
      retentionDays: PAID_VOICE_RETENTION_DAYS,
    });
  } catch (err) {
    logStructured('error', {
      at: 'billing.notify_state_changed',
      action: 'PUSH_FAILED',
      error: String(err),
    });
  }
}

/**
 * 한 번의 워커 실행에서 처리할 만료 구독 수.
 *
 * ⚠ **상한이 없으면 subrequest 한도에 걸려 틱 전체가 죽는다**(2026-09-18). 만료 한 건마다
 * 스토어 재조회(외부 fetch)와 여러 DB 왕복이 붙는데, 한 실행의 subrequest 는 ~50 개다.
 * 밀린 건은 다음 틱(5분)이 이어서 처리한다 — 구독마다 따로 끝나므로 나눠 처리해도 결과가 같다.
 */
const EXPIRY_BATCH_LIMIT = 5;

export async function processSubscriptionExpiry(
  db: Client,
  env?: ExpiryEnv,
  now: Date = new Date(),
): Promise<void> {
  const notifyUserPks = new Set<string>();
  // 기간 한정 개인 플랜 — 이 실행의 시각으로 한 번 푼다(보관 판정·종료 전환이 같은 값을 본다).
  const promo = resolvePersonalPromo(env, now);
  // ⚠ **권한이 살아 있는 행을 먼저, 보류·미확인 행은 남는 자리에서 다시 본다**(2026-09-20 실측).
  //   보류 행은 `active` 인 채 만료가 지나 있어 매 틱 다시 뽑힌다. 보류는 스토어 재확인으로만
  //   풀리므로 계속 보되, 새로 만료될 행을 밀어내지 않는다 — 보류 행이 자리를 다 쓰면 다른
  //   사람의 만료가 영영 안 돈다.
  const due = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.expires_at, p.plan_type
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.status = 'active' AND julianday(s.expires_at) <= julianday(?)
          ORDER BY CASE WHEN s.entitlement_state = 'entitled' THEN 0 ELSE 1 END, s.id
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
    const affected = await expireSubscriptionIfDue(
      db,
      subscriptionId,
      String(row.expires_at),
      now,
      promo.active,
    );
    for (const id of affected) notifyUserPks.add(id);
  }

  // 기간 한정 개인 플랜 **종료 전환**은 여기서 하지 않는다 — 전용 크론과 5분 틱의 폴백이
  // `lib/personal-promo-end.ts` 의 `runPersonalPromoEnd` 로 한다(`index.ts`). 대상이 수천 명이라
  // 이 틱의 subrequest 로는 끝 + 3일 약속을 지킬 수 없었다.

  // 보관 유예가 끝난 유료 음성 데이터 정리 (같은 cron 주기에서 처리).
  // 기간 중에는 원시 free 의 보관 행을 지우지 않고 풀어 준다(`promo.active`).
  const sweptVoiceData = await sweepPaidVoiceRetention(db, now, promo.active);

  // 강등된 사용자에게 plan_changed 푸시 — 클라가 '강등 시점'에 유료 목소리 알람을 기본 알람으로
  // 변환하게 한다(백그라운드 여도). 과다발송해도 클라가 재조회로 확인.
  // ⚠ 푸시는 **DB 쓰기가 끝난 뒤에** 쏜다(RTDN 갈래와 같은 규칙) — 네트워크 I/O 이고,
  // 실패해도 흐름을 깨지 않는다. 정확성은 클라의 재조회가 보장하고 푸시는 즉시성만 맡는다.
  // 유예가 걸린 사람에게는 **눈에 보이는** 삭제 예고를 함께 보낸다(나머지는 무음 신호).
  await notifyBillingStateChanged(db, env, Array.from(notifyUserPks));

  // 보관 정리가 서버에서 바꾼 '알람 행'은 plan_changed 로는 안 따라온다 — 이유는
  // notifyDowngradedAlarms 참고. 강등된 알람마다 알람 동기화 신호를 보낸다.
  await notifyDowngradedAlarms(
    db,
    env,
    sweptVoiceData.targets,
    sweptVoiceData.voiceAccessRevokedUserIds,
  );
}
