import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { redeemVoucherCode, VoucherRedemptionError } from '../lib/voucher-redemption';
import { isValidVoucherCodeFormat } from '../lib/vouchers';
import { redeemPromoCode, PromoRedemptionError } from '../lib/promo-redemption';

const codeRoutes = new Hono<AppEnv>();

/** 프로모 코드 실제 상한(admin 발급 폼 maxlength=64)과 같은 값. 클라도 이 길이로 자른다. */
const MAX_CODE_LENGTH = 64;

/**
 * 통합 코드 등록 — 클라이언트는 코드 종류를 몰라도 된다. 입력 하나를 받아
 * 아래 순서로 판별·처리한다:
 *   1) INV-/GIFT- 4-4-4 → 이용권(voucher, 해시 조회)
 *   2) 그 외 자유 문자열(예: PROMO_EXAMPLE) 또는 위에서 못 찾은 코드 → 프로모 쿠폰(대소문자 무시)
 * 응답 type: 'invite' | 'gift'(voucher) | 'promo'.
 *
 * 가족 합류는 이용권(INV- voucher)으로 일원화됐다 — 별도 초대권(plan_group_invites)
 * 생성 경로가 앱에서 사라져 생산자가 없었고, 테이블은 #83 에서 제거됐다.
 */
codeRoutes.post('/register', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const body = await c.req.json<{ code?: unknown }>().catch(() => ({ code: undefined }));
  const raw = typeof body.code === 'string' ? body.code.trim() : '';
  if (!raw) {
    return c.json({ error: 'code is required', error_code: 'CODE_REQUIRED' }, 400);
  }
  // **길이 상한은 서버에도 있어야 한다.** 클라(CodeRedeemField)가 64자로 자르지만 그건
  // 앱을 거칠 때만이다 — 직접 호출하면 몇 MB 짜리 문자열이 아래 조회·쓰기 트랜잭션까지
  // 그대로 흘러간다. 프로모 코드의 실제 상한(admin 발급 폼 maxlength=64)과 맞춘다.
  if (raw.length > MAX_CODE_LENGTH) {
    return c.json({ error: 'code is too long', error_code: 'CODE_TOO_LONG' }, 400);
  }

  const userRes = await db.execute({
    sql: 'SELECT id FROM users WHERE id = ?',
    args: [userId],
  });
  if (userRes.rows.length === 0) {
    return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
  }
  const userPk = String(userRes.rows[0]!.id);

  const upper = raw.toUpperCase();

  // 1) 이용권(voucher) — INV-/GIFT- 4-4-4 포맷일 때만 시도.
  if (isValidVoucherCodeFormat(upper)) {
    try {
      const result = await redeemVoucherCode(db, { userPk, rawCode: raw });
      return c.json(result);
    } catch (error) {
      if (!(error instanceof VoucherRedemptionError)) throw error;
      // voucher 에 없는(CODE_NOT_FOUND) 코드만 다음 단계로 폴백한다: INV- 는 가족 초대(2단계)로,
      // 그 외(GIFT- 형식과 겹치는 프로모 코드 등)는 프로모(3단계)로 넘어간다. 만료/중복 같은
      // 확정 오류는 그대로 반환한다.
      if (error.errorCode !== 'CODE_NOT_FOUND') {
        return c.json(
          { error: error.message, error_code: error.errorCode },
          error.status as 400 | 404 | 409,
        );
      }
    }
  }

  // 2) 프로모 쿠폰 — 자유 문자열, 대소문자 무시. 여기서도 없으면 최종 CODE_NOT_FOUND.
  try {
    const result = await redeemPromoCode(db, { userPk, rawCode: raw });
    return c.json(result);
  } catch (error) {
    if (error instanceof PromoRedemptionError) {
      return c.json(
        { error: error.message, error_code: error.errorCode },
        error.status as 400 | 404 | 409,
      );
    }
    throw error;
  }
});

export default codeRoutes;
