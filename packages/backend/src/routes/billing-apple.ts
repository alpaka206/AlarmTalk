// Apple 결제(StoreKit 2) 확인 라우트.
//
// 구조는 `billing-google.ts` 의 confirm 과 같다:
//   클라 주장 무시 → 스토어 API 로 검증 → applyStoreEntitlement 로 구독 반영.
// 다른 점은 애플이 purchaseToken 대신 **transactionId** 를 쓴다는 것뿐이다.
//
// ⚠ 기존 구글 경로는 이 파일과 완전히 분리돼 있다. 공유하는 것은 provider 를 인자로 받는
// `applyStoreEntitlement` 뿐이고, 그건 이미 provider-agnostic 하게 짜여 있었다.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import {
  cancelSubscriptionImmediate,
  findActiveSubscriptionsByUserPk,
  hasActivePaidEntitlement,
  findStoreTransactionsForSubscriptions,
  notifyPlanChanged,
  notifyBillingStateChanged,
  notifyVoiceDeletionScheduled,
  schedulePaidVoiceRetention,
  storeRenewalProvidersOf,
  type ActiveSubscription,
} from '../lib/billing-cancel';
import { logStructured } from '../lib/logger';
import { withWriteTransaction, type DbExecutor } from '../lib/transactions';
import { BillingStateChangedError } from '../lib/billing-reconciliation';
import { applyStoreEntitlement, loadPlanByKey } from '../lib/store-billing';
import {
  appleStoreKitConfigFromEnv,
  applePlanKeyFromProductId,
  isAppleGiftProductId,
  fetchAppleTransaction,
  fetchAppleSubscriptionStatus,
  APPLE_SUBSCRIPTION_STATUS,
  AppleTransactionNotFoundError,
} from '../lib/apple-storekit';
import { resolveUserPk } from './billing-helpers';
import { issueVoucherCode } from '../lib/voucher-issue';

const billingApple = new Hono<AppEnv>();

interface ConfirmRequest {
  transaction_id: string;
}

function parseConfirmRequest(raw: unknown): ConfirmRequest | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Body must be a JSON object' };
  const body = raw as Record<string, unknown>;
  const transactionId = typeof body.transaction_id === 'string' ? body.transaction_id.trim() : '';
  if (!transactionId) return { error: 'transaction_id is required' };
  // 길이 상한은 서버에도 둔다(CLAUDE.md 입력 규약) — 거대한 문자열이 URL·조회로 흘러가지 않게.
  if (transactionId.length > 128) return { error: 'transaction_id is too long' };
  return { transaction_id: transactionId };
}

