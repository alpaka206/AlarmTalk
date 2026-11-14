// 카카오 연결 해제 웹훅(2026-11-14) — 카카오가 보낸 것만 받는가(대표 어드민 키), 카카오로만 가입한 계정만 탈퇴 유예로
// 두는가, 회원번호를 지우지 않는가, 카카오 규칙대로 언제나 200 인가. 규칙: docs/spec/session-and-auth.md 「카카오 로그인」.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-kakao-unlink-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
const sendAccountDeletionRequestedPush = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/lib/fcm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/fcm')>()),
  sendAccountDeletionRequestedPush,
}));

import kakaoWebhook from '../src/routes/kakao-webhook';
import { requestAccountDeletion } from '../src/lib/account-deletion';

const ADMIN_KEY = 'admin-key-for-test';
const ENV = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'test',
  KAKAO_APP_ID: '1500680',
  KAKAO_ADMIN_KEY: ADMIN_KEY,
} as Env;

function buildApp() {
  const app = new Hono<AppEnv>();
  app.route('/kakao', kakaoWebhook);
  return app;
}

const waited: Promise<unknown>[] = [];
const EXECUTION_CTX = {
  waitUntil: (p: Promise<unknown>) => waited.push(p),
  passThroughOnException: () => undefined,
  props: {},
} as never;

/** 응답을 받은 뒤 `waitUntil` 로 넘긴 처리까지 끝나기를 기다린다 — 처리는 응답 뒤에 돈다(코덱스 #994). */
async function settled(response: Promise<Response>) {
  const res = await response;
  await Promise.all(waited);
  return res;
}

function getUnlink(params: Record<string, string>, auth = `KakaoAK ${ADMIN_KEY}`, env: Env = ENV) {
  const query = new URLSearchParams(params).toString();
  return settled(buildApp().request(`/kakao/unlink?${query}`, { headers: { Authorization: auth } }, env, EXECUTION_CTX));
}

