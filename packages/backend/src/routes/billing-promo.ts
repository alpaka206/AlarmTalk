import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { logRouteError } from '../lib/logger';
import { resolveUserPk } from './billing-helpers';
import { redeemPromoCode, PromoRedemptionError } from '../lib/promo-redemption';

// MARK: - POST /billing/promo/redeem (공용 프로모 쿠폰 사용)
//
// 관리자가 발급한 프로모 코드(예: PROMO_EXAMPLE — 실코드명은 소스에 두지 않는다)를 사용자가 등록하면 지정 플랜을
// duration_days 만큼 부여한다. 코드 발급/관리는 /admin/promo (ADMIN_SECRET 보호).

const billingPromo = new Hono<AppEnv>();

billingPromo.post('/promo/redeem', async (c) => {
  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }

  const body = await c.req.json<{ code?: unknown }>().catch(() => ({ code: undefined }));
  const rawCode = typeof body.code === 'string' ? body.code.trim() : '';
  if (!rawCode) {
    return c.json({ error: 'code is required', error_code: 'CODE_REQUIRED' }, 400);
  }

  try {
    const result = await redeemPromoCode(getDB(c.env), { userPk, rawCode });
    return c.json(result);
  } catch (err) {
    if (err instanceof PromoRedemptionError) {
      return c.json(
        { error: err.message, error_code: err.errorCode },
        err.status as 400 | 404 | 409,
      );
    }
    logRouteError(c, err);
    return c.json({ error: 'Failed to redeem promo code', error_code: 'PROMO_REDEEM_FAILED' }, 500);
  }
});

export default billingPromo;