billingApple.post('/apple/confirm', async (c) => {
  // 구성 가드 — 구글 경로와 동일하게 503 fail-closed.
  // App Store Connect 값(Issuer ID / Key ID / .p8 / 번들 ID)이 없으면 애플에 물어볼 수 없고,
  // 물어보지 못한 채로 통과시키면 클라 주장을 그대로 믿는 것이 된다.
  const config = appleStoreKitConfigFromEnv(c.env);
  if (!config) {
    return c.json(
      {
        error: 'Apple billing is not configured on the server',
        error_code: 'APPLE_BILLING_UNCONFIGURED',
      },
      503,
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = parseConfirmRequest(body);
  if ('error' in parsed) {
    return c.json({ error: parsed.error, error_code: 'INVALID_REQUEST' }, 400);
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  // 애플에 직접 조회한다. 클라가 보낸 것은 transaction id 문자열 하나뿐이고,
  // 상품·만료·소유 여부는 전부 이 응답이 권위다.
  let info;
  try {
    info = await fetchAppleTransaction(parsed.transaction_id, config);
  } catch (err) {
    if (err instanceof AppleTransactionNotFoundError) {
      return c.json({ error: 'Transaction not found', error_code: 'TRANSACTION_NOT_FOUND' }, 404);
    }
    logStructured('error', {
      at: 'billing.apple.confirm',
      step: 'lookup',
      error: String(err),
    });
    return c.json(
      { error: 'Apple verification failed', error_code: 'APPLE_VERIFICATION_FAILED' },
      502,
    );
  }

  const planKey = applePlanKeyFromProductId(info.productId);
  if (!planKey) {
    return c.json(
      { error: `Unknown Apple product id: ${info.productId}`, error_code: 'UNKNOWN_PRODUCT' },
      400,
    );
  }

  const db0 = getDB(c.env);

  // 환불·취소된 트랜잭션으로 권한을 얻을 수 없게 한다.
  //
  // ⚠ **거절만 하면 이미 준 권한이 그대로 남는다**(코덱스 #730 3차). 애플에는 우리가 받는
  //   서버 알림 라우트가 없어서(App Store Server Notifications 미구현), 기간 중 환불은
  //   클라가 `Transaction.updates` 로 물어다 준 이 요청이 **유일한 통보**다. 여기서
  //   400 만 돌려주면 만료 크론이 재조회할 때까지 — 즉 저장된 `expires_at` 까지 —
  //   환불받은 계정과 그 가족 멤버가 계속 유료로 남는다.
  //
  //   회수 대상은 **그 트랜잭션에 묶인 구독**이지 요청을 보낸 계정이 아니다. 환불은
  //   애플이 확인해 준 사실이고(`fetchAppleTransaction` 이 검증한다), 그 구독은 누가
  //   알려 주든 끊기는 것이 맞다.
  if (info.revocationDate) {
    // ⚠ **체인이 아직 살아 있으면 손대지 않는다**(코덱스 #733 2차). 자동갱신 구독은
    //   갱신마다 트랜잭션이 새로 나지만 `originalTransactionId` 는 **체인 전체가 공유**한다.
    //   그래서 옛 갱신 한 건이 뒤늦게 환불되면, 아래 조회가 그 id 로 **지금 살아 있는
    //   구독 행**을 집어 취소해 버린다 — 이어받은 그룹까지 해체되고, 그건 되돌릴 수 없다.
    //   판단은 애플에 **체인의 현재 상태**를 물어서 한다.
    const refundSnapshot = await readRefundedMapping(db0, info);
    const chain = await appleChainStatus(config, info.originalTransactionId);
    if (chain === 'unknown') {
      // ⚠ **판정을 못 했으면 판정한 척하지 않는다**(코덱스 #733 8차). 400 은 앱이
      //   **최종 판정**으로 읽어 환불 큐에서 지우고 트랜잭션을 끝낸다 — 그러면 다시 올릴
      //   경로가 사라지고, 정작 회수는 하지 않은 채다. 재시도 가능한 502 로 돌려준다
      //   (`adjudicatedStatuses` 에 없으므로 앱이 큐에 남긴다).
      return c.json(
        { error: 'Apple verification failed', error_code: 'APPLE_VERIFICATION_FAILED' },
        502,
      );
    }
    if (chain === 'live') {
      logStructured('info', {
        at: 'billing.apple.confirm',
        step: 'revoked_stale_renewal',
        note: 'chain still live — skipping cleanup',
      });
    } else {
      try {
        await revokeRefundedAppleSubscription(db0, c.env, info, refundSnapshot);
      } catch (error) {
        if (!(error instanceof BillingStateChangedError)) throw error;
        return c.json(
          {
            error: 'Subscription changed during verification',
            error_code: 'APPLE_VERIFICATION_FAILED',
          },
          502,
        );
      }
    }
    return c.json({ error: 'Transaction was revoked', error_code: 'TRANSACTION_REVOKED' }, 400);
  }

  // ⚠ **이 결제가 이 계정 것인지 확인한다**(2026-08-18 Codex #697 P1).
  // 구글 갈래는 `obfuscatedExternalAccountId` 로 처음부터 이 검사를 했는데 애플에는
  // 없었다. 애플은 소모성·구독 모두 **끝내지 않은 트랜잭션을 재전달**하므로, 서버 확정에
  // 실패한 채 같은 기기에서 다른 AlarmTalk 계정으로 로그인하면 그 트랜잭션이 **새 세션의
  // 토큰으로** 다시 올라온다 — 검사가 없으면 나중 계정이 구독·선물 바우처를 가져간다.
  //
  // 대조 값은 클라가 구매 시 `appAccountToken` 에 실은 우리 쪽 사용자 id(UUID)다.
  // 구글이 해시를 쓰는 것과 달리 애플은 **UUID 만** 허용해 그대로 싣는다.
  const appleAccountToken = info.appAccountToken?.trim().toLowerCase();
  if (appleAccountToken) {
    const candidates = [c.get('userLoginId'), c.get('userId'), userPk]
      .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
      .filter((v) => v.length > 0);
    if (!candidates.includes(appleAccountToken)) {
      logStructured('warn', {
        at: 'billing.apple.confirm',
        step: 'account_binding',
        error: 'appAccountToken mismatch',
      });
      return c.json(
        {
          error: 'Purchase is bound to another account',
          error_code: 'TRANSACTION_ACCOUNT_MISMATCH',
        },
        403,
      );
    }
  } else {
    // 식별자가 없는 **최초 청구**는 거절한다(구글 갈래와 같은 규칙 — 유출 토큰
    // first-claim 구멍을 막는다). 이미 바인딩된 트랜잭션의 재전송은 통과시킨다.
    // iOS 는 아직 App Store 에 없어 옛 클라 구매가 존재하지 않으므로 엄격해도 안전하다.
    const boundRes = await db0.execute({
      sql: `SELECT user_id FROM store_transactions
            WHERE provider = 'apple' AND provider_transaction_id = ?`,
      args: [
        isAppleGiftProductId(info.productId) ? info.transactionId : info.originalTransactionId,
      ],
    });
    if (boundRes.rows.length === 0) {
      logStructured('warn', {
        at: 'billing.apple.confirm',
        step: 'account_binding',
        error: 'appAccountToken missing on first claim',
      });
      return c.json(
        {
          error: 'Purchase is missing the account identifier',
          error_code: 'TRANSACTION_ACCOUNT_UNVERIFIED',
        },
        403,
      );
    }
  }

  // ⚠ **선물 상품은 여기서 갈라진다.** 자동 갱신 구독은 남에게 줄 수 없어(스토어가
  // 구매자 계정에 묶는다) 선물은 1회성 상품을 팔고 그 대금으로 **바우처 코드**를 만든다.
  // 이 갈래를 안 만들면 구매자 본인이 이용권을 받게 되고, 아래 `expiresDate` 검사에
  // 걸려 소모성 결제는 통째로 거절된다.
  if (isAppleGiftProductId(info.productId)) {
    const giftPlan = await loadPlanByKey(db0, planKey);
    if (!giftPlan) {
      return c.json({ error: 'Plan not found', error_code: 'PLAN_NOT_FOUND' }, 400);
    }
    const issuedAt = new Date(info.purchaseDate);
    // 바우처 유효기간은 **받는 사람이 등록할 때까지의 기한**이다. 등록하면 그 시점부터
    // 플랜 기간이 시작된다.
    const voucherExpiresAt = new Date(
      issuedAt.getTime() + giftPlan.period_days * 24 * 60 * 60 * 1000,
    );
    const gift = await withWriteTransaction(db0, async (txDb) => {
      // ⚠ **같은 결제로 두 번 발급하지 않는다.** 스토어는 같은 트랜잭션을 재전송할 수
      // 있고(네트워크 재시도·복원), 멱등하지 않으면 코드가 여러 장 나온다.
      const seen = await txDb.execute({
        sql: `SELECT id FROM store_transactions
              WHERE provider = 'apple' AND provider_transaction_id = ? LIMIT 1`,
        args: [info.transactionId],
      });
      if (seen.rows.length > 0) return null;
      await txDb.execute({
        // ⚠ **`plan_key` 를 빠뜨리지 말 것.** 마이그레이션 42 가 `TEXT NOT NULL`(기본값
        // 없음)로 만든 컬럼이라, 빠지면 INSERT 가 거절되고 **트랜잭션이 통째로 롤백**된다 —
        // 스토어는 이미 결제를 받았는데 바우처가 안 나간다(2026-08-18 Codex #697 P1).
        sql: `INSERT INTO store_transactions
              (id, user_id, provider, provider_transaction_id, product_id, plan_key, subscription_id, raw_payload, last_paid_at)
              VALUES (?, ?, 'apple', ?, ?, ?, NULL, ?, ?)`,
        args: [
          crypto.randomUUID(),
          userPk,
          info.transactionId,
          info.productId,
          planKey,
          JSON.stringify({ kind: 'gift', environment: info.environment ?? null }),
          issuedAt.toISOString(),
        ],
      });
      return issueVoucherCode(txDb, {
        kind: 'gift',
        planId: giftPlan.id,
        issuerUserId: userPk,
        issuerSubscriptionId: null,
        issuedAt: issuedAt.toISOString(),
        expiresAt: voucherExpiresAt.toISOString(),
        maxUses: 1,
      });
    });
    // ⚠ **성공 필드는 `success` 다 — `ok` 가 아니다.** 아래 구독 갈래도, 클라의
    // `ConfirmAppleSubscriptionResponse` 도 `success` 만 읽는다(없으면 `false` 로 떨어진다).
    // 그래서 선물은 **발급에 성공해도 클라에서는 실패**로 보였다(2026-08-18 Codex #697 P1).
    // 지금은 그게 곧바로 손해다: 클라가 확정 못 한 소모성 결제를 `finish` 하지 않으므로
    // 정상 발급된 선물이 계속 미완료로 남고 구매 화면은 실패라고 말한다.
    if (!gift) {
      // 이미 처리한 결제다. 실패가 아니라 **같은 결과**를 돌려준다.
      return c.json({ success: true, gift: true, duplicate: true });
    }
    return c.json({
      success: true,
      gift: true,
      voucher: { code: gift.code, expires_at: gift.expires_at },
    });
  }

  // 자동 갱신 구독은 expiresDate 가 반드시 있다. 없으면 우리가 파는 상품이 아니다
  // (소모품·비소모품). 만료를 모르면 언제까지 권한을 줄지도 모르므로 거절한다.
  if (!info.expiresDate) {
    return c.json(
      { error: 'Transaction has no expiry', error_code: 'TRANSACTION_NOT_SUBSCRIPTION' },
      400,
    );
  }
  const expiresAt = new Date(info.expiresDate);
  if (expiresAt.getTime() <= Date.now()) {
    return c.json(
      { error: 'Subscription already expired', error_code: 'SUBSCRIPTION_EXPIRED' },
      400,
    );
  }

  const db = getDB(c.env);

  // ⚠ **빠른 거절일 뿐, 권위는 아니다**(코덱스 #733 6차). 진짜 판정은
  //   `applyStoreEntitlement` 가 **쓰기 트랜잭션 안에서** 한다 — 여기서만 보면 두 스토어의
  //   확정이 동시에 들어올 때 둘 다 통과한다. 이 검사는 애플 호출·플랜 조회를 아끼는 용도다.
  //
  // ⚠ **다른 스토어가 아직 갱신을 쥐고 있으면 여기서 거절한다**(코덱스 #733 4차).
  //   앱도 막지만 그 판정은 **캐시된 스냅샷**이라, 같은 계정이 다른 기기에서 방금 Play
  //   구독을 시작한 경우를 못 본다(구매자 본인은 `plan_changed` 대상도 아니다). 그대로
  //   확정하면 `applyStoreEntitlement` 가 **우리 DB 의 Play 구독 행만** 취소하고 Play 는
  //   계속 갱신한다 — 두 곳에서 청구되고, 행이 사라져 앱에서 Play 를 관리할 입구도 없다.
  //
  //   거절해도 잃는 것은 없다: 스토어 트랜잭션은 그대로 남아 있으므로 Play 를 해지한 뒤
  //   앱이 다시 올리면(`resyncEntitlements`) 그때 통과한다.
  const activeSubscriptions = await findActiveSubscriptionsByUserPk(db, userPk);
  const renewalProviders = storeRenewalProvidersOf(
    await findStoreTransactionsForSubscriptions(
      db,
      // 해지 예약된 구독은 갱신 주인이 아니다 — 트랜잭션 안의 판정과 같은 규칙이어야
      // 두 곳이 다른 답을 내지 않는다.
      activeSubscriptions.filter((sub) => !sub.cancelAtPeriodEnd).map((sub) => sub.subscriptionId),
    ),
  );
  if (renewalProviders.includes('google')) {
    logStructured('warn', {
      at: 'billing.apple.confirm',
      step: 'cross_store_renewal',
      userPk,
    });
    return c.json(
      {
        error: 'A Google Play subscription is still renewing for this account',
        error_code: 'CROSS_STORE_RENEWAL_ACTIVE',
      },
      409,
    );
  }

  const plan = await loadPlanByKey(db, planKey);
  if (!plan) {
    return c.json({ error: 'Plan not found', error_code: 'PLAN_NOT_FOUND' }, 400);
  }

  const result = await withWriteTransaction(db, (txDb) =>
    applyStoreEntitlement(txDb, {
      userPk,
      provider: 'apple',
      // ⚠ originalTransactionId 를 쓴다. transactionId 는 **갱신마다 바뀌므로**
      // 그걸 키로 삼으면 매달 새 구독이 생긴다. originalTransactionId 는 구독 수명 동안
      // 고정이라 구글의 purchaseToken 과 같은 역할을 한다.
      providerTransactionId: info.originalTransactionId,
      productId: info.productId,
      plan,
      startsAt: new Date(info.purchaseDate),
      // 애플은 이 트랜잭션의 결제 시각을 준다 — 서버 시각보다 정확하다.
      lastPaidAt: new Date(info.purchaseDate),
      expiresAt,
      rawPayload: JSON.stringify({
        transactionId: info.transactionId,
        type: info.type,
        environment: info.environment ?? null,
      }),
    }),
  );

  if (!result.ok) {
    return c.json(
      { error: 'Purchase belongs to another account', error_code: result.errorCode },
      result.status,
    );
  }

  // ⚠ **정원 축소로 나가게 된 멤버에게 반드시 알린다.** 전환은 소유자가 하지만 대가는
  // 멤버가 치른다 — 아무 말 없이 유료 접근을 잃으면 앱이 고장 난 줄 안다.
  // (FCM 은 트랜잭션 안에서 쏘지 않는다 — 커밋 뒤 여기서.)
  await notifyBillingStateChanged(db, c.env, result.planChangedUserIds);

  return c.json({
    success: true,
    plan_key: planKey,
    subscription: result.subscription,
  });
});

/**
 * **이 구독 체인이 아직 살아 있는가** — 환불 통보 하나로 취소해도 되는지 가르는 자리다.
 *
 * `originalTransactionId` 는 체인 전체가 공유하므로, 옛 갱신이 환불됐다고 해서 **지금**
 * 구독이 끝났다는 뜻은 아니다.
 *
 * ⚠ **끝난 상태를 목록으로 적는다(허용 목록의 반대가 아니라).** 예전에는 `!== EXPIRED` 로
 * 썼는데, **지금 구독 자체가 환불되면 애플은 만료(2)가 아니라 `REVOKED`(5)** 를 준다 —
 * 그 한 글자 때문에 주 경로인 "지금 구독 환불" 이 통째로 새어 나갔다(코덱스 #733 3차).
 * 목록에 없는 값(애플이 나중에 늘릴 수도 있다)은 **살아 있다고 본다.**
 *
 * 재시도(3)·유예(4)는 회복형이라 여기서 끊지 않는다 — 만료 크론의 보류 갈래가 다룬다.
 * (`reconcileStoreSubscription`은 반대로 '권한 있는 상태'를 목록으로 적는다. 묻는 것이
 * 달라서 목록도 다르다: 저기는 "지금 유료인가", 여기는 "끝났는가" 다.)
 *
 * ⚠ **못 물어보면 `unknown` 이다 — '살아 있다' 로 접지 않는다**(코덱스 #733 8차).
 * 정리를 건너뛰는 것까지는 맞지만, 그때 라우트가 400(최종 판정)을 돌려주면 앱이 환불 큐에서
 * 지워 **다시 올릴 경로가 사라진다.** 호출부가 재시도 가능한 응답을 내야 한다.
 * (잘못 취소하는 쪽이 더 나쁘다는 판단은 그대로다 — 돈을 내고 있는 그룹이 해체되면
 * 되돌릴 수 없다.)
 */
const APPLE_TERMINATED_STATUSES: readonly number[] = [
  APPLE_SUBSCRIPTION_STATUS.EXPIRED,
  APPLE_SUBSCRIPTION_STATUS.REVOKED,
];

async function appleChainStatus(
  config: Parameters<typeof fetchAppleSubscriptionStatus>[1],
  originalTransactionId: string,
): Promise<'live' | 'terminated' | 'unknown'> {
  try {
    const status = await fetchAppleSubscriptionStatus(originalTransactionId, config);
    return APPLE_TERMINATED_STATUSES.includes(status.status) ? 'terminated' : 'live';
  } catch (err) {
    logStructured('warn', {
      at: 'billing.apple.confirm',
      step: 'chain_status',
      error: String(err),
    });
    return 'unknown';
  }
}

async function readRefundedMapping(
  db: DbExecutor,
  info: { originalTransactionId: string; transactionId: string },
) {
  const result = await db.execute({
    sql: `SELECT st.user_id, st.subscription_id, st.last_paid_at, st.expires_at AS store_expires_at,
                 st.product_id, s.expires_at, s.updated_at,
                 s.plan_id, s.plan_group_id, p.plan_type, p.key AS plan_key
          FROM store_transactions st
          JOIN subscriptions s ON s.id = st.subscription_id
          JOIN plans p ON p.id = s.plan_id
          WHERE st.provider = 'apple'
            AND st.provider_transaction_id IN (?, ?)
            AND s.status = 'active'`,
    args: [info.originalTransactionId, info.transactionId],
  });
  return result.rows[0];
}

/**
 * **환불된 애플 결제의 권한을 회수한다.**
 *
 * Play 의 RTDN `deactivate` 갈래와 같은 정리다(`billing-google-rtdn.ts`) — 매핑된 구독
 * 한 건만 취소하고, 목소리는 지우지 않고 보관 유예를 건다(재구독하면 entitle 경로가
 * 유예를 푼다). 강등되는 당사자와 해체된 그룹 멤버에게 알린다.
 *
 * ⚠ **조회 키가 둘이다.** 구독은 `originalTransactionId`(갱신마다 바뀌지 않는다), 선물은
 * `transactionId` 로 기록된다. 한쪽만 보면 못 찾는다.
 *
 * 선물(소모성)은 여기서 아무것도 하지 않는다 — 바우처는 `subscription_id` 가 없어 아래
 * JOIN 에 걸리지 않는다. 이미 등록된 코드를 되돌리는 것은 별개 문제라 여기서 다루지 않는다.
 */
async function revokeRefundedAppleSubscription(
  db: ReturnType<typeof getDB>,
  env: AppEnv['Bindings'],
  info: { originalTransactionId: string; transactionId: string },
  expected: Awaited<ReturnType<typeof readRefundedMapping>>,
): Promise<void> {
  const now = new Date();
  // ⚠ **조회를 쓰기 트랜잭션 안에서 한다**(코덱스 #733). 밖에서 읽으면 그 사이에 같은
  //   사용자가 재구매·플랜 변경을 할 수 있고, 그러면 이 행은 이미 취소된 채 **그룹만
  //   새 구독으로 넘어가 있다.** 그 낡은 행으로 정리를 돌리면 구독 UPDATE 는 가드에
  //   걸려 무해하지만 `disbandOwnedPlanGroup` 은 그대로 돌아 **지금 돈을 내고 있는
  //   구독이 뒷받침하는 그룹에서 멤버를 전원 내보낸다.**
  const affected = await withWriteTransaction(db, async (tx) => {
    const row = await readRefundedMapping(tx, info);
    // Apple 왕복 중 새 갱신이 같은 체인에 반영됐으면, 옛 종료 응답으로 그룹을 해체하지 않는다.
    if (JSON.stringify(row) !== JSON.stringify(expected)) throw new BillingStateChangedError();
    if (!row) return null; // 구독이 아니거나(선물) 이미 정리됐다.

    const mapped: ActiveSubscription = {
      subscriptionId: String(row.subscription_id),
      userPk: String(row.user_id),
      planId: String(row.plan_id),
      planType: String(row.plan_type),
      planKey: String(row.plan_key),
      planGroupId: (row.plan_group_id as string | null) ?? null,
      // 환불 회수는 이 값을 보지 않는다 — 어차피 지금 끊는다.
      cancelAtPeriodEnd: false,
    };
    const ids = await cancelSubscriptionImmediate(tx, mapped, now, { deleteVoiceData: false });
    // ⚠ **아직 유료면 보관 유예를 걸지 않는다**(코덱스 #733 6차). 환불된 애플 구독이 이
    //   계정의 **여러 활성 구독 중 하나**일 수 있다(구글 구독·프로모가 남아 있는 경우) —
    //   `cancelSubscriptionImmediate` 는 살아남은 유료 플랜을 일부러 보존한다. 그런데
    //   유예 행을 무조건 깔면, 돈을 내고 있는 사용자에게 **"목소리가 3일 뒤 삭제돼요"**
    //   가 나간다. 스윕이 나중에 취소해 주긴 하지만, 그때는 이미 놀란 뒤다.
    const stillPaid = await hasActivePaidEntitlement(tx, mapped.userPk);
    if (!stillPaid) await schedulePaidVoiceRetention(tx, mapped.userPk, now);
    return { mapped, ids, stillPaid };
  });
  if (!affected) return;
  const { mapped, ids } = affected;
  logStructured('info', {
    at: 'billing.apple.confirm',
    step: 'revoked_cleanup',
    userPk: mapped.userPk,
    subscriptionId: mapped.subscriptionId,
    affected: ids.length,
  });
  // 푸시는 커밋 뒤에(트랜잭션 안에서 네트워크를 쓰지 않는다).
  //
  // ⚠ **여기서 던지면 라우트가 500 이 된다 — 정리는 이미 커밋됐는데.**(코덱스 #733 2차)
  //   그러면 앱은 `TRANSACTION_REVOKED` 를 못 받아 권위 상태를 다시 읽는 경로를 놓치고,
  //   푸시까지 못 받았으면 **회수가 끝났는데도 유료 상태를 그대로 들고 있다.**
  //   통지는 즉시성만 담당하고 정확성은 클라의 재조회가 보장한다 — 최선 노력으로 둔다.
  try {
    await notifyPlanChanged(db, env, ids);
    // ⚠ **`stillPaid` 로 통째로 막지 말 것**(코덱스 #733 7차). 그 값은 **소유자** 얘기다.
    //   그룹이 해체되면서 떨어져 나간 멤버들은 유예가 걸려 있는데, 소유자에게 다른 유료
    //   구독이 남아 있다는 이유로 예고를 통째로 건너뛰면 **그 멤버들은 아무 경고 없이
    //   목소리를 잃는다.**
    //   `notifyVoiceDeletionScheduled` 는 **유예 행이 있는 사람만** 고르므로, 전원을 넘겨도
    //   아직 유료인 소유자는 알아서 빠진다. 그게 이 헬퍼가 그렇게 만들어진 이유다.
    await notifyVoiceDeletionScheduled(db, env, ids);
  } catch (err) {
    logStructured('error', {
      at: 'billing.apple.confirm',
      step: 'revoked_notify',
      error: String(err),
    });
  }
}

export default billingApple;
