import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { jsonError } from '../lib/api-error';
import { logStructured } from '../lib/logger';
import { AdMobKeysBusyError, verifyAdMobCallback } from '../lib/admob-ssv';
import { isConfiguredRewardedAdUnit } from '../lib/ad-reward-credits';
import { recordAdRewardCallback, settleAdRewardCallback } from '../lib/ad-reward-sessions';

// MARK: - GET /api/ads/admob-ssv  (공개 라우트, 사용자 인증 없음)
//
// AdMob 보상형 광고의 서버 측 확인(SSV) 콜백. 사용자가 광고를 끝까지 보면 **AdMob 서버가** 이 주소를 서명된
// 쿼리로 부른다. 인증은 사용자 JWT 가 아니라 그 서명이다(`lib/admob-ssv.ts`). 스펙: `docs/spec/ad-rewards.md` §3.
//
// 응답 규칙 — AdMob 은 200 이 아니면 다시 부른다:
// - 서명이 틀렸다 → 403. AdMob 이 보낸 것이 아니므로 다시 와도 같다.
// - 서명은 맞는데 받을 수 없는 형식(설정에 없는 광고 단위·빈 거래 id·계정 칸이 이상함) → 적지 않고 **200**. AdMob 콘솔의
//   '확인 URL' 시험 호출(계정 없음)도 여기로 온다.
// - 그 밖은 **먼저 적는다**(`ad_reward_callbacks`) — 적은 뒤에만 200 이다. 정산(적립)은 그 뒤에 하고, 정산이 실패해도
//   200 이다: 기록이 남았으니 cron 이 다시 정산한다(`retryUnsettledAdRewardCallbacks`). AdMob 의 재전송(1초 간격 다섯 번)에
//   기대지 않는다. 적지 못했으면(DB 실패·키 목록 실패) 던져서 5xx — 그때는 AdMob 의 재전송이 유일한 기회다.
// ⚠ 광고 신규 시청 스위치(`ADMOB_REWARDED_ADS_ENABLED`)는 **여기서 보지 않는다** — 이미 승인한 시청의 정산은 꺼도 계속한다.
//   광고 단위 허용 목록(`ADMOB_REWARDED_AD_UNITS`)만 본다.
const ads = new Hono<AppEnv>();

ads.get('/admob-ssv', async (c) => {
  const rawQuery = new URL(c.req.url).search.replace(/^\?/, '');
  let callback: Awaited<ReturnType<typeof verifyAdMobCallback>>;
  try {
    callback = await verifyAdMobCallback(rawQuery);
  } catch (err) {
    // 다른 콜백이 방금 키 목록을 다시 받았다 — 1초 뒤 AdMob 의 재시도에서 받힌다. 5xx 가 아니라 경보도 없다.
    if (err instanceof AdMobKeysBusyError) {
      return jsonError(c, 429, 'AD_REWARD_RETRY_LATER', 'Retry the reward callback shortly.');
    }
    throw err;
  }
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
  // 앱이 `ServerSideVerificationOptions.userId` 로 싣는 값은 승인 세션이 준 계정 PK 다.
  // ⚠ UUID 로 좁히지 말 것(코덱스 #924) — UUID 전환 전에 가입한 구글 계정은 PK 가 구글 sub 그대로다(`routes/auth.ts`).
  //   형식은 길이·문자만 묶고, 실재는 정산이 본다.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(callback.userId)) return skip('user');
  if (callback.customData.length > 128) return skip('custom_data');

  const db = getDB(c.env);
  const nowMs = Date.now();
  const { settledOutcome } = await recordAdRewardCallback(db, callback, nowMs);
  let outcome = settledOutcome;
  if (outcome === null) {
    try {
      outcome = await settleAdRewardCallback(db, c.env, callback.transactionId, nowMs);
    } catch (err) {
      // 기록은 남았다 — cron 이 다시 정산한다. AdMob 에는 받았다고 답한다.
      console.error('[ads/admob-ssv] settle failed; will retry from cron', err);
      logStructured('warn', { at: 'ad_reward', granted: false, reason: 'settle_deferred', ad_unit: callback.adUnit });
      return c.json({ granted: false, deferred: true }, 200);
    }
  }
  const granted = outcome === 'granted';
  logStructured('info', {
    at: 'ad_reward',
    granted,
    reason: outcome,
    ad_unit: callback.adUnit,
    uid: callback.userId,
    session: callback.customData ? 'approved' : 'legacy',
  });
  return c.json({ granted }, 200);
});

export default ads;
