import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { jsonError } from '../lib/api-error';
import { personalPromoCoversFree } from '../lib/personal-promo';
import { redeemVoucherCode, VoucherRedemptionError } from '../lib/voucher-redemption';
import { isValidVoucherCodeFormat } from '../lib/vouchers';

const codeRoutes = new Hono<AppEnv>();

/** 입력 상한. 앱(`CodeRedeemField`·`InputSanitizer`)도 이 길이로 자른다 — 옛 앱과 맞춰 그대로 둔다. */
const MAX_CODE_LENGTH = 64;

/**
 * 코드 등록 — 받는 것은 **커플·가족 이용권 초대 코드(INV- 4-4-4) 하나뿐**이다. 주인이 스토어
 * 결제로 산 그룹 이용권에 합류한다. 응답 type 은 'voucher' 다(`lib/voucher-redemption.ts`).
 * 그 밖의 문자열은 전부 `CODE_NOT_FOUND` 다.
 *
 * ⚠ **선물 코드(GIFT- 4-4-4)는 2026-10-14 에 없앴다 — 되살리지 말 것.** iOS 1.2.12 가 App Store
 * 심사 지침 3.1.1 로 **두 번째** 반려됐다: "선물 코드로 디지털 기능을 연다". 선물은 보낸 사람이
 * 스토어 결제로 샀어도 **받는 사람은 코드를 쳐서** 유료 기능을 연다 — 애플이 막는 것은 결제 수단이
 * 아니라 그 '코드로 해제' 다. 1.2.11 반려 때 프로모 코드(사례)만 지우고 같은 종류를 남긴 것이 원인이다.
 * 발급 행이 `voucher_codes` 에 남아 있어도(이력이라 지우지 않는다) **조회하지 않고** 404 다 — 이미
 * 깔린 옛 앱(선물 문구가 남아 있다)으로도 못 연다. 초대 코드는 남긴다(오너 결정) — 그룹 주인이
 * 인앱 결제로 내고 있는 커플·가족 이용권의 자리에 합류하는 것이고, 애플도 문제 삼지 않았다.
 * 할인·무료 이용은 스토어 오퍼 코드(App Store 오퍼 코드·Play 프로모션 코드)로 준다.
 *
 * ⚠ **프로모 코드는 2026-10-12 에 없앴다 — 되살리지 말 것.** 운영자가 만든 코드로 유료 기능을
 * 여는 것이라 App Store 심사 지침 3.1.1(인앱 결제 외 수단으로 기능 해제 금지)에 걸려 iOS 1.2.11
 * 이 반려됐다. 앱 문구만 지우면 이미 깔린 옛 앱(문구에 '프로모션 코드' 가 남아 있다)으로는 계속
 * 열리므로 **서버가 받지 않는 것**이 실질 차단이다. 옛 경로 `POST /billing/promo/redeem` 도 같이
 * 지웠다. 발급·사용 기록(`promo_codes`·`promo_code_redemptions`)은 이력이라 남긴다. 이벤트 혜택이
 * 필요하면 스토어의 오퍼 코드(App Store 오퍼 코드·Play 프로모션 코드)를 쓴다 — 결제가 스토어를 거친다.
 * 상세: `docs/spec/plan-gates.md` 「코드 등록」.
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

  // 초대 코드 형식(INV- 4-4-4)이 아니면 조회할 곳이 없다. 예전에는 여기서 프로모 코드를 찾았고
  // GIFT- 선물 코드도 받았다 — 옛 앱이 그런 코드를 넣으면 없는 코드와 똑같이 `CODE_NOT_FOUND` 로
  // 답한다(위 ⚠ 두 개).
  if (!isValidVoucherCodeFormat(raw.toUpperCase())) {
    return jsonError(c, 404, 'CODE_NOT_FOUND', 'Code not found');
  }

  try {
    const result = await redeemVoucherCode(db, {
      userPk,
      rawCode: raw,
      promoCoversFree: personalPromoCoversFree(c.env),
    });
    return c.json(result);
  } catch (error) {
    if (!(error instanceof VoucherRedemptionError)) throw error;
    return c.json(
      { error: error.message, error_code: error.errorCode },
      error.status as 400 | 404 | 409,
    );
  }
});

export default codeRoutes;
