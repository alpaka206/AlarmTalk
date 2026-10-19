import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { jsonError } from '../lib/api-error';
import { logStructured } from '../lib/logger';
import { UUID_RE } from '../lib/validate';
import { verifyAdMobCallback } from '../lib/admob-ssv';
import { grantAdRewardCredit, isConfiguredRewardedAdUnit } from '../lib/ad-reward-credits';

// MARK: - GET /api/ads/admob-ssv  (공개 라우트, 사용자 인증 없음)
//
// AdMob 보상형 광고의 서버 측 확인(SSV) 콜백. 사용자가 광고를 끝까지 보면 **AdMob 서버가** 이 주소를 서명된
// 쿼리로 부른다. 인증은 사용자 JWT 가 아니라 그 서명이다(`lib/admob-ssv.ts`). 스펙: `docs/spec/ad-rewards.md`.
//
// 응답 규칙 — AdMob 은 200 이 아니면 다시 부른다:
// - 서명이 틀렸다 → 403. AdMob 이 보낸 것이 아니므로 다시 와도 같다.
// - 서명은 맞는데 적립할 수 없다(모르는 광고 단위·없는 계정·월 상한·이미 받은 거래) → **200**. 다시 불러도
//   답이 같으니 재시도를 멈추게 한다. AdMob 콘솔의 '확인 URL' 시험 호출(계정 없음)도 여기로 온다.
// - 키 목록을 못 받았다·DB 가 실패했다 → 던져서 5xx. 우리 쪽 장애라 AdMob 이 나중에 다시 부르면 적립된다.
const ads = new Hono<AppEnv>();

ads.get('/admob-ssv', async (c) => {
  const rawQuery = new URL(c.req.url).search.replace(/^\?/, '');
  const callback = await verifyAdMobCallback(rawQuery);
  if (!callback) {
    return jsonError(c, 403, 'AD_REWARD_SIGNATURE_INVALID', 'Invalid reward callback signature.');
  }

  const skip = (reason: string) => {
    logStructured('info', { at: 'ad_reward', granted: false, reason, ad_unit: callback.adUnit });
    return c.json({ granted: false }, 200);
  };

  if (!isConfiguredRewardedAdUnit(c.env.ADMOB_REWARDED_AD_UNITS, callback.adUnit))
    return skip('ad_unit');
  if (!callback.transactionId || callback.transactionId.length > 128) return skip('transaction');
  // 앱이 `ServerSideVerificationOptions.userId` 로 싣는 값은 `GET /tts/manual-quota` 가 준 계정 PK 다.
  if (!UUID_RE.test(callback.userId)) return skip('user');

  const db = getDB(c.env);
  const user = await db.execute({
    sql: `SELECT 1 FROM users WHERE id = ? AND deletion_status = 'active' LIMIT 1`,
    args: [callback.userId],
  });
  if (user.rows.length === 0) return skip('user');

  const granted = await grantAdRewardCredit(db, {
    transactionId: callback.transactionId,
    userPk: callback.userId,
    adUnit: callback.adUnit,
  });
  logStructured('info', {
    at: 'ad_reward',
    granted,
    reason: granted ? 'granted' : 'duplicate_or_monthly_limit',
    ad_unit: callback.adUnit,
    uid: callback.userId,
  });
  return c.json({ granted }, 200);
});

export default ads;
