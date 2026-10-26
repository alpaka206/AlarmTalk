/**
 * **광고 시청 승인 세션**(`docs/spec/ad-rewards.md` §3) — 인증 라우트, `/api/ad-rewards/*`.
 *
 * 앱의 흐름: 사용자가 '광고 보고 한 번 더' 를 고른다 → `POST /sessions`(승인 id 발급·이번 달 자리 예약) → 광고를 불러와
 * SSV 옵션에 계정 PK 와 승인 id 를 싣는다 → 띄우기 직전 `POST /sessions/:id/start`(시작 승인) → 광고 화면이 닫히면
 * `POST /sessions/:id/close`(어떻게 끝났나) → `GET /tts/manual-quota` 로 보상 도착을 다시 본다.
 *
 * ⚠ 이 라우트들은 보상을 주지 않는다 — 적립은 서명된 SSV 콜백(`routes/ads.ts`)으로만 한다.
 * ⚠ `/api/ads/*` 아래에 두지 말 것 — 그 경로는 인증이 없는 콜백 전용이고 전용 IP 버킷(분당 6000)이 붙는다.
 */
import { Hono, type Context } from 'hono';
import { AdRewardSessionCloseSchema, AdRewardSessionCreateSchema } from '@alarmtalk/shared';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { jsonError } from '../lib/api-error';
import { logStructured } from '../lib/logger';
import { planWithGrantSql } from '../lib/plan-grant-sql';
import { resolvePersonalPromo } from '../lib/personal-promo';
import { nextManualQuotaResetAt } from '../lib/manual-tts-quota';
import { isConfiguredRewardedAdUnit } from '../lib/ad-reward-credits';
import { UUID_RE } from '../lib/validate';
import { hasPersonalVoiceAccess } from './billing-helpers';
import {
  adRewardViewingEnabled,
  closeAdRewardSession,
  prepareAdRewardSession,
  readAdRewardSession,
  releaseAdRewardSession,
  sessionView,
  startAdRewardSession,
} from '../lib/ad-reward-sessions';

const adRewardSessions = new Hono<AppEnv>();

/** 광고 단위 전체 id(`ca-app-pub-…/123`)의 뒤 숫자 — SSV 콜백의 `ad_unit` 은 이 꼴로 온다. */
function adUnitTail(adUnit: string): string {
  const slash = adUnit.lastIndexOf('/');
  return slash >= 0 ? adUnit.slice(slash + 1) : adUnit;
}

async function callerIsFree(c: Context<AppEnv>, userPk: string): Promise<boolean> {
  const res = await getDB(c.env).execute({
    sql: `SELECT ${planWithGrantSql('users')} AS plan FROM users WHERE id = ? AND deletion_status = 'active' LIMIT 1`,
    args: [userPk],
  });
  const row = res.rows[0];
  if (!row) return false;
  return !hasPersonalVoiceAccess(row.plan == null ? null : String(row.plan), resolvePersonalPromo(c.env));
}

async function readJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

// 새 세션 — 신규 시청 허용(운영 스위치)·이 광고 단위·무료 계정·월 자리·열린 세션 없음을 본다.
adRewardSessions.post('/sessions', async (c) => {
  const userPk = c.get('userIdPK') || c.get('userId');
  const raw = await readJson(c);
  if (raw === undefined) return jsonError(c, 400, 'INVALID_JSON', 'Invalid JSON body');
  const parsed = AdRewardSessionCreateSchema.safeParse(raw);
  if (!parsed.success) return jsonError(c, 400, 'INVALID_REQUEST', 'platform and ad_unit are required.');

  if (!adRewardViewingEnabled(c.env)) {
    return jsonError(c, 409, 'AD_REWARD_UNAVAILABLE', 'Rewarded ads are not available right now.', {
      reason: 'disabled',
    });
  }
  // 이 앱 빌드의 광고 단위가 서버 허용 목록에 있어야 콜백이 적립된다 — 없으면 보고도 못 받는 광고다.
  if (!isConfiguredRewardedAdUnit(c.env.ADMOB_REWARDED_AD_UNITS, adUnitTail(parsed.data.ad_unit))) {
    return jsonError(c, 409, 'AD_REWARD_UNAVAILABLE', 'This ad unit is not configured.', { reason: 'ad_unit' });
  }
  if (!(await callerIsFree(c, userPk))) {
    // 플러스·체험·관리자 지급 — 월 30회 규칙을 쓴다. 광고를 권하지 않는다.
    return jsonError(c, 409, 'AD_REWARD_UNAVAILABLE', 'Rewarded ads are for the free plan.', { reason: 'plan' });
  }

  const db = getDB(c.env);
  const result = await prepareAdRewardSession(db, {
    userPk,
    platform: parsed.data.platform,
    adUnit: parsed.data.ad_unit,
  });
  if (!result.ok) {
    logStructured('info', { at: 'ad_reward_session', step: 'prepare', refused: result.reason });
    if (result.reason === 'monthly_limit') {
      return jsonError(c, 409, 'AD_REWARD_MONTHLY_LIMIT', 'This month’s ad rewards are used up.', {
        next_grant_at: nextManualQuotaResetAt(),
      });
    }
    return jsonError(c, 409, 'AD_REWARD_SESSION_OPEN', 'Another ad is being prepared or watched.');
  }
  logStructured('info', { at: 'ad_reward_session', step: 'prepare', platform: parsed.data.platform });
  return c.json(
    {
      session: sessionView(result.session),
      // 광고의 SSV 옵션에 싣는 두 값 — `userId` 는 계정 PK, `customData` 는 승인 id.
      ssv: { user_id: userPk, custom_data: result.session.id },
    },
    201,
  );
});

