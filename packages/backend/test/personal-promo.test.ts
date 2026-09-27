// 기간 한정 개인 플랜 — `docs/spec/billing-lifecycle.md` 「기간 한정 개인 플랜」.
//
// 실제 libsql 파일 DB 에 전체 마이그레이션을 올리고 실제 라우트를 부른다. 지키는 것:
//   1. 스위치·리허설 값 해석(꺼짐 = fail-closed, production 은 리허설 끝을 읽지 않는다)과
//      prod 설정 잠금(wrangler.toml·시크릿 동기화).
//   2. **계산값 자리마다 끝 1초 전(열림) / 끝 시각(닫힘)** — 원시 free 가 통과했다가 거절된다.
//      원시 유료는 양쪽 다 그대로다. 경계는 **운영 상수 그대로**(production 모드)로 잰다.
//   3. 결제 보류 그룹 — 소유자 본인의 개인 기능은 열리고, **공유 목소리(생성·알람 저장·오디오)와
//      보낸 알람은 원시값이라 닫힌다**(`messageBelongsToCaller` ↔ 오디오 라우트, `/tts/generate` ↔
//      `voiceProfileBelongsToCaller` 가 같은 답). 살아 있는 그룹의 공유는 그대로 열린다.
//   4. 직접 입력 한도 30 → 0, `/billing/subscription` 의 계산값·`personal_promo`
//      (`deletes_voices_at_end`·`computed_at` 포함).
//   5. 기간 중 쿠폰 등록이 되고, 그 구독이 기간 중 끝나도 보관이 걸리지 않는다.
//   6. 종료 전환 — 대상만·묶음·멱등·`delete_after` 는 끝 + 3일(더 이르지 않다), 기간 중 스윕은
//      풀어만 준다.
//      (대량·예산·굶김은 `test/personal-promo-end.test.ts`.)
//   7. 보류 주인의 공유 목소리 — 알람 PATCH 는 `voice_profile_id` 가 **바뀔 때만** 소유권을 본다(D8):
//      그대로 보내는 토글은 통과, 그 목소리로 바꾸는 PATCH 는 POST 처럼 404.
//
// ⚠ 시계는 **JS `Date` 만** 가짜로 돌린다(`toFake: ['Date']`). SQL 의 `datetime('now')` 는 실제
//   시각이라, 여기 픽스처의 구독 만료는 실제·가짜 시각 어느 쪽으로 봐도 같은 쪽에 오게 둔다.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PERSONAL_PROMO } from '@alarmtalk/shared';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

let db: Client;
vi.mock('../src/lib/db', () => ({ getDB: () => db }));

const { default: voiceProfile, replaceVoiceInPlace } = await import('../src/routes/voice-profile');
const { default: voiceUpload } = await import('../src/routes/voice-upload');
const { default: tts } = await import('../src/routes/tts');
const { default: alarmMutation } = await import('../src/routes/alarm-mutation');
const { default: billingQuery } = await import('../src/routes/billing-query');
const { default: codeRoutes } = await import('../src/routes/code');
const { resolvePersonalPromo, resolvePersonalPromoWindow, personalPromoField, computedUserPlan } =
  await import('../src/lib/personal-promo');
const { hasPersonalVoiceAccess, isPaidVoicePlan } = await import('../src/routes/billing-helpers');
const { processSubscriptionExpiry, sweepPaidVoiceRetention } =
  await import('../src/lib/billing-cancel');
const { transitionPersonalPromoEnd, runPersonalPromoEnd, promoEndDeleteAfter } =
  await import('../src/lib/personal-promo-end');
const { selectWorkerSecrets, DEV_ONLY_SECRET_KEYS, WORKER_SECRET_KEYS } =
  await import('../scripts/worker-secret-keys');

const DIR = mkdtempSync(join(tmpdir(), 'alarmtalk-personal-promo-'));
async function freshDb(name: string): Promise<Client> {
  const client = createClient({ url: `file:${join(DIR, `${name}.db`)}` });
  await runMigrations(client);
  return client;
}

const END = new Date(PERSONAL_PROMO.endsAt);
const PERSONAL = '70000000-0000-4000-8000-000000000002';
const FAMILY = '70000000-0000-4000-8000-000000000003';

const BASE_ENV = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
} as const;

/**
 * 운영과 **같은 모양**: production 이고 시작 스위치만 켜져 있다 — 끝은 shared 상수다.
 * 리허설 끝을 일부러 과거로 넣어 둔다(production 이 그걸 읽으면 경계 테스트가 전부 닫힘으로
 * 뒤집혀 드러난다).
 */
const PROD_ENV = {
  ...BASE_ENV,
  ENVIRONMENT: 'production',
  PERSONAL_PROMO_STARTS_AT: '2026-10-01T00:00:00+09:00',
  PERSONAL_PROMO_ENDS_AT: '2020-01-01T00:00:00Z',
} as unknown as Env;

const MOMENTS = [
  { name: '끝 1초 전', at: new Date(END.getTime() - 1000), open: true },
  { name: '끝 시각', at: END, open: false },
] as const;

function atMoment(at: Date) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
}

afterEach(() => {
  vi.useRealTimers();
});

type Caller = { pk: string; login?: string };
function appFor(user: Caller) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', user.pk);
    c.set('userIdPK', user.pk);
    c.set('userLoginId', user.login ?? user.pk);
    await next();
  });
  app.route('/voice', voiceProfile);
  app.route('/voice', voiceUpload);
  app.route('/tts', tts);
  app.route('/alarms', alarmMutation);
  app.route('/billing', billingQuery);
  app.route('/code', codeRoutes);
  return app;
}

async function call(
  user: Caller,
  method: string,
  path: string,
  body?: Record<string, unknown> | FormData,
  env: Env = PROD_ENV,
) {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await appFor(user).request(
    new Request(`http://localhost${path}`, init),
    undefined,
    env,
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: json };
}

