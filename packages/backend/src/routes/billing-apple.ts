import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { applePlanKeyFromProductId } from './billing-helpers';

// MARK: - POST /billing/apple/confirm
//
// iOS `SubscriptionManager.syncWithBackend` 가 호출하는 라우트.
// App Store 영수증 확인 후 백엔드 entitlement 를 동기화한다.
//
// 이 라우트는 인증된 앱 세션에서만 호출되지만, 클라이언트가 보낸
// transaction_id/product_id 는 권위가 아니다. App Store Server API/JWS 검증이
// 붙기 전까지는 fail-closed 로 유지한다. 그렇지 않으면 iOS 호출 하나로
// 공유 users.plan/subscriptions 상태가 변해 Android 유료 기능까지 열릴 수 있다.

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

  return c.json(
    {
      error: 'Apple transaction verification is required before entitlement mutation',
      error_code: 'APPLE_TRANSACTION_VERIFICATION_REQUIRED',
      plan_key: planKey,
      transaction_id,
      original_transaction_id,
      product_id,
    },
    501,
  );
});

export default billingApple;
