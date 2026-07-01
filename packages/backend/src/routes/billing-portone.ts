import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { withWriteTransaction } from '../lib/transactions';
import { logStructured } from '../lib/logger';
import { applyStoreEntitlement, loadPlanByKey } from '../lib/store-billing';
import { PAID_PLAN_TYPES, resolveUserPk } from './billing-helpers';

// MARK: - POST /billing/portone/complete (국내 PG)
//
// 웹 랜딩/웹뷰에서 PortOne(구 아임포트) V2 로 결제한 뒤 호출하는 완료 라우트.
//
// 검증 전략: 클라이언트가 보낸 payment_id 로 PortOne 결제 조회 API 를 서버가
// 직접 호출해 (1) status === 'PAID', (2) 통화 KRW, (3) 결제 금액 == 해당 플랜의
// price_krw 를 확인한 뒤 entitlement 를 반영한다. 금액 검증이 플랜 키 위조
// (저가 플랜 결제로 고가 플랜 활성화)를 차단한다.
//
// 참고: V1 단건 결제 기준이라 자동 갱신은 없다 — 만료는 plan.period_days 로
// 계산하고, 갱신 결제는 동일 라우트로 새 payment_id 를 보내면 된다.
// 빌링키 기반 자동 갱신은 후속 작업 (PORTONE_BILLING_KEY 흐름).
//
// 필요 secrets: PORTONE_API_SECRET.

interface CompleteRequest {
  payment_id: string;
  plan_key: string;
}

function parseCompleteRequest(value: unknown): CompleteRequest | { error: string } {
  if (!value || typeof value !== 'object') {
    return { error: 'Request body must be a JSON object' };
  }
  const raw = value as Record<string, unknown>;
  const paymentId = typeof raw.payment_id === 'string' ? raw.payment_id.trim() : '';
  const planKey = typeof raw.plan_key === 'string' ? raw.plan_key.trim() : '';
  if (!paymentId) return { error: 'payment_id is required' };
  if (!planKey) return { error: 'plan_key is required' };
  return { payment_id: paymentId, plan_key: planKey };
}

interface PortOnePayment {
  status?: string;
  amount?: { total?: number };
  currency?: string;
  orderName?: string;
}

const billingPortone = new Hono<AppEnv>();

billingPortone.post('/portone/complete', async (c) => {
  if (!c.env.PORTONE_API_SECRET) {
    return c.json(
      {
        error: 'PortOne billing is not configured on the server',
        error_code: 'PORTONE_BILLING_UNCONFIGURED',
      },
      503,
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = parseCompleteRequest(body);
  if ('error' in parsed) {
    return c.json({ error: parsed.error, error_code: 'INVALID_REQUEST' }, 400);
  }

  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const db = getDB(c.env);
  const plan = await loadPlanByKey(db, parsed.plan_key);
  if (!plan || !PAID_PLAN_TYPES.has(plan.plan_type)) {
    return c.json({ error: 'Plan not found', error_code: 'PLAN_NOT_FOUND' }, 400);
  }
  if (plan.price_krw <= 0) {
    return c.json({ error: 'Plan is not billable', error_code: 'FREE_NOT_BILLABLE' }, 400);
  }

  // 리플레이 방지: PortOne V1 단건결제는 payment_id 를 1회만 소비한다. 만료를 서버가
  // 로컬 계산(now + period_days)하므로, 이미 처리된 payment_id 를 재전송하면 결제 없이
  // 만료가 매번 연장된다(무결제 무한 연장). store_transactions 에 동일
  // (portone, payment_id) 가 이미 있으면 만료를 재계산/연장하지 않고 멱등 처리한다.
  // 갱신 결제는 반드시 새 payment_id 로만 허용된다.
  const priorTxn = await db.execute({
    sql: `SELECT st.user_id AS txn_user_id, st.subscription_id,
                 s.plan_id, s.status, s.starts_at, s.expires_at
          FROM store_transactions st
          LEFT JOIN subscriptions s ON s.id = st.subscription_id
          WHERE st.provider = 'portone' AND st.provider_transaction_id = ?`,
    args: [parsed.payment_id],
  });
  if (priorTxn.rows.length > 0) {
    const row = priorTxn.rows[0]!;
    if (String(row.txn_user_id) !== userPk) {
      return c.json(
        {
          error: 'Payment belongs to another account',
          error_code: 'TRANSACTION_OWNED_BY_OTHER_USER',
        },
        409,
      );
    }
    return c.json({
      success: true,
      plan_key: plan.key,
      already_processed: true,
      subscription: row.subscription_id
        ? {
            id: String(row.subscription_id),
            plan_id: row.plan_id ? String(row.plan_id) : plan.id,
            plan_key: plan.key,
            status: row.status ? String(row.status) : 'active',
            starts_at: row.starts_at ? String(row.starts_at) : null,
            expires_at: row.expires_at ? String(row.expires_at) : null,
          }
        : null,
    });
  }

  // PortOne 결제 조회 (클라이언트 주장 무시).
  let payment: PortOnePayment;
  try {
    const res = await fetch(
      `https://api.portone.io/payments/${encodeURIComponent(parsed.payment_id)}`,
      { headers: { Authorization: `PortOne ${c.env.PORTONE_API_SECRET}` } },
    );
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      logStructured('warn', { at: 'billing.portone.complete', status: res.status, detail });
      const status = res.status === 404 ? 404 : 502;
      return c.json(
        {
          error: 'PortOne payment not found or verification failed',
          error_code:
            status === 404 ? 'PORTONE_PAYMENT_NOT_FOUND' : 'PORTONE_VERIFICATION_FAILED',
        },
        status,
      );
    }
    payment = (await res.json()) as PortOnePayment;
  } catch (err) {
    logStructured('error', { at: 'billing.portone.complete', error: String(err) });
    return c.json(
      { error: 'PortOne verification failed', error_code: 'PORTONE_VERIFICATION_FAILED' },
      502,
    );
  }

  if (payment.status !== 'PAID') {
    return c.json(
      {
        error: `Payment is not completed: ${payment.status ?? 'UNKNOWN'}`,
        error_code: 'PAYMENT_NOT_PAID',
      },
      400,
    );
  }
  if ((payment.currency ?? 'KRW') !== 'KRW') {
    return c.json({ error: 'Unsupported currency', error_code: 'CURRENCY_MISMATCH' }, 400);
  }
  if (Number(payment.amount?.total ?? 0) !== plan.price_krw) {
    return c.json(
      {
        error: 'Payment amount does not match plan price',
        error_code: 'AMOUNT_MISMATCH',
      },
      400,
    );
  }

  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + plan.period_days * 24 * 60 * 60 * 1000);

  const result = await withWriteTransaction(db, (txDb) =>
    applyStoreEntitlement(txDb, {
      userPk,
      provider: 'portone',
      providerTransactionId: parsed.payment_id,
      productId: `portone_${plan.key}`,
      plan,
      startsAt,
      expiresAt,
      rawPayload: JSON.stringify({ orderName: payment.orderName ?? null }),
    }),
  );

  if (!result.ok) {
    return c.json(
      { error: 'Payment belongs to another account', error_code: result.errorCode },
      result.status,
    );
  }

  return c.json({
    success: true,
    plan_key: plan.key,
    subscription: result.subscription,
  });
});

export default billingPortone;