function postUnlink(params: Record<string, string>) {
  return settled(
    buildApp().request(
      '/kakao/unlink',
      {
        method: 'POST',
        headers: { Authorization: `KakaoAK ${ADMIN_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      },
      ENV,
      EXECUTION_CTX,
    ),
  );
}

async function user(id: string) {
  const r = await db.execute({
    sql: 'SELECT kakao_id, deletion_status, deletion_purge_at, token_epoch FROM users WHERE id = ?',
    args: [id],
  });
  return r.rows[0]!;
}

beforeAll(async () => {
  await runMigrations(db);
});
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  waited.length = 0;
  sendAccountDeletionRequestedPush.mockClear();
  await db.execute("DELETE FROM push_tokens WHERE user_id IN ('kakao-only','kakao-and-email')");
  await db.execute("DELETE FROM users WHERE id IN ('kakao-only','kakao-and-email')");
  await db.execute(`INSERT INTO users (id, kakao_id, email) VALUES ('kakao-only', '111', '111@kakao.local')`);
  await db.execute(
    `INSERT INTO users (id, kakao_id, email, password_hash) VALUES ('kakao-and-email', '222', 'person@example.test', 'hash')`,
  );
  await db.execute(`INSERT INTO push_tokens (id, user_id, token, platform) VALUES ('p1', 'kakao-only', 'tok-kakao', 'android')`);
});

describe('카카오 연결 해제 웹훅 — 카카오가 보낸 것만 받는다', () => {
  it('어드민 키가 다르면 401 이고 아무것도 바꾸지 않는다', async () => {
    const res = await getUnlink({ app_id: '1500680', user_id: '111', referrer_type: 'UNLINK_FROM_APPS' }, 'KakaoAK wrong');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('KAKAO_WEBHOOK_UNAUTHORIZED');
    expect((await user('kakao-only')).deletion_status).toBe('active');
  });

  it('어드민 키가 설정돼 있지 않으면 확인할 수 없으니 바꾸지 않고 200 으로 답한다(카카오 규칙)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await getUnlink(
      { app_id: '1500680', user_id: '111', referrer_type: 'UNLINK_FROM_APPS' },
      `KakaoAK ${ADMIN_KEY}`,
      { ...ENV, KAKAO_ADMIN_KEY: undefined } as unknown as Env,
    );
    expect(res.status).toBe(200);
    expect((await user('kakao-only')).deletion_status).toBe('active');
  });

  it('다른 앱의 해제는 200 으로 흘려보내고 바꾸지 않는다', async () => {
    const res = await getUnlink({ app_id: '999', user_id: '111', referrer_type: 'UNLINK_FROM_APPS' });
    expect(res.status).toBe(200);
    expect((await user('kakao-only')).deletion_status).toBe('active');
  });
});

describe('카카오 연결 해제 웹훅 — 계정에 하는 일', () => {
  it('카카오로만 가입한 계정은 탈퇴 유예가 되고 세션·푸시 등록이 끊긴다 — 회원번호는 그대로 둔다', async () => {
    const before = Number((await user('kakao-only')).token_epoch);
    const res = await getUnlink({ app_id: '1500680', user_id: '111', referrer_type: 'UNLINK_FROM_APPS' });
    expect(res.status).toBe(200);
    await Promise.all(waited);

    const after = await user('kakao-only');
    expect(after.deletion_status).toBe('pending_deletion');
    expect(after.deletion_purge_at).not.toBeNull();
    expect(Number(after.token_epoch)).toBe(before + 1);
    // 다시 로그인하면 같은 계정으로 돌아와야 한다 — 회원번호를 지우면 합성 주소가 겹쳐 새 계정도 못 만든다.
    expect(after.kakao_id).toBe('111');
    const tokens = await db.execute("SELECT token FROM push_tokens WHERE user_id = 'kakao-only'");
    expect(tokens.rows).toHaveLength(0);
    expect(sendAccountDeletionRequestedPush).toHaveBeenCalledTimes(1);
  });

  it('카카오계정 탈퇴(POST 폼 본문)도 같은 처리다', async () => {
    const res = await postUnlink({ app_id: '1500680', user_id: '111', referrer_type: 'ACCOUNT_DELETE' });
    expect(res.status).toBe(200);
    expect((await user('kakao-only')).deletion_status).toBe('pending_deletion');
  });

  it('다른 로그인 수단(비밀번호)이 있는 계정은 바꾸지 않는다', async () => {
    const before = await user('kakao-and-email');
    const res = await getUnlink({ app_id: '1500680', user_id: '222', referrer_type: 'UNLINK_FROM_APPS' });
    expect(res.status).toBe(200);
    const after = await user('kakao-and-email');
    expect(after.deletion_status).toBe('active');
    expect(after.token_epoch).toBe(before.token_epoch);
    expect(after.kakao_id).toBe('222');
  });

  it('이미 탈퇴 유예면 기한을 미루지 않는다', async () => {
    await db.execute(
      "UPDATE users SET deletion_status = 'pending_deletion', deletion_purge_at = '2026-12-01T00:00:00.000Z' WHERE id = 'kakao-only'",
    );
    const res = await getUnlink({ app_id: '1500680', user_id: '111', referrer_type: 'UNLINK_FROM_APPS' });
    expect(res.status).toBe(200);
    expect((await user('kakao-only')).deletion_purge_at).toBe('2026-12-01T00:00:00.000Z');
  });

  it('처리를 기다리지 않고 먼저 200 으로 답한다 — 처리는 waitUntil 로 응답 뒤에 끝난다(카카오 3초 규칙)', async () => {
    const query = new URLSearchParams({ app_id: '1500680', user_id: '111', referrer_type: 'UNLINK_FROM_APPS' }).toString();
    const res = await buildApp().request(
      `/kakao/unlink?${query}`,
      { headers: { Authorization: `KakaoAK ${ADMIN_KEY}` } },
      ENV,
      EXECUTION_CTX,
    );
    expect(res.status).toBe(200);
    expect(waited).toHaveLength(1);
    await Promise.all(waited);
    expect((await user('kakao-only')).deletion_status).toBe('pending_deletion');
  });

  it('쓰기 문장이 조건을 다시 본다 — 읽은 뒤 다른 로그인 수단이 붙은 계정은 유예로 넘기지 않는다(코덱스 #994)', async () => {
    // 웹훅이 읽은 뒤 구글 로그인이 같은 이메일로 붙은 상황을 흉내 낸다.
    await db.execute("UPDATE users SET google_id = 'google-sub' WHERE id = 'kakao-only'");
    const request = await requestAccountDeletion(db, 'kakao-only', new Date(), { onlyIfKakaoOnlyActive: true });
    expect(request.requested).toBe(false);
    expect((await user('kakao-only')).deletion_status).toBe('active');
    // 비밀번호가 있는 계정·이미 유예인 계정도 같다.
    expect((await requestAccountDeletion(db, 'kakao-and-email', new Date(), { onlyIfKakaoOnlyActive: true })).requested).toBe(false);
  });

  it('모르는 회원번호도 200 이다', async () => {
    const res = await getUnlink({ app_id: '1500680', user_id: '999999', referrer_type: 'UNLINK_FROM_APPS' });
    expect(res.status).toBe(200);
  });
});

describe('카카오 연결 해제 웹훅 — 전역 IP 한도', () => {
  it('공용 IP 버킷(300)에서 빠지고 전용 버킷이 센다 — 카카오는 해제를 다시 보내 주지 않는다(코덱스 #994)', async () => {
    const { ipRateLimitMiddleware, kakaoWebhookRateLimitMiddleware } = await import('../src/middleware/rateLimit');
    const app = new Hono();
    app.use('*', ipRateLimitMiddleware);
    app.use('/api/kakao/*', kakaoWebhookRateLimitMiddleware);
    app.on(['GET', 'POST'], '/api/kakao/unlink', (c) => c.text('ok'));
    app.get('/api/other', (c) => c.text('ok'));
    const headers = { 'cf-connecting-ip': '203.0.113.77' };
    for (let i = 0; i < 301; i++) {
      const method = i % 2 === 0 ? 'GET' : 'POST';
      expect((await app.request('/api/kakao/unlink', { method, headers })).status).toBe(200);
    }
    // 같은 IP 의 다른 공개 요청은 여전히 공용 버킷에 묶인다(웹훅이 그 버킷을 쓰지 않았다).
    expect((await app.request('/api/other', { headers })).status).toBe(200);
  });
});
