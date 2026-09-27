// 기간 한정 개인 플랜 — 계정 응답의 `user.plan`(계산값)과 `user.personal_promo`.
// `docs/spec/billing-lifecycle.md` 「기간 한정 개인 플랜」의 API 표. 가입·로그인·구글·애플·/me
// 다섯 경로가 **같은 규칙**을 내야 한다 — 한 경로라도 원시값을 내면 구버전 앱이 그 경로로
// 들어온 순간 무료로 판정해 잠근다.
//
// 경계는 운영 상수 그대로(production 모드)로 잰다: 끝 1초 전 / 끝 시각. JS `Date` 만 가짜다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { PERSONAL_PROMO } from '@alarmtalk/shared';
import type { Env } from '../src/types';
import { createMockDB, jsonReq } from './helpers';

const mockDB = createMockDB();
vi.mock('../src/lib/db', () => ({ getDB: () => mockDB.client }));

const APPLE_SUB = '001234.promo.0001';
vi.mock('../src/lib/apple-oauth', () => ({
  verifyAppleIdToken: vi.fn(async () => ({ sub: APPLE_SUB, email: 'apple@example.com' })),
}));

import authRoutes from '../src/routes/auth';
import { hashPassword } from '../src/lib/password';
import { hashEmailVerificationCode } from '../src/lib/email-verification';
import { signAppJwt } from '../src/lib/jwt';

const END = new Date(PERSONAL_PROMO.endsAt);
const PROMO = {
  ends_at: '2026-10-31T15:00:00Z',
  notice_from: '2026-10-24T15:00:00Z',
  deletes_voices_at_end: true,
  // 서버가 계산한 시각(열린 순간 = 끝 1초 전) — 앱의 낡은 캐시 판정이 받은 시각으로 쓴다(D7).
  computed_at: '2026-10-31T14:59:59Z',
};

const ENV = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'production',
  APPLE_BUNDLE_ID: 'com.alarmtalk.app',
  PERSONAL_PROMO_STARTS_AT: '2026-10-01T00:00:00+09:00',
} as unknown as Env;
/** 스위치를 안 켠 운영 — 오늘 prod 의 모양. 아무것도 바뀌지 않아야 한다. */
const ENV_OFF = { ...ENV, PERSONAL_PROMO_STARTS_AT: undefined } as unknown as Env;

const MOMENTS = [
  { name: '끝 1초 전', at: new Date(END.getTime() - 1000), open: true },
  { name: '끝 시각', at: END, open: false },
] as const;

const originalFetch = globalThis.fetch;
beforeEach(() => {
  mockDB.reset();
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.route('/auth', authRoutes);
  return a;
}

async function register(env: Env) {
  mockDB.pushResult([
    {
      id: 'email-code-1',
      code_hash: await hashEmailVerificationCode('kim@test.com', '123456', env.PASSWORD_PEPPER),
      attempts: 0,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
  ]);
  mockDB.pushResult([]); // 기존 이메일 없음
  mockDB.pushResult([], 1); // INSERT users
  mockDB.pushResult([], 1); // consume code
  const res = await app().request(
    jsonReq('POST', '/auth/register', {
      email: 'kim@test.com',
      password: 'superSecret1',
      name: '김규원',
      email_verification_code: '123456',
    }),
    undefined,
    env,
  );
  expect(res.status).toBe(201);
  return (await res.json()).user as Record<string, unknown>;
}

async function login(env: Env, plan: string | null) {
  mockDB.pushResult([
    {
      id: 'u-1',
      email: 'kim@test.com',
      password_hash: await hashPassword('superSecret1', env.PASSWORD_PEPPER),
      name: '김규원',
      plan,
      token_epoch: 0,
    },
  ]);
  const res = await app().request(
    jsonReq('POST', '/auth/login', { email: 'kim@test.com', password: 'superSecret1' }),
    undefined,
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()).user as Record<string, unknown>;
}

async function google(env: Env, existingPlan: string | null | 'new') {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      sub: 'google-user-1',
      email: 'user@gmail.com',
      name: 'Google User',
      iss: 'accounts.google.com',
      email_verified: true,
      aud: env.GOOGLE_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  }) as unknown as typeof fetch;
  if (existingPlan === 'new') {
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
  } else {
    mockDB.pushResult([
      {
        id: 'u-g',
        google_id: 'google-user-1',
        email: 'user@gmail.com',
        name: '구글',
        plan: existingPlan,
        token_epoch: 0,
      },
    ]);
    mockDB.pushResult([], 1);
  }
  const res = await app().request(
    jsonReq('POST', '/auth/google', { id_token: 't' }),
    undefined,
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()).user as Record<string, unknown>;
}

async function apple(env: Env, plan: string | null) {
  mockDB.pushResult([
    {
      id: 'u-a',
      apple_id: APPLE_SUB,
      email: 'apple@example.com',
      name: '애플',
      plan,
      token_epoch: 0,
      allow_family_alarms: 0,
      family_alarm_quiet_windows: '[]',
      dynamic_prompt_settings_json: null,
    },
  ]);
  mockDB.pushResult([], 1); // UPDATE users
  mockDB.pushResult([], 1); // UPDATE apple_refresh_token(있을 때만)
  mockDB.pushResult([
    {
      allow_family_alarms: 0,
      family_alarm_quiet_windows: '[]',
      dynamic_prompt_settings_json: null,
    },
  ]);
  const res = await app().request(
    jsonReq('POST', '/auth/apple', { identity_token: 'tok', nonce: 'n' }),
    undefined,
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()).user as Record<string, unknown>;
}

