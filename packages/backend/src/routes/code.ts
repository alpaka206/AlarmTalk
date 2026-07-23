import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { redeemVoucherCode, VoucherRedemptionError } from '../lib/voucher-redemption';
import { isValidVoucherCodeFormat } from '../lib/vouchers';
import { normalizeInviteCode, isValidInviteCodeFormat } from '../lib/invites';
import { acceptFamilyInvite, FamilyInviteAcceptError } from '../lib/family-invite-accept';
import { redeemPromoCode, PromoRedemptionError } from '../lib/promo-redemption';

const codeRoutes = new Hono<AppEnv>();

/**
 * 통합 코드 등록 — 클라이언트는 코드 종류를 몰라도 된다. 입력 하나를 받아
 * 아래 순서로 판별·처리한다:
 *   1) INV-/GIFT- 4-4-4 → 이용권(voucher, 해시 조회)
 *   2) INV- 계열이 voucher 에 없으면 → 가족 그룹 초대(plan_group_invites, 평문·레거시 포맷 포함)
 *   3) 그 외 자유 문자열(예: PROMO_EXAMPLE) 또는 위에서 못 찾은 코드 → 프로모 쿠폰(대소문자 무시)
 * 응답 type: 'invite' | 'gift'(voucher) | 'group_invite' | 'promo'.
 */
codeRoutes.post('/register', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const body = await c.req.json<{ code?: unknown }>().catch(() => ({ code: undefined }));
  const raw = typeof body.code === 'string' ? body.code.trim() : '';
  if (!raw) {
    return c.json({ error: 'code is required', error_code: 'CODE_REQUIRED' }, 400);
  }

  const userRes = await db.execute({
    sql: 'SELECT id FROM users WHERE google_id = ?',
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

  // 2) 가족 그룹 초대 — 신형 INV-XXXX-XXXX-XXXX + 레거시(INV-NNNNNN, NNNNNN).
  const inviteCode = normalizeInviteCode(raw);
  if (isValidInviteCodeFormat(inviteCode)) {
    try {
      const result = await acceptFamilyInvite(db, { userPk, code: inviteCode });
      return c.json({ success: true, type: 'group_invite', ...result });
    } catch (error) {
      if (!(error instanceof FamilyInviteAcceptError)) throw error;
      // 초대에도 없으면 마지막으로 프로모 코드까지 조회해 본다(아래 3단계).
      if (error.errorCode !== 'INVITE_NOT_FOUND') {
        return c.json(
          { error: error.message, error_code: error.errorCode },
          error.status as 400 | 404 | 409,
        );
      }
    }
  }

  // 3) 프로모 쿠폰 — 자유 문자열, 대소문자 무시. 여기서도 없으면 최종 CODE_NOT_FOUND.
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