// 표시 직전의 시작 승인 — 그 사이 자격(무료·스위치)이 바뀌었으면 예약을 풀고 거절한다.
adRewardSessions.post('/sessions/:id/start', async (c) => {
  const userPk = c.get('userIdPK') || c.get('userId');
  const sessionId = c.req.param('id');
  if (!UUID_RE.test(sessionId)) return jsonError(c, 404, 'AD_REWARD_SESSION_INVALID', 'Unknown session.');
  const db = getDB(c.env);

  if (!adRewardViewingEnabled(c.env) || !(await callerIsFree(c, userPk))) {
    await releaseAdRewardSession(db, sessionId, userPk, 'not_eligible');
    return jsonError(c, 409, 'AD_REWARD_UNAVAILABLE', 'Rewarded ads are not available right now.', {
      reason: adRewardViewingEnabled(c.env) ? 'plan' : 'disabled',
    });
  }
  const result = await startAdRewardSession(db, { sessionId, userPk });
  if (!result.ok) {
    logStructured('info', { at: 'ad_reward_session', step: 'start', refused: result.reason });
    if (result.reason === 'monthly_limit') {
      return jsonError(c, 409, 'AD_REWARD_MONTHLY_LIMIT', 'This month’s ad rewards are used up.', {
        next_grant_at: nextManualQuotaResetAt(),
      });
    }
    return jsonError(
      c,
      result.reason === 'not_found' ? 404 : 409,
      'AD_REWARD_SESSION_INVALID',
      'This ad session can no longer start.',
      { reason: result.reason },
    );
  }
  return c.json({ session: sessionView(result.session) });
});

// 광고 화면이 어떻게 끝났나 — 잠금·예약만 정리한다. 같은 요청을 다시 보내도 된다.
adRewardSessions.post('/sessions/:id/close', async (c) => {
  const userPk = c.get('userIdPK') || c.get('userId');
  const sessionId = c.req.param('id');
  if (!UUID_RE.test(sessionId)) return jsonError(c, 404, 'AD_REWARD_SESSION_INVALID', 'Unknown session.');
  const raw = await readJson(c);
  if (raw === undefined) return jsonError(c, 400, 'INVALID_JSON', 'Invalid JSON body');
  const parsed = AdRewardSessionCloseSchema.safeParse(raw);
  if (!parsed.success) return jsonError(c, 400, 'INVALID_REQUEST', 'outcome is required.');
  const session = await closeAdRewardSession(getDB(c.env), {
    sessionId,
    userPk,
    outcome: parsed.data.outcome,
  });
  if (!session) return jsonError(c, 404, 'AD_REWARD_SESSION_INVALID', 'Unknown session.');
  logStructured('info', {
    at: 'ad_reward_session',
    step: 'close',
    outcome: parsed.data.outcome,
    status: session.status,
  });
  return c.json({ session: sessionView(session) });
});

// 세션 하나의 지금 상태 — 앱이 정산을 다시 볼 때.
adRewardSessions.get('/sessions/:id', async (c) => {
  const userPk = c.get('userIdPK') || c.get('userId');
  const sessionId = c.req.param('id');
  if (!UUID_RE.test(sessionId)) return jsonError(c, 404, 'AD_REWARD_SESSION_INVALID', 'Unknown session.');
  const session = await readAdRewardSession(getDB(c.env), sessionId, userPk);
  if (!session) return jsonError(c, 404, 'AD_REWARD_SESSION_INVALID', 'Unknown session.');
  return c.json({ session: sessionView(session) });
});

export default adRewardSessions;
