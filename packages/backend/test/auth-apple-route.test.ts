// `POST /auth/apple` 의 두 가지 — **잘린 시크릿이 로그인을 막지 않는가**, 그리고
// **합성 이메일이 세션에 새어 나가지 않는가**(코덱스 #730 3차).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../src/types';
import { createMockDB, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

const APPLE_SUB = '001234.abcdef.0001';

vi.mock('../src/lib/apple-oauth', () => ({
  verifyAppleIdToken: vi.fn(async () => ({ sub: APPLE_SUB, email: appleEmail })),
}));

// ⚠ **진짜 구현을 쓴다.** 이 테스트의 요점이 "PEM 이 잘리면 `appleSignInConfig` 가 던지고,
// 그 예외가 로그인을 죽이는가" 라서, 던지는 쪽을 목으로 바꾸면 검사할 것이 없어진다.
// 교환 함수만 목으로 둔다(네트워크).
vi.mock('../src/lib/apple-revoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/apple-revoke')>()),
  exchangeAppleAuthorizationCode: vi.fn(async () => ({ refreshToken: 'rt-1' })),
}));

import authRoutes from '../src/routes/auth';

/** 애플이 이번 로그인에 실어 준 이메일. 재로그인 때는 없을 수 있다. */
let appleEmail: string | undefined;

const BASE_ENV = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'test',
  APPLE_BUNDLE_ID: 'com.alarmtalk.app',
} as unknown as Env;

/** PEM 이 첫 줄만 올라간 상태 — `.dev.vars` 가 줄 단위로 파싱되면 실제로 이렇게 된다. */
const TRUNCATED_KEY_ENV = {
  ...BASE_ENV,
  APPLE_TEAM_ID: 'TEAM123',
  APPLE_SIGNIN_KEY_ID: 'KEY123',
  APPLE_SIGNIN_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
} as unknown as Env;

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/auth', authRoutes);
  return app;
}

function body() {
  return { identity_token: 'tok', authorization_code: 'code-1', nonce: 'n' };
}

/** 기존 사용자 한 명이 있는 상태의 목 응답. */
function pushExistingUser(storedEmail: string) {
  mockDB.pushResult([
    {
      id: 'user-pk-1',
      apple_id: APPLE_SUB,
      email: storedEmail,
      name: '규원',
      plan: 'free',
      token_epoch: 0,
      allow_family_alarms: 0,
      family_alarm_quiet_windows: '[]',
      dynamic_prompt_settings_json: null,
    },
  ]);
  mockDB.pushResult([], 1); // UPDATE users
}

function pushTail() {
  mockDB.pushResult([], 1); // UPDATE apple_refresh_token (있을 때만 쓰이고, 남아도 무해)
  mockDB.pushResult([
    { allow_family_alarms: 0, family_alarm_quiet_windows: '[]', dynamic_prompt_settings_json: null },
  ]); // fresh SELECT
}

beforeEach(() => {
  mockDB.reset();
  appleEmail = undefined;
});

describe('POST /auth/apple — 잘린 애플 시크릿', () => {
  it('설정이 깨져 있어도 로그인은 성공한다', async () => {
    // ⚠ `appleSignInConfig` 는 잘린 PEM 에 **던진다.** 그 호출이 최선 노력 try 밖에 있으면
    //   예외가 바깥 catch 로 빠져나가 **모든 애플 로그인이 AUTH_APPLE_FAILED** 가 된다 —
    //   정상 로그인은 언제나 authorization_code 를 싣고 오기 때문이다.
    appleEmail = 'real@example.com';
    pushExistingUser('real@example.com');
    pushTail();

    const res = await buildApp().request(jsonReq('POST', '/auth/apple', body()), undefined, TRUNCATED_KEY_ENV);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token).toBeTruthy();
    expect(json.user.id).toBe('user-pk-1');
  });

  it('시크릿이 아예 없어도 로그인은 성공한다', async () => {
    appleEmail = 'real@example.com';
    pushExistingUser('real@example.com');
    pushTail();

    const res = await buildApp().request(jsonReq('POST', '/auth/apple', body()), undefined, BASE_ENV);

    expect(res.status).toBe(200);
  });
});

describe('POST /auth/apple — 재로그인 이메일', () => {
  it('애플이 이메일을 안 주면 저장된 진짜 주소를 돌려준다', async () => {
    // 애플은 최초 1회만 이메일을 준다. 그때 합성한 `<sub>@apple.local` 을 응답·JWT 에
    // 실으면 앱이 세션을 가짜 주소로 덮어쓰고 그 뒤로 계속 그걸 보여 준다.
    appleEmail = undefined;
    pushExistingUser('real@example.com');
    pushTail();

    const res = await buildApp().request(jsonReq('POST', '/auth/apple', body()), undefined, BASE_ENV);
    const json = await res.json();

    expect(json.user.email).toBe('real@example.com');
    expect(json.user.email).not.toContain('@apple.local');

    // JWT payload 에도 같은 값이 실려야 한다 — 앱은 둘 중 아무거나 읽을 수 있다.
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(json.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
          (ch) => ch.charCodeAt(0),
        ),
      ),
    );
    expect(payload.email).toBe('real@example.com');
  });

  it('저장된 이메일도 합성값이면 그대로 둔다 — 처음부터 숨긴 계정이다', async () => {
    appleEmail = undefined;
    pushExistingUser(`${APPLE_SUB}@apple.local`);
    pushTail();

    const res = await buildApp().request(jsonReq('POST', '/auth/apple', body()), undefined, BASE_ENV);
    const json = await res.json();

    expect(json.user.email).toBe(`${APPLE_SUB}@apple.local`);
  });

  it('신규 가입은 애플이 준 이메일을 쓴다', async () => {
    appleEmail = 'new@example.com';
    mockDB.pushResult([]); // 기존 사용자 없음
    mockDB.pushResult([], 1); // INSERT users
    pushTail();

    const res = await buildApp().request(jsonReq('POST', '/auth/apple', body()), undefined, BASE_ENV);
    const json = await res.json();

    expect(json.user.email).toBe('new@example.com');
  });
});
