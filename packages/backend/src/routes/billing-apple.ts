import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { withWriteTransaction } from '../lib/transactions';
import {
  applePlanKeyFromProductId,
  planTypeToUserPlan,
  resolveUserPk,
} from './billing-helpers';

// MARK: - POST /billing/apple/confirm
//
// iOS `SubscriptionManager.syncWithBackend` 가 호출하는 라우트.
// App Store 영수증 확인 후 백엔드 entitlement 를 동기화한다.
//
// 본 phase 의 trust model (Apple App Store Server API v2 JWS 검증은 후속 PR 에서 강화):
//   1. 클라이언트는 인증된 사용자 세션에서만 호출 가능 (authMiddleware 통과 필수).
//   2. 알려진 SKU (`com.voicealarm.nativeapp.ios.{personal|couple|family}_{monthly|yearly}`)
//      만 수락. 임의 product_id 는 400 UNKNOWN_PRODUCT 로 거절.
//   3. APPLE_SHARED_SECRET 환경변수가 설정되어 있어야 한다. 미설정 시 503 — 운영자가
//      `wrangler secret put APPLE_SHARED_SECRET` 으로 주입.
//   4. 동일 transaction_id 의 중복 confirm 은 멱등 (200, 기존 row 반환).
//
// 후속 강화 (README/PR-NOTES 에 명시):
//   - Apple App Store Server API v2 의 `Get Transaction Info`
//     (`https://api.storekit.itunes.apple.com/inApps/v1/transactions/{transactionId}`,
//     sandbox: `https://api.storekit-sandbox.itunes.apple.com/...`) 로 JWS 를 받아
//     X5C 체인을 Apple 루트 CA 까지 검증하고 payload 의 productId/originalTransactionId
//     와 클라이언트 입력을 대조하는 server-to-server 검증을 추가.
//   - JWS 의 `expiresDate` 를 expires_at 의 권위 (authoritative) 로 채택.

interface ConfirmRequest {
  transaction_id: string;
  original_transaction_id: string;
  product_id: string;
}

function parseConfirmRequest(value: unknown): ConfirmRequest | { error: string } {
  if (!value || typeof value !== 'object') {
    return { error: 'Request body must be a JSON object' };
  }
  const raw = value as Record<string, unknown>;
  const transactionId = typeof raw.transaction_id === 'string' ? raw.transaction_id.trim() : '';
  const originalTransactionId =
    typeof raw.original_transaction_id === 'string' ? raw.original_transaction_id.trim() : '';
  const productId = typeof raw.product_id === 'string' ? raw.product_id.trim() : '';
  if (!transactionId) return { error: 'transaction_id is required' };
  if (!originalTransactionId) return { error: 'original_transaction_id is required' };
  if (!productId) return { error: 'product_id is required' };
  return {
    transaction_id: transactionId,
    original_transaction_id: originalTransactionId,
    product_id: productId,
  };
}

interface PlanRow {
  id: string;
  key: string;
  plan_type: string;
  period_days: number;
}

function normalizePlanRow(row: Record<string, unknown>): PlanRow {
  return {
    id: String(row.id),
    key: String(row.key),
    plan_type: String(row.plan_type),
    period_days: Number(row.period_days) || 30,
  };
}

const billingApple = new Hono<AppEnv>();

billingApple.post('/apple/confirm', async (c) => {
  // 환경 변수 게이트. 미설정 시 운영자 액션이 필요하므로 503.
  if (!c.env.APPLE_SHARED_SECRET) {
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

  const { transaction_id, original_transaction_id, product_id } = parsed;

  // SKU 화이트리스트 검증.
  const planKey = applePlanKeyFromProductId(product_id);
  if (!planKey) {
    return c.json(
      {
        error: `Unknown Apple product id: ${product_id}`,
        error_code: 'UNKNOWN_PRODUCT',
      },
      400,
    );
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const db = getDB(c.env);

  // 멱등 lookup: 같은 transaction_id 가 이미 처리됐다면 그대로 echo.
  const existingRes = await db.execute({
    sql: `SELECT s.id AS sub_id, s.expires_at, p.key AS plan_key
          FROM subscriptions s
          JOIN plans p ON p.id = s.plan_id
          WHERE s.apple_transaction_id = ? AND s.user_id = ?
          LIMIT 1`,
    args: [transaction_id, userPk],
  });
  if (existingRes.rows.length > 0) {
    const row = existingRes.rows[0]!;
    return c.json({
      subscription_id: String(row.sub_id),
      plan: String(row.plan_key),
      expires_at: String(row.expires_at),
    });
  }

  // plan_key 로 plans 행 조회.
  const planRes = await db.execute({
    sql: `SELECT id, key, plan_type, period_days FROM plans WHERE key = ? AND is_active = 1`,
    args: [planKey],
  });
  if (planRes.rows.length === 0) {
    return c.json(
      { error: `Plan not found for key=${planKey}`, error_code: 'PLAN_NOT_FOUND' },
      400,
    );
  }
  const plan = normalizePlanRow(planRes.rows[0]!);

  // expires_at: 본 phase 에서는 period_days 기반으로 산출. 후속 PR 에서 Apple JWS expiresDate 로 교체.
  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + plan.period_days * 24 * 60 * 60 * 1000);
  const subscriptionId = crypto.randomUUID();
  const startsAtIso = startsAt.toISOString();
  const expiresAtIso = expiresAt.toISOString();

  try {
    await withWriteTransaction(db, async (tx) => {
      // 기존 active 구독을 expired 로 정리 (단일 active 유지). 즉시 만료 처리는
      // billing-cancel 의 cancel 흐름과 달리 voice data 등을 건드리지 않는다.
      await tx.execute({
        sql: `UPDATE subscriptions
              SET status = 'expired', updated_at = datetime('now')
              WHERE user_id = ? AND status = 'active'`,
        args: [userPk],
      });

      await tx.execute({
        sql: `INSERT INTO subscriptions (
                id, user_id, plan_id, plan_group_id, status,
                starts_at, expires_at,
                apple_transaction_id, apple_original_transaction_id, apple_product_id
              ) VALUES (?, ?, ?, NULL, 'active', ?, ?, ?, ?, ?)`,
        args: [
          subscriptionId,
          userPk,
          plan.id,
          startsAtIso,
          expiresAtIso,
          transaction_id,
          original_transaction_id,
          product_id,
        ],
      });

      await tx.execute({
        sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [planTypeToUserPlan(plan.plan_type), userPk],
      });
    });
  } catch (err) {
    // DB 미초기화 / unique 충돌 / 트랜잭션 실패 등 — 클라이언트는 StoreKit 권위에 의지하고
    // 다음 사이클에서 재시도하므로 5xx 로 graceful degradation.
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { error: 'Failed to persist Apple subscription', error_code: 'APPLE_PERSIST_FAILED', detail: message },
      500,
    );
  }

  return c.json({
    subscription_id: subscriptionId,
    plan: plan.key,
    expires_at: expiresAtIso,
  });
});

export default billingApple;