function kstHHmm(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('스위치 해석 — 꺼짐은 fail-closed, production 은 리허설 끝을 읽지 않는다', () => {
  const NOW = new Date(END.getTime() - 60_000);

  it('시작이 없음·빈 값·해석 불가·시간대 없음이면 꺼짐', () => {
    for (const starts of [undefined, '', '   ', 'soon', '2026-10-01', '2026-10-01T00:00:00']) {
      expect(resolvePersonalPromoWindow({ PERSONAL_PROMO_STARTS_AT: starts })).toBeNull();
      expect(resolvePersonalPromo({ PERSONAL_PROMO_STARTS_AT: starts }, NOW).active).toBe(false);
    }
    expect(resolvePersonalPromoWindow(undefined)).toBeNull();
  });

  it('시작만 있으면 끝은 shared 상수다', () => {
    const w = resolvePersonalPromoWindow({ PERSONAL_PROMO_STARTS_AT: '2026-10-01T00:00:00+09:00' });
    expect(w?.startsAt.toISOString()).toBe('2026-09-30T15:00:00.000Z');
    expect(w?.endsAt.toISOString()).toBe('2026-10-31T15:00:00.000Z');
  });

  it('dev·테스트는 리허설 끝으로 덮어쓰고, production 은 무시한다', () => {
    const env = {
      PERSONAL_PROMO_STARTS_AT: '2026-01-01T00:00:00Z',
      PERSONAL_PROMO_ENDS_AT: '2026-02-01T00:00:00Z',
    };
    expect(
      resolvePersonalPromoWindow({ ...env, ENVIRONMENT: 'development' })?.endsAt.toISOString(),
    ).toBe('2026-02-01T00:00:00.000Z');
    expect(
      resolvePersonalPromoWindow({ ...env, ENVIRONMENT: 'production' })?.endsAt.toISOString(),
    ).toBe(END.toISOString());
  });

  it('리허설 끝이 해석 불가거나 시작이 끝보다 늦지 않으면 꺼짐', () => {
    expect(
      resolvePersonalPromoWindow({
        ENVIRONMENT: 'development',
        PERSONAL_PROMO_STARTS_AT: '2026-01-01T00:00:00Z',
        PERSONAL_PROMO_ENDS_AT: 'tomorrow',
      }),
    ).toBeNull();
    expect(
      resolvePersonalPromoWindow({
        ENVIRONMENT: 'production',
        PERSONAL_PROMO_STARTS_AT: '2026-10-31T15:00:00Z',
      }),
    ).toBeNull();
  });

  it('끝 1초 전은 활성, 끝 시각은 비활성 — 운영 상수 그대로', () => {
    expect(resolvePersonalPromo(PROD_ENV, new Date(END.getTime() - 1000)).active).toBe(true);
    expect(resolvePersonalPromo(PROD_ENV, END).active).toBe(false);
  });

  it('계산값과 응답 조각 — 원시 free 만, 초 단위 UTC', () => {
    const on = resolvePersonalPromo(PROD_ENV, new Date(END.getTime() - 1000));
    const off = resolvePersonalPromo(PROD_ENV, END);
    expect(computedUserPlan('free', on)).toBe('plus');
    expect(computedUserPlan('free', off)).toBe('free');
    expect(computedUserPlan('family', on)).toBe('family');
    expect(computedUserPlan(null, on)).toBeNull();
    const noRow = { hasActiveSubscriptionRow: false };
    // `computed_at` = 계산에 쓴 서버 시각(초 단위로 내림) — 앱의 낡은 캐시 판정(D1·D7)이 받은
    // 시각으로 쓴다. 조각은 구간 안에서만 실리므로 언제나 `ends_at` 보다 이르다.
    expect(personalPromoField('free', on, noRow)).toEqual({
      ends_at: '2026-10-31T15:00:00Z',
      notice_from: '2026-10-24T15:00:00Z',
      deletes_voices_at_end: true,
      computed_at: '2026-10-31T14:59:59Z',
    });
    // 결제 보류(원시 free + active 행): 값은 남고 삭제 문장만 빠진다.
    expect(personalPromoField('free', on, { hasActiveSubscriptionRow: true })).toEqual({
      ends_at: '2026-10-31T15:00:00Z',
      notice_from: '2026-10-24T15:00:00Z',
      deletes_voices_at_end: false,
      computed_at: '2026-10-31T14:59:59Z',
    });
    // 소수 초는 올리지 않고 버린다 — 끝 1ms 전에 계산한 답이 끝 시각으로 찍히지 않는다.
    const lastMs = resolvePersonalPromo(PROD_ENV, new Date(END.getTime() - 1));
    expect(personalPromoField('free', lastMs, noRow)?.computed_at).toBe('2026-10-31T14:59:59Z');
    expect(personalPromoField('plus', on, noRow)).toBeNull();
    expect(personalPromoField('free', off, noRow)).toBeNull();
    expect(hasPersonalVoiceAccess('free', on)).toBe(true);
    expect(hasPersonalVoiceAccess('free', off)).toBe(false);
    expect(hasPersonalVoiceAccess(null, on)).toBe(false);
    // 원시 판정은 프로모를 모른다(커플·가족 갈래).
    expect(isPaidVoicePlan('free')).toBe(false);
  });
});

describe('prod 설정 잠금 — 리허설 끝은 운영에 올라가지 않는다', () => {
  it('wrangler.toml 의 production 설정에 리허설 끝이 없다', () => {
    const toml = readFileSync(join(__dirname, '../wrangler.toml'), 'utf-8');
    const prod = toml.slice(toml.indexOf('[env.production]'));
    expect(prod).not.toContain('PERSONAL_PROMO_ENDS_AT');
  });

  it('시크릿 동기화: production 파일에 리허설 끝이 있으면 거절, 시작 스위치는 올린다', () => {
    expect(() =>
      selectWorkerSecrets('production', {
        PERSONAL_PROMO_STARTS_AT: '2026-10-05T00:00:00+09:00',
        PERSONAL_PROMO_ENDS_AT: '2026-10-06T00:00:00+09:00',
      }),
    ).toThrow(/PERSONAL_PROMO_ENDS_AT/);
    expect(
      selectWorkerSecrets('production', { PERSONAL_PROMO_STARTS_AT: '2026-10-05T00:00:00+09:00' }),
    ).toEqual({ PERSONAL_PROMO_STARTS_AT: '2026-10-05T00:00:00+09:00' });
    expect(
      selectWorkerSecrets('dev', { PERSONAL_PROMO_ENDS_AT: '2026-10-06T00:00:00+09:00' }),
    ).toEqual({ PERSONAL_PROMO_ENDS_AT: '2026-10-06T00:00:00+09:00' });
    expect(WORKER_SECRET_KEYS as readonly string[]).not.toContain('PERSONAL_PROMO_ENDS_AT');
    expect(DEV_ONLY_SECRET_KEYS as readonly string[]).toContain('PERSONAL_PROMO_ENDS_AT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 게이트 픽스처 — 한 DB 를 두 시점이 같이 쓴다(열림 시점이 만든 알람은 닫힘 시점과 무관하다).
const FREE = { pk: 'pp-free' };
/** 공식 목소리가 아직 없는 원시 free — 승격이 한도(1개)에 걸리지 않는다. */
const FREE_NEW = { pk: 'pp-free-new' };
const PAID = { pk: 'pp-paid' };
const HOLD_OWNER = { pk: 'pp-hold-owner' };
const HOLD_MEMBER = { pk: 'pp-hold-member' };
/** 보류 그룹에 남아 있지만 **따로** 개인 결제를 하는 멤버 — 원시 유료. */
const HOLD_PAID_MEMBER = { pk: 'pp-hold-paid-member' };
/** 결제가 살아 있는 가족 그룹 — 공유 목소리가 그대로 열려야 한다(원시 게이트의 대조군). */
const LIVE_MEMBER = { pk: 'pp-live-member' };
const COUPON_USER = { pk: 'pp-coupon' };
const VP_FREE = '11111111-1111-4111-8111-000000000001';
const VP_FREE_DRAFT = '11111111-1111-4111-8111-000000000002';
const VP_FREE_NEW_DRAFT = '11111111-1111-4111-8111-000000000005';
const VP_PAID = '11111111-1111-4111-8111-000000000003';
const VP_HOLD = '11111111-1111-4111-8111-000000000004';
const MSG_FREE = '22222222-2222-4222-8222-000000000001';
const MSG_PAID = '22222222-2222-4222-8222-000000000002';
const MSG_HOLD_PRESET = '22222222-2222-4222-8222-000000000003';
const MSG_HOLD_OWN = '22222222-2222-4222-8222-000000000004';
const VP_LIVE = '11111111-1111-4111-8111-000000000006';
const MSG_LIVE_PRESET = '22222222-2222-4222-8222-000000000005';

describe('계산값 자리 — 끝 1초 전 열림 / 끝 시각 닫힘', () => {
  beforeAll(async () => {
    db = await freshDb('gates');
    await db.batch([
      `INSERT INTO users (id, google_id, email, name, plan) VALUES ('pp-free', NULL, 'free@t.test', '무료', 'free')`,
      `INSERT INTO users (id, google_id, email, name, plan) VALUES ('pp-free-new', NULL, 'new@t.test', '신규', 'free')`,
      `INSERT INTO users (id, google_id, email, name, plan) VALUES ('pp-paid', NULL, 'paid@t.test', '유료', 'plus')`,
      `INSERT INTO users (id, google_id, email, name, plan) VALUES ('pp-hold-owner', NULL, 'owner@t.test', '보류', 'free')`,
      `INSERT INTO users (id, google_id, email, name, plan, allow_family_alarms, family_alarm_quiet_windows)
       VALUES ('pp-hold-member', NULL, 'member@t.test', '멤버', 'free', 1, '[]')`,
      `INSERT INTO users (id, google_id, email, name, plan) VALUES ('pp-coupon', NULL, 'coupon@t.test', '쿠폰', 'free')`,
      `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
       VALUES ('sub-paid', 'pp-paid', '${PERSONAL}', 'active', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`,
      // 결제 보류 가족 그룹 — 구조(그룹·멤버·is_shared)는 남고 users.plan 만 free 로 회수된 상태.
      `INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members) VALUES ('pp-group', 'pp-hold-owner', '${FAMILY}', 5)`,
      `INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('pgm-o', 'pp-group', 'pp-hold-owner', 'owner')`,
      `INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('pgm-m', 'pp-group', 'pp-hold-member', 'member')`,
      `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at, entitlement_state)
       VALUES ('sub-hold-o', 'pp-hold-owner', '${FAMILY}', 'pp-group', 'active', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', 'suspended')`,
      `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at, entitlement_state)
       VALUES ('sub-hold-m', 'pp-hold-member', '${FAMILY}', 'pp-group', 'active', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', 'suspended')`,
      `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft, previewed_at, preview_language)
       VALUES ('${VP_FREE}', 'pp-free', '내 목소리', 'ready', 'el-free', 0, datetime('now'), 'ko')`,
      `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft, previewed_at, preview_language)
       VALUES ('${VP_FREE_DRAFT}', 'pp-free', '새 목소리', 'ready', 'el-free-2', 1, datetime('now'), 'ko')`,
      `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft, previewed_at, preview_language)
       VALUES ('${VP_PAID}', 'pp-paid', '유료 목소리', 'ready', 'el-paid', 0, datetime('now'), 'ko')`,
      `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft, previewed_at, preview_language)
       VALUES ('${VP_FREE_NEW_DRAFT}', 'pp-free-new', '첫 목소리', 'ready', 'el-new', 1, datetime('now'), 'ko')`,
      `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft, is_shared, previewed_at, preview_language)
       VALUES ('${VP_HOLD}', 'pp-hold-owner', '공유 목소리', 'ready', 'el-hold', 0, 1, datetime('now'), 'ko')`,
      `INSERT INTO messages (id, user_id, voice_profile_id, text, category, is_preset, audio_url)
       VALUES ('${MSG_FREE}', 'pp-free', '${VP_FREE}', '일어나', 'custom', 0, NULL)`,
      `INSERT INTO messages (id, user_id, voice_profile_id, text, category, is_preset, audio_url)
       VALUES ('${MSG_PAID}', 'pp-paid', '${VP_PAID}', '일어나', 'custom', 0, NULL)`,
      `INSERT INTO messages (id, user_id, voice_profile_id, text, category, language, variant, is_preset, audio_url)
       VALUES ('${MSG_HOLD_PRESET}', 'pp-hold-owner', '${VP_HOLD}', '좋은 아침', 'weather', 'ko', 0, 1, NULL)`,
      `INSERT INTO messages (id, user_id, voice_profile_id, text, category, is_preset, audio_url)
       VALUES ('${MSG_HOLD_OWN}', 'pp-hold-owner', '${VP_HOLD}', '일어나', 'custom', 0, NULL)`,
      `INSERT INTO promo_codes (id, code, plan_id, duration_days, is_active) VALUES ('pp-plain', 'PP_PLAIN', '${PERSONAL}', 30, 1)`,
      `INSERT INTO users (id, google_id, email, name, plan) VALUES ('pp-hold-paid-member', NULL, 'hpm@t.test', '따로 결제', 'plus')`,
      `INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('pgm-hpm', 'pp-group', 'pp-hold-paid-member', 'member')`,
      `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
       VALUES ('sub-hpm', 'pp-hold-paid-member', '${PERSONAL}', 'active', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`,
      `INSERT INTO users (id, google_id, email, name, plan) VALUES ('pp-live-owner', NULL, 'lo@t.test', '가족 주인', 'family')`,
      `INSERT INTO users (id, google_id, email, name, plan) VALUES ('pp-live-member', NULL, 'lm@t.test', '가족 멤버', 'family')`,
      `INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members) VALUES ('pp-live', 'pp-live-owner', '${FAMILY}', 5)`,
      `INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('pgm-lo', 'pp-live', 'pp-live-owner', 'owner')`,
      `INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('pgm-lm', 'pp-live', 'pp-live-member', 'member')`,
      `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
       VALUES ('sub-lo', 'pp-live-owner', '${FAMILY}', 'pp-live', 'active', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`,
      `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at)
       VALUES ('sub-lm', 'pp-live-member', '${FAMILY}', 'pp-live', 'active', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`,
      `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft, is_shared, previewed_at, preview_language)
       VALUES ('${VP_LIVE}', 'pp-live-owner', '가족 공유 목소리', 'ready', 'el-live', 0, 1, datetime('now'), 'ko')`,
      `INSERT INTO messages (id, user_id, voice_profile_id, text, category, language, variant, is_preset, audio_url)
       VALUES ('${MSG_LIVE_PRESET}', 'pp-live-owner', '${VP_LIVE}', '좋은 아침', 'weather', 'ko', 0, 1, NULL)`,
    ]);
  });

  for (const moment of MOMENTS) {
    describe(moment.name, () => {
      const PAID_REQUIRED = 'VOICE_FEATURE_REQUIRES_PAID_PLAN';
      // 게이트를 **통과했다** 는 증거: 다음 게이트(생체정보 동의)에서 멈춘다 — 픽스처에 동의가 없다.
      const PASSED = 'CONSENT_REQUIRED';
      const expectGate = (
        res: { status: number; body: Record<string, unknown> },
        open: boolean,
      ) => {
        expect(res.status).toBe(403);
        expect(res.body.error_code).toBe(open ? PASSED : PAID_REQUIRED);
      };

      it('클론 등록 — 원시 free 는 시점을 따르고, 원시 유료는 늘 통과', async () => {
        atMoment(moment.at);
        const form = () => {
          const f = new FormData();
          f.set('isDraft', 'true');
          return f;
        };
        expectGate(await call(FREE, 'POST', '/voice/clone', form()), moment.open);
        expectGate(await call(PAID, 'POST', '/voice/clone', form()), true);
      });

      it('초안 승격 — 원시 free 는 시점을 따른다', async () => {
        atMoment(moment.at);
        expectGate(
          await call(FREE_NEW, 'PATCH', `/voice/${VP_FREE_NEW_DRAFT}`, { is_draft: false }),
          moment.open,
        );
      });

      it('교체 승격(replace_existing) — 라우트도 같은 계산값 게이트', async () => {
        atMoment(moment.at);
        expectGate(
          await call(FREE, 'PATCH', `/voice/${VP_FREE_DRAFT}`, {
            is_draft: false,
            replace_existing: true,
          }),
          moment.open,
        );
      });

      it('제자리 교체 — 같은 계산값 게이트', async () => {
        atMoment(moment.at);
        const result = await replaceVoiceInPlace(db as never, {
          targetUserIds: ['pp-free', 'pp-free'],
          draftProfileId: VP_FREE_DRAFT,
          language: 'ko',
          ownerPk: 'pp-free',
          loginId: 'pp-free',
          promo: resolvePersonalPromo(PROD_ENV),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errorCode).toBe(moment.open ? PASSED : PAID_REQUIRED);
      });

      it('음성 업로드 — 원시 free 는 시점을 따른다', async () => {
        atMoment(moment.at);
        const f = new FormData();
        f.set('audio', new File([new Uint8Array(16)], 'a.wav', { type: 'audio/wav' }));
        f.set('durationMs', '60000');
        expectGate(await call(FREE, 'POST', '/voice/upload', f), moment.open);
      });

      it('/tts/generate 무료 제한 — 원시 free 의 내 목소리 직접 입력', async () => {
        atMoment(moment.at);
        const body = { voice_profile_id: VP_FREE, text: '일어나', category: 'custom' };
        expectGate(await call(FREE, 'POST', '/tts/generate', body), moment.open);
        expectGate(
          await call(PAID, 'POST', '/tts/generate', { ...body, voice_profile_id: VP_PAID }),
          true,
        );
      });

      it('직접 입력 한도 — 원시 free 는 30 → 0, 원시 유료는 그대로 30', async () => {
        atMoment(moment.at);
        const free = await call(FREE, 'GET', '/tts/manual-quota');
        expect(free.status).toBe(200);
        expect(free.body).toMatchObject(
          moment.open ? { plan_key: 'personal', limit: 30 } : { plan_key: null, limit: 0 },
        );
        const paid = await call(PAID, 'GET', '/tts/manual-quota');
        expect(paid.body).toMatchObject({ plan_key: 'personal', limit: 30 });
      });

      it('내 목소리 오디오 — 본인 갈래는 계산값(통과하면 오디오 없음 404)', async () => {
        atMoment(moment.at);
        const res = await call(FREE, 'GET', `/tts/messages/${MSG_FREE}/audio`);
        if (moment.open) {
          expect(res.status).toBe(404);
          expect(res.body.error_code).toBe('MESSAGE_AUDIO_MISSING');
        } else {
          expect(res.status).toBe(403);
          expect(res.body.error_code).toBe('VOICE_LOCKED_FREE_PLAN');
        }
      });

      it('내 알람 저장·수정 — 계산값', async () => {
        atMoment(moment.at);
        const create = await call(FREE, 'POST', '/alarms', {
          time: '07:00',
          timezone: 'Asia/Seoul',
          mode: 'tts',
          message_id: MSG_FREE,
          voice_profile_id: VP_FREE,
        });
        if (moment.open) expect(create.status).toBe(201);
        else expectGate(create, false);

        // 목소리 없는 알람은 누구나 만든다 — 그걸 목소리 알람으로 바꾸는 PATCH 가 게이트다.
        const plain = await call(FREE, 'POST', '/alarms', {
          time: '08:00',
          timezone: 'Asia/Seoul',
        });
        expect(plain.status).toBe(201);
        const alarmId = (plain.body.alarm as { id: string }).id;
        const patch = await call(FREE, 'PATCH', `/alarms/${alarmId}`, {
          mode: 'tts',
          message_id: MSG_FREE,
          voice_profile_id: VP_FREE,
        });
        if (moment.open) expect(patch.status).toBe(200);
        else expectGate(patch, false);
      });

      it('결제 보류 그룹 소유자 — 개인 기능은 시점을 따르고, 공유 갈래·보낸 알람은 원시값이라 닫힌다', async () => {
        atMoment(moment.at);
        const form = new FormData();
        form.set('isDraft', 'true');
        expectGate(await call(HOLD_OWNER, 'POST', '/voice/clone', form), moment.open);

        // 공유 프리셋: 오디오(읽기)와 알람 저장(쓰기)이 **같이** 닫혀 있다(한 쌍).
        const audio = await call(HOLD_MEMBER, 'GET', `/tts/messages/${MSG_HOLD_PRESET}/audio`);
        expect(audio.status).toBe(403);
        expect(audio.body.error_code).toBe('VOICE_LOCKED_FREE_PLAN');
        const save = await call(HOLD_MEMBER, 'POST', '/alarms', {
          time: '07:30',
          timezone: 'Asia/Seoul',
          message_id: MSG_HOLD_PRESET,
        });
        // 원시 free 멤버가 남의 목소리(공유)를 쓰는 알람 — 계산값으로 열린 목소리 게이트를 공유
        // 갈래는 원시값으로 다시 본다. 기간 전과 **같은 답**(403)이다.
        expectGate(save, false);
        const saveByVoice = await call(HOLD_MEMBER, 'POST', '/alarms', {
          time: '07:40',
          timezone: 'Asia/Seoul',
          mode: 'tts',
          voice_profile_id: VP_HOLD,
        });
        expectGate(saveByVoice, false);

        // 공유 목소리로 **생성**(`/tts/generate`) — 보류 그룹의 클론·is_shared 가 남아 있어도
        // 원시 free 멤버는 기간 중에도 닫힌다(예전에는 계산값이라 기간 동안 되살아났다).
        const gen = await call(HOLD_MEMBER, 'POST', '/tts/generate', {
          voice_profile_id: VP_HOLD,
          text: '일어나',
          category: 'custom',
        });
        expectGate(gen, false);

        // 따로 결제하는 멤버: 본인은 원시 유료지만 **주인이 원시 free**(보류)라 공유가 멈춰 있다 —
        // 오디오 라우트·`messageBelongsToCaller` 와 같은 답.
        const paidGen = await call(HOLD_PAID_MEMBER, 'POST', '/tts/generate', {
          voice_profile_id: VP_HOLD,
          text: '일어나',
          category: 'custom',
        });
        expect(paidGen.status).toBe(403);
        expect(paidGen.body.error_code).toBe('VOICE_LOCKED_FREE_PLAN');
        const paidSave = await call(HOLD_PAID_MEMBER, 'POST', '/alarms', {
          time: '07:50',
          timezone: 'Asia/Seoul',
          mode: 'tts',
          voice_profile_id: VP_HOLD,
        });
        expect(paidSave.status).toBe(404);
        expect(paidSave.body.error_code).toBe('VOICE_PROFILE_NOT_FOUND');

        // 보낸 알람(가족): 발신자 게이트는 원시값 — 열림 시점에도 거절.
        const sent = await call(HOLD_OWNER, 'POST', '/alarms', {
          time: kstHHmm(new Date(moment.at.getTime() + 3 * 60 * 60 * 1000)),
          timezone: 'Asia/Seoul',
          target_user_id: HOLD_MEMBER.pk,
          message_id: MSG_HOLD_OWN,
        });
        expectGate(sent, false);
      });

      it('따로 결제하는 멤버의 PATCH — 공유 목소리를 그대로 보내면 통과, 그 목소리로 바꾸면 404(D8)', async () => {
        atMoment(moment.at);
        // 주인이 유료일 때 저장된 알람(공유 목소리)과 목소리 없는 알람 — 보류가 온 뒤의 모습.
        const suffix = moment.open ? '1' : '2';
        const kept = `33333333-3333-4333-8333-00000000000${suffix}`;
        const plain = `33333333-3333-4333-8333-00000000001${suffix}`;
        await db.batch([
          {
            sql: `INSERT INTO alarms (id, user_id, time, mode, voice_profile_id)
                  VALUES (?, 'pp-hold-paid-member', '07:55', 'tts', ?)`,
            args: [kept, VP_HOLD],
          },
          {
            sql: `INSERT INTO alarms (id, user_id, time, mode)
                  VALUES (?, 'pp-hold-paid-member', '08:05', 'sound-only')`,
            args: [plain],
          },
        ]);
        // 안드로이드 동기화처럼 켜기·끄기·시각만 고치면서 목소리를 **그대로** 보낸다 — 주인이
        // 보류라 그 목소리를 새로 고를 수는 없지만, 이미 있던 값이라 토글은 막지 않는다.
        const toggle = await call(HOLD_PAID_MEMBER, 'PATCH', `/alarms/${kept}`, {
          time: '07:56',
          is_active: false,
          mode: 'tts',
          voice_profile_id: VP_HOLD,
        });
        expect(toggle.status).toBe(200);
        const row = await db.execute({
          sql: 'SELECT time, is_active, voice_profile_id FROM alarms WHERE id = ?',
          args: [kept],
        });
        expect(row.rows[0]).toMatchObject({
          time: '07:56',
          is_active: 0,
          voice_profile_id: VP_HOLD,
        });

        // 그 목소리로 **바꾸는** PATCH 는 POST 와 같이 막힌다 — 멈춘 공유를 새로 심지 못한다.
        const switchTo = await call(HOLD_PAID_MEMBER, 'PATCH', `/alarms/${plain}`, {
          mode: 'tts',
          voice_profile_id: VP_HOLD,
        });
        expect(switchTo.status).toBe(404);
        expect(switchTo.body.error_code).toBe('VOICE_PROFILE_NOT_FOUND');
        const untouched = await db.execute({
          sql: 'SELECT mode, voice_profile_id FROM alarms WHERE id = ?',
          args: [plain],
        });
        expect(untouched.rows[0]).toMatchObject({ mode: 'sound-only', voice_profile_id: null });
      });

      it('살아 있는 가족 그룹의 공유 목소리는 원시 게이트를 그대로 지난다(대조군)', async () => {
        atMoment(moment.at);
        const save = await call(LIVE_MEMBER, 'POST', '/alarms', {
          time: '06:30',
          timezone: 'Asia/Seoul',
          message_id: MSG_LIVE_PRESET,
        });
        expect(save.status).toBe(201);
        const byVoice = await call(LIVE_MEMBER, 'POST', '/alarms', {
          time: '06:40',
          timezone: 'Asia/Seoul',
          mode: 'tts',
          voice_profile_id: VP_LIVE,
        });
        expect(byVoice.status).toBe(201);
        // 생성은 플랜 게이트를 지나 다음 게이트(생체정보 동의 — 픽스처에 없다)에서 멈춘다.
        const gen = await call(LIVE_MEMBER, 'POST', '/tts/generate', {
          voice_profile_id: VP_LIVE,
          text: '일어나',
          category: 'custom',
        });
        expect(gen.body.error_code).toBe('CONSENT_REQUIRED');
      });

      it('/billing/subscription — user_plan 계산값, personal_promo, 가짜 구독 없음', async () => {
        atMoment(moment.at);
        const plainRes = await call(FREE, 'GET', '/billing/subscription');
        expect(plainRes.status).toBe(200);
        expect(plainRes.body.subscription).toBeNull();
        expect(plainRes.body).not.toHaveProperty('user_plan');
        expect(plainRes.body.personal_promo).toEqual(
          moment.open
            ? {
                ends_at: '2026-10-31T15:00:00Z',
                notice_from: '2026-10-24T15:00:00Z',
                deletes_voices_at_end: true,
                computed_at: '2026-10-31T14:59:59Z',
              }
            : null,
        );
        // 결제 보류 소유자: 원시 free 라 값이 있고(앱의 보류 규칙), 종료 전환 대상이 아니라
        // 삭제 문장은 빠진다.
        const holdRes = await call(HOLD_OWNER, 'GET', '/billing/subscription');
        expect(holdRes.body.personal_promo).toEqual(
          moment.open
            ? {
                ends_at: '2026-10-31T15:00:00Z',
                notice_from: '2026-10-24T15:00:00Z',
                deletes_voices_at_end: false,
                computed_at: '2026-10-31T14:59:59Z',
              }
            : null,
        );
        const refreshed = await call(FREE, 'GET', '/billing/subscription?refresh_store=1');
        expect(refreshed.body.user_plan).toBe(moment.open ? 'plus' : 'free');
        expect(refreshed.body.subscription).toBeNull();

        const paid = await call(PAID, 'GET', '/billing/subscription?refresh_store=1');
        expect(paid.body.user_plan).toBe('plus');
        expect(paid.body.personal_promo).toBeNull();
        expect(paid.body.subscription).not.toBeNull();
      });
    });
  }

  it('기간 중 쿠폰 등록이 된다 — 프로모는 구독이 아니라 ACTIVE_SUBSCRIPTION_EXISTS 에 안 걸린다', async () => {
    atMoment(new Date(END.getTime() - 1000));
    const res = await call(COUPON_USER, 'POST', '/code/register', { code: 'PP_PLAIN' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('promo');
    // 이제 원시 plus — personal_promo 는 없고, 계산값도 그대로 plus 다.
    const sub = await call(COUPON_USER, 'GET', '/billing/subscription?refresh_store=1');
    expect(sub.body.user_plan).toBe('plus');
    expect(sub.body.personal_promo).toBeNull();
    expect(sub.body.subscription).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
async function seedVoice(
  client: Client,
  userId: string,
  id: string,
  extra: Partial<Record<string, string | number | null>> = {},
) {
  const row = {
    is_draft: 0,
    is_system: 0,
    is_shared: 0,
    deleted_at: null as string | null,
    elevenlabs_voice_id: `el-${id}`,
    ...extra,
  };
  await client.execute({
    sql: `INSERT INTO voice_profiles
            (id, user_id, name, status, elevenlabs_voice_id, is_draft, is_system, is_shared, deleted_at)
          VALUES (?, ?, '목소리', 'ready', ?, ?, ?, ?, ?)`,
    args: [
      id,
      userId,
      row.elevenlabs_voice_id,
      row.is_draft,
      row.is_system,
      row.is_shared,
      row.deleted_at,
    ],
  });
}

async function seedUser(client: Client, id: string, plan: string | null) {
  await client.execute({
    sql: `INSERT INTO users (id, google_id, email, name, plan) VALUES (?, NULL, ?, ?, ?)`,
    args: [id, `${id}@t.test`, id, plan],
  });
}

async function retentionOf(client: Client, userId: string): Promise<string | null> {
  const r = await client.execute({
    sql: 'SELECT delete_after FROM paid_voice_retention WHERE user_id = ?',
    args: [userId],
  });
  return r.rows[0] ? String(r.rows[0].delete_after) : null;
}

describe('만료 크론 — 기간 중에는 보관을 걸지 않고, 끝나면 전환이 건다', () => {
  it('기간 중 끝난 쿠폰 구독: 강등은 원시로 일어나되 보관 행이 없다 → 끝 뒤 전환이 끝 + 3일로 건다', async () => {
    db = await freshDb('expiry');
    await seedUser(db, 'c1', 'plus');
    await seedUser(db, 'c2', 'plus');
    for (const u of ['c1', 'c2']) {
      await db.execute({
        sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
              VALUES (?, ?, ?, 'active', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
        args: [`sub-${u}`, u, PERSONAL],
      });
      await seedVoice(db, u, `vp-${u}`);
    }

    // 기간 안 — c1 만 만료 대상으로 남겨 두고 돌린다(c2 는 아직 만료 전인 척 미래로).
    await db.execute(
      "UPDATE subscriptions SET expires_at = '2099-01-01T00:00:00Z' WHERE id = 'sub-c2'",
    );
    await processSubscriptionExpiry(db, PROD_ENV, new Date(END.getTime() - 1000));
    expect((await db.execute("SELECT plan FROM users WHERE id = 'c1'")).rows[0]!.plan).toBe('free');
    expect(await retentionOf(db, 'c1')).toBeNull();
    // 반납된 클론은 다음 생성 때 재클론된다 — 데이터는 그대로다.
    expect(
      (await db.execute("SELECT COUNT(*) AS n FROM voice_profiles WHERE id = 'vp-c1'")).rows[0]!.n,
    ).toBe(1);

    // 끝 뒤 — c2 의 만료(원시 규칙: 실행 시각 + 3일)와 c1 의 종료 전환이 같은 틱에 돈다.
    // 전환은 만료 크론 안이 아니라 `runPersonalPromoEnd`(5분 틱 폴백·1분 전용 크론)가 한다.
    await db.execute(
      "UPDATE subscriptions SET expires_at = '2026-09-01T00:00:00Z' WHERE id = 'sub-c2'",
    );
    const after = new Date(END.getTime() + 60 * 60 * 1000);
    await processSubscriptionExpiry(db, PROD_ENV, after);
    expect(await retentionOf(db, 'c1')).toBeNull();
    await runPersonalPromoEnd(db, PROD_ENV, after, { role: 'main' });
    // 종료 전환 대상 — 약속 시각(끝 + 3일) 그대로다. 그보다 먼저 지우지 않는다(D6).
    expect(await retentionOf(db, 'c1')).toBe('2026-11-03T15:00:00.000Z');
    expect(await retentionOf(db, 'c2')).toBe(
      new Date(after.getTime() + 3 * 86_400_000).toISOString(),
    );
  });
});

describe('종료 전환(transitionPersonalPromoEnd) — 대상만, 묶음 상한, 멱등, delete_after = 끝 + 3일', () => {
  const WINDOW = { startsAt: new Date('2026-09-30T15:00:00Z'), endsAt: END };
  const AFTER = new Date(END.getTime() + 2 * 60 * 60 * 1000);

  beforeAll(async () => {
    db = await freshDb('transition');
    // 대상 다섯.
    for (const id of ['t1', 't2', 't3', 't4', 't5']) {
      await seedUser(db, id, 'free');
      await seedVoice(db, id, `vp-${id}`, { is_shared: 1 });
    }
    // 대상 아님
    await seedUser(db, 'n-novoice', 'free');
    await seedUser(db, 'n-draft', 'free');
    await seedVoice(db, 'n-draft', 'vp-n-draft', { is_draft: 1 });
    await seedUser(db, 'n-deleted', 'free');
    await seedVoice(db, 'n-deleted', 'vp-n-deleted', { deleted_at: '2026-09-01 00:00:00' });
    await seedUser(db, 'n-paid', 'plus');
    await seedVoice(db, 'n-paid', 'vp-n-paid');
    await db.execute(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
       VALUES ('sub-n-paid', 'n-paid', '${PERSONAL}', 'active', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`,
    );
    // 결제 보류 — users.plan 은 free 지만 행이 active 로 남아 있다(회복형 — 보관을 걸지 않는다).
    await seedUser(db, 'n-hold', 'free');
    await seedVoice(db, 'n-hold', 'vp-n-hold');
    await db.execute(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, entitlement_state)
       VALUES ('sub-n-hold', 'n-hold', '${PERSONAL}', 'active', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', 'suspended')`,
    );
    // 이미 보관이 걸린 사람 — 기한을 건드리지 않는다.
    await seedUser(db, 'n-retained', 'free');
    await seedVoice(db, 'n-retained', 'vp-n-retained');
    await db.execute(
      "INSERT INTO paid_voice_retention (user_id, delete_after) VALUES ('n-retained', '2026-11-02T00:00:00.000Z')",
    );
  });

  it('끝 전이거나 스위치가 꺼져 있으면 아무것도 하지 않는다', async () => {
    expect(await transitionPersonalPromoEnd(db, WINDOW, new Date(END.getTime() - 1))).toEqual([]);
    expect(await transitionPersonalPromoEnd(db, null, AFTER)).toEqual([]);
    expect((await db.execute('SELECT COUNT(*) AS n FROM paid_voice_retention')).rows[0]!.n).toBe(1);
  });

  it('묶음마다 상한만큼, 끝 + 3일 그대로, 다 돌면 멈춘다', async () => {
    // 기준점 '' = id 순서 맨 앞부터(운영은 실행마다 무작위 기준점이다).
    const opts = { limit: 3, pivot: '', notifyMessages: null } as const;
    const first = await transitionPersonalPromoEnd(db, WINDOW, AFTER, opts);
    expect(first.map((t) => t.userPk)).toEqual(['t1', 't2', 't3']);
    const second = await transitionPersonalPromoEnd(
      db,
      WINDOW,
      new Date(AFTER.getTime() + 5 * 60_000),
      opts,
    );
    expect(second.map((t) => t.userPk)).toEqual(['t4', 't5']);
    expect(
      await transitionPersonalPromoEnd(db, WINDOW, new Date(AFTER.getTime() + 10 * 60_000), opts),
    ).toEqual([]);

    for (const t of [...first, ...second]) {
      // 전원 약속 시각(끝 + 3일) 그대로 — 먼저 전환된 사람도 3일을 채운다(D6). 푸시가 적는
      // 시각(돌려준 값)과 행이 같다.
      expect(t.deleteAfter.toISOString()).toBe('2026-11-03T15:00:00.000Z');
      expect(await retentionOf(db, t.userPk)).toBe(t.deleteAfter.toISOString());
    }
    expect(first[0]!.deleteAfter.toISOString()).toBe(
      promoEndDeleteAfter(WINDOW, AFTER).toISOString(),
    );
    for (const id of ['n-novoice', 'n-draft', 'n-deleted', 'n-paid', 'n-hold']) {
      expect(await retentionOf(db, id)).toBeNull();
    }
    expect(await retentionOf(db, 'n-retained')).toBe('2026-11-02T00:00:00.000Z');
  });

  it('전환된 사람은 음성 보존 강등을 탄다 — 클론 반납·공유 해제, 행은 남는다', async () => {
    const rows = await db.execute(
      "SELECT id, elevenlabs_voice_id, is_shared, deleted_at FROM voice_profiles WHERE id IN ('vp-t1','vp-t5') ORDER BY id",
    );
    for (const r of rows.rows) {
      expect(r.elevenlabs_voice_id).toBeNull();
      expect(Number(r.is_shared)).toBe(0);
      expect(r.deleted_at).toBeNull();
    }
    expect((await db.execute("SELECT plan FROM users WHERE id = 't1'")).rows[0]!.plan).toBe('free');
  });
});

describe('보관 스윕 — 기간 중에는 원시 free 의 보관을 지우지 않고 풀어 준다', () => {
  it('기간 중: 행만 지우고 목소리는 남는다 / 끝 뒤: 지운다', async () => {
    db = await freshDb('sweep');
    await seedUser(db, 's1', 'free');
    await seedVoice(db, 's1', 'vp-s1');
    await db.execute(
      "INSERT INTO paid_voice_retention (user_id, delete_after) VALUES ('s1', '2026-10-01T00:00:00.000Z')",
    );
    const during = await sweepPaidVoiceRetention(db, new Date(END.getTime() - 1000), true);
    expect(during.cleanedUserPks).toEqual([]);
    expect(await retentionOf(db, 's1')).toBeNull();
    expect(
      (await db.execute("SELECT COUNT(*) AS n FROM voice_profiles WHERE id = 'vp-s1'")).rows[0]!.n,
    ).toBe(1);

    await db.execute(
      "INSERT INTO paid_voice_retention (user_id, delete_after) VALUES ('s1', '2026-11-03T15:00:00.000Z')",
    );
    const afterEnd = await sweepPaidVoiceRetention(db, new Date('2026-11-03T15:05:00.000Z'), false);
    expect(afterEnd.cleanedUserPks).toEqual(['s1']);
    expect(
      (await db.execute("SELECT COUNT(*) AS n FROM voice_profiles WHERE id = 'vp-s1'")).rows[0]!.n,
    ).toBe(0);
  });
});