async function me(env: Env, plan: string | null) {
  const token = await signAppJwt(
    { sub: 'u-1', email: 'kim@test.com', name: '김규원', epoch: 0 },
    env.JWT_SECRET,
  );
  mockDB.pushResult([
    {
      id: 'u-1',
      email: 'kim@test.com',
      name: '김규원',
      plan,
      token_epoch: 0,
      deletion_status: null,
    },
  ]);
  const res = await app().request(
    new Request('http://localhost/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
    undefined,
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()).user as Record<string, unknown>;
}

for (const moment of MOMENTS) {
  describe(`계정 응답 — ${moment.name}`, () => {
    const freeExpect = moment.open
      ? { plan: 'plus', personal_promo: PROMO }
      : { plan: 'free', personal_promo: null };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(moment.at);
    });

    it('가입 — 원시 free 리터럴도 계산값으로 나간다', async () => {
      expect(await register(ENV)).toMatchObject(freeExpect);
    });

    it('로그인 — 원시 free 는 시점을 따르고, 원시 유료는 그대로', async () => {
      expect(await login(ENV, 'free')).toMatchObject(freeExpect);
      mockDB.reset();
      expect(await login(ENV, 'family')).toMatchObject({ plan: 'family', personal_promo: null });
    });

    it('구글 — 신규·기존 무료 모두', async () => {
      expect(await google(ENV, 'new')).toMatchObject(freeExpect);
      mockDB.reset();
      expect(await google(ENV, 'free')).toMatchObject(freeExpect);
      mockDB.reset();
      expect(await google(ENV, 'plus')).toMatchObject({ plan: 'plus', personal_promo: null });
    });

    it('애플 — 기존 무료', async () => {
      expect(await apple(ENV, 'free')).toMatchObject(freeExpect);
    });

    it('/auth/me — 원시 free 는 시점을 따르고, null 은 올리지 않는다(fail-closed)', async () => {
      expect(await me(ENV, 'free')).toMatchObject(freeExpect);
      mockDB.reset();
      expect(await me(ENV, 'plus')).toMatchObject({ plan: 'plus', personal_promo: null });
      mockDB.reset();
      // 원시 null 은 계산에서도 null — 응답은 예전처럼 'free' 로 읽는다.
      expect(await me(ENV, null)).toMatchObject({ plan: 'free', personal_promo: null });
    });
  });
}

describe('personal_promo.deletes_voices_at_end — 종료 전환 대상과 같은 조건', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(END.getTime() - 1000));
  });

  it('원시 free 인데 active 구독 행이 남아 있으면(결제 보류) false — 값 자체는 남는다', async () => {
    // 보류 계정도 personal_promo 가 있어야 앱이 "원시 plan 이 free" 를 안다(보류 규칙).
    mockDB.pushResultFor("s.status = 'active'", [{ has_row: 1 }]);
    const user = await me(ENV, 'free');
    expect(user.plan).toBe('plus');
    expect(user.personal_promo).toEqual({ ...PROMO, deletes_voices_at_end: false });
    const query = mockDB.calls.find((c) => c.sql.includes("s.status = 'active'"));
    expect(query?.args).toEqual(['u-1']);
  });

  it('로그인·구글·애플도 같은 조회로 채운다', async () => {
    mockDB.pushResultFor("s.status = 'active'", [{ has_row: 1 }]);
    expect((await login(ENV, 'free')).personal_promo).toEqual({
      ...PROMO,
      deletes_voices_at_end: false,
    });
    mockDB.reset();
    mockDB.pushResultFor("s.status = 'active'", [{ has_row: 1 }]);
    expect((await google(ENV, 'free')).personal_promo).toEqual({
      ...PROMO,
      deletes_voices_at_end: false,
    });
    mockDB.reset();
    mockDB.pushResultFor("s.status = 'active'", [{ has_row: 1 }]);
    expect((await apple(ENV, 'free')).personal_promo).toEqual({
      ...PROMO,
      deletes_voices_at_end: false,
    });
  });

  it('결제자·스위치 꺼짐에는 조회를 더하지 않는다', async () => {
    await me(ENV, 'plus');
    expect(mockDB.calls.some((c) => c.sql.includes("s.status = 'active'"))).toBe(false);
    mockDB.reset();
    await me(ENV_OFF, 'free');
    expect(mockDB.calls.some((c) => c.sql.includes("s.status = 'active'"))).toBe(false);
  });
});

describe('계정 응답 — 스위치를 안 켠 운영(오늘의 prod)', () => {
  it('기간 안 시각이어도 원시값 그대로다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(END.getTime() - 1000));
    expect(await me(ENV_OFF, 'free')).toMatchObject({ plan: 'free', personal_promo: null });
    mockDB.reset();
    expect(await register(ENV_OFF)).toMatchObject({ plan: 'free', personal_promo: null });
  });
});
