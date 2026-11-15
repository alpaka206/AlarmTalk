// `POST /auth/kakao`(2026-11-14) — 구성 가드, **인증된 이메일일 때만** 기존 계정에 붙는가, 합성 주소가 새지 않는가,
// 토큰 거절은 401·경보 아님.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

const KAKAO_ID = '4242';
/** 카카오가 이번 로그인에 준 **인증된** 이메일. null 이면 없거나 인증되지 않았다. */
let verifiedEmail: string | null;

vi.mock('../src/lib/kakao-oauth', () => ({
  verifyKakaoAccessToken: vi.fn(async () => ({ kakaoId: KAKAO_ID, verifiedEmail })),
}));

import authRoutes from '../src/routes/auth';
import { verifyKakaoAccessToken } from '../src/lib/kakao-oauth';

const ENV = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'test',
  KAKAO_APP_ID: '1500680',
} as unknown as Env;

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/auth', authRoutes);
  return app;
}

function post(env: Env = ENV) {
  return buildApp().request(jsonReq('POST', '/auth/kakao', { access_token: 'tok' }), undefined, env);
}

function pushExistingUser(storedEmail: string) {
  mockDB.pushResult([
    {
      id: 'user-pk-1',
      kakao_id: KAKAO_ID,
      email: storedEmail,
      plan: 'free',
      token_epoch: 0,
      dynamic_prompt_settings_json: null,
    },
  ]);
  mockDB.pushResult([], 1); // UPDATE users SET kakao_id
}

function pushTail() {
  mockDB.pushResult([{ dynamic_prompt_settings_json: null }]); // fresh SELECT
}

function jwtPayload(token: string) {
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)),
    ),
  );
}

beforeEach(() => {
  mockDB.reset();
  verifiedEmail = 'user@example.com';
  vi.mocked(verifyKakaoAccessToken).mockClear();
});

describe('POST /auth/kakao — 구성', () => {
  it('KAKAO_APP_ID 가 없으면 토큰을 보지 않고 500 이다(fail-closed)', async () => {
    const res = await post({ ...ENV, KAKAO_APP_ID: undefined } as unknown as Env);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('AUTH_KAKAO_CONFIG_MISSING');
    expect(verifyKakaoAccessToken).not.toHaveBeenCalled();
  });

  it('요청 본문에 access_token 이 없으면 400 이다', async () => {
    const res = await buildApp().request(jsonReq('POST', '/auth/kakao', {}), undefined, ENV);
    expect(res.status).toBe(400);
  });

  it('앱 ID 를 그대로 넘긴다', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    pushTail();
    await post();
    expect(verifyKakaoAccessToken).toHaveBeenCalledWith('tok', '1500680');
  });
});

describe('POST /auth/kakao — 계정 찾기', () => {
  it('신규 가입은 카카오가 인증한 이메일로 만든다', async () => {
    mockDB.pushResult([]); // 기존 사용자 없음
    mockDB.pushResult([], 1); // INSERT users
    pushTail();

    const res = await post();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.email).toBe('user@example.com');
    const insert = mockDB.calls.find((call) => call.sql.includes('INSERT INTO users'));
    expect(insert?.args).toEqual([expect.any(String), KAKAO_ID, 'user@example.com']);
  });

  it('인증된 이메일이면 회원번호 또는 그 이메일로 찾고, 회원번호 행을 먼저 고른다', async () => {
    pushExistingUser('user@example.com');
    pushTail();

    await post();
    const lookup = mockDB.calls[0]!;
    expect(lookup.sql).toContain('WHERE kakao_id = ? OR email = ?');
    expect(lookup.sql).toContain('ORDER BY CASE WHEN kakao_id = ?');
    expect(lookup.args).toEqual([KAKAO_ID, 'user@example.com', KAKAO_ID]);
  });

  it('인증되지 않은 이메일이면 회원번호로만 찾는다 — 남의 이메일로 기존 계정에 붙지 않는다', async () => {
    verifiedEmail = null;
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    pushTail();

    const res = await post();
    const lookup = mockDB.calls[0]!;
    expect(lookup.sql).not.toContain('email = ?');
    expect(lookup.args).toEqual([KAKAO_ID]);
    // 새 계정은 합성 주소로 만든다.
    expect((await res.json()).user.email).toBe(`${KAKAO_ID}@kakao.local`);
  });

  it('기존 계정에 붙을 때 저장된 주소를 덮어쓰지 않고 그 주소를 돌려준다', async () => {
    verifiedEmail = null;
    pushExistingUser('real@example.com');
    pushTail();

    const res = await post();
    const json = await res.json();
    expect(json.user.email).toBe('real@example.com');
    expect(jwtPayload(json.token).email).toBe('real@example.com');
    const update = mockDB.calls.find((call) => call.sql.includes('UPDATE users') && call.sql.includes('kakao_id'));
    expect(update?.sql).not.toContain('email =');
    expect(update?.args).toEqual([KAKAO_ID, 'user-pk-1']);
  });
});

// 2026-09-14 BACKEND-7 과 같은 규칙 — 클라가 보낸 잘못된 토큰(401)은 경보가 아니다(`docs/spec/error-codes.md` §3).
describe('POST /auth/kakao — 토큰 거절은 경보가 아니다', () => {
  function buildAppWithSentry(sentry: { captureException: ReturnType<typeof vi.fn> }) {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('sentry', sentry as unknown as AppEnv['Variables']['sentry']);
      await next();
    });
    app.route('/auth', authRoutes);
    return app;
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('카카오가 거절한 토큰은 401 이고 Sentry 로 가지 않는다', async () => {
    vi.mocked(verifyKakaoAccessToken).mockRejectedValueOnce(new Error('Kakao token rejected (/v1/user/access_token_info 401)'));
    const sentry = { captureException: vi.fn() };
    const res = await buildAppWithSentry(sentry).request(jsonReq('POST', '/auth/kakao', { access_token: 'bad' }), undefined, ENV);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('AUTH_KAKAO_FAILED');
    expect(sentry.captureException).not.toHaveBeenCalled();
    const warned = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(warned.some((line) => line.includes('auth.kakao.rejected'))).toBe(true);
  });

  it('다른 앱의 토큰도 401 이다', async () => {
    vi.mocked(verifyKakaoAccessToken).mockRejectedValueOnce(new Error('Kakao token issued for another app'));
    const res = await post();
    expect(res.status).toBe(401);
  });

  it('카카오 장애는 500 이고 Sentry 로 간다', async () => {
    vi.mocked(verifyKakaoAccessToken).mockRejectedValueOnce(new Error('Kakao API failed (/v2/user/me 503)'));
    const sentry = { captureException: vi.fn() };
    const res = await buildAppWithSentry(sentry).request(jsonReq('POST', '/auth/kakao', { access_token: 'tok' }), undefined, ENV);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('AUTH_KAKAO_FAILED');
    expect(sentry.captureException).toHaveBeenCalled();
  });
});
