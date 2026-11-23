// **유료 판정은 `users.plan` 하나다**(2026-11-23 — 기간 한정 개인 플랜·관리자 기간 지급을 없앴다. 플러스를 무료로 얻는
// 길은 스토어의 1개월 무료 체험뿐이고, 그것도 스토어 구독이라 `users.plan` 을 올리는 같은 흐름이다).
//
// 실제 libsql 파일 DB 에 전체 마이그레이션을 올리고 실제 라우트를 부른다. 목소리 등록 게이트(초안 만들기·승격·교체·
// 제자리 교체·응원 보충)와 내 목소리 합성·오디오, 직접 입력 한도가 무료(`free`)에는 닫히고 플러스에는 열리는지 본다.
// 결제 보류(구독 행은 남고 등급만 free 로 회수된 계정)도 무료다.
//
// 게이트를 **통과했다** 는 증거는 다음 게이트(생체정보 동의)에서 멈추는 것이다 — 픽스처에 동의가 없다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

let db: Client;
vi.mock('../src/lib/db', () => ({ getDB: () => db }));

const { default: voiceProfile, replaceVoiceInPlace } = await import('../src/routes/voice-profile');
const { default: tts } = await import('../src/routes/tts');

const DIR = mkdtempSync(join(tmpdir(), 'alarmtalk-paid-voice-gates-'));
const PERSONAL = '70000000-0000-4000-8000-000000000002';

const ENV = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'production',
} as unknown as Env;

/** 공식 목소리 하나와 초안 하나가 있는 무료 계정 — 교체·응원 보충의 대상이 있다. */
const FREE = 'pg-free';
/** 공식 목소리가 아직 없는 무료 계정 — 승격이 등록 개수 한도에 먼저 걸리지 않는다. */
const FREE_NEW = 'pg-free-new';
const PAID = 'pg-paid';
/** 결제 보류 — 개인 구독 행이 `suspended` 로 남고 `users.plan` 만 free 로 회수된 상태. */
const HOLD = 'pg-hold';

const VP_FREE = '11111111-1111-4111-8111-000000000001';
const VP_FREE_DRAFT = '11111111-1111-4111-8111-000000000002';
const VP_PAID = '11111111-1111-4111-8111-000000000003';
const VP_FREE_NEW_DRAFT = '11111111-1111-4111-8111-000000000005';
const VP_PAID_DRAFT = '11111111-1111-4111-8111-000000000006';
const MSG_FREE = '22222222-2222-4222-8222-000000000001';
const MSG_PAID = '22222222-2222-4222-8222-000000000002';

const PAID_REQUIRED = 'VOICE_FEATURE_REQUIRES_PAID_PLAN';
const PASSED = 'CONSENT_REQUIRED';

function appFor(userPk: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', userPk);
    c.set('userIdPK', userPk);
    c.set('userLoginId', userPk);
    await next();
  });
  app.route('/voice', voiceProfile);
  app.route('/tts', tts);
  return app;
}

async function call(userPk: string, method: string, path: string, body?: Record<string, unknown> | FormData) {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await appFor(userPk).request(new Request(`http://localhost${path}`, init), undefined, ENV);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: json };
}

function draftForm(): FormData {
  const form = new FormData();
  form.set('isDraft', 'true');
  return form;
}

function expectGate(res: { status: number; body: Record<string, unknown> }, open: boolean) {
  expect(res.status).toBe(403);
  expect(res.body.error_code).toBe(open ? PASSED : PAID_REQUIRED);
}

beforeAll(async () => {
  db = createClient({ url: `file:${join(DIR, 'gates.db')}` });
  await runMigrations(db);
  await db.batch([
    `INSERT INTO users (id, email, plan) VALUES ('${FREE}', 'free@t.test', 'free')`,
    `INSERT INTO users (id, email, plan) VALUES ('${FREE_NEW}', 'new@t.test', 'free')`,
    `INSERT INTO users (id, email, plan) VALUES ('${PAID}', 'paid@t.test', 'plus')`,
    `INSERT INTO users (id, email, plan) VALUES ('${HOLD}', 'hold@t.test', 'free')`,
    `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
     VALUES ('sub-paid', '${PAID}', '${PERSONAL}', 'active', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`,
    `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, entitlement_state)
     VALUES ('sub-hold', '${HOLD}', '${PERSONAL}', 'active', '2026-08-01T00:00:00Z', '2099-01-01T00:00:00Z', 'suspended')`,
    `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft, previewed_at, preview_language)
     VALUES ('${VP_FREE}', '${FREE}', '내 목소리', 'ready', 'el-free', 0, datetime('now'), 'ko')`,
    `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft, previewed_at, preview_language)
     VALUES ('${VP_FREE_DRAFT}', '${FREE}', '새 목소리', 'ready', 'el-free-2', 1, datetime('now'), 'ko')`,
    `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft, previewed_at, preview_language)
     VALUES ('${VP_FREE_NEW_DRAFT}', '${FREE_NEW}', '첫 목소리', 'ready', 'el-new', 1, datetime('now'), 'ko')`,
    `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft, previewed_at, preview_language)
     VALUES ('${VP_PAID}', '${PAID}', '유료 목소리', 'ready', 'el-paid', 0, datetime('now'), 'ko')`,
    `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft, previewed_at, preview_language)
     VALUES ('${VP_PAID_DRAFT}', '${PAID}', '유료 새 목소리', 'ready', 'el-paid-2', 1, datetime('now'), 'ko')`,
    `INSERT INTO messages (id, user_id, voice_profile_id, text, category, is_preset, audio_url)
     VALUES ('${MSG_FREE}', '${FREE}', '${VP_FREE}', '일어나', 'custom', 0, NULL)`,
    `INSERT INTO messages (id, user_id, voice_profile_id, text, category, is_preset, audio_url)
     VALUES ('${MSG_PAID}', '${PAID}', '${VP_PAID}', '일어나', 'custom', 0, NULL)`,
  ]);
});

afterAll(() => {
  db.close();
  rmSync(DIR, { recursive: true, force: true });
});

describe('목소리 등록 게이트 — 무료는 403, 플러스는 통과', () => {
  it('초안 만들기(POST /voice/clone)', async () => {
    expectGate(await call(FREE, 'POST', '/voice/clone', draftForm()), false);
    expectGate(await call(HOLD, 'POST', '/voice/clone', draftForm()), false);
    expectGate(await call(PAID, 'POST', '/voice/clone', draftForm()), true);
  });

  it('초안 승격(PATCH /voice/:id is_draft=false)', async () => {
    expectGate(await call(FREE_NEW, 'PATCH', `/voice/${VP_FREE_NEW_DRAFT}`, { is_draft: false }), false);
  });

  it('교체 승격(replace_existing)', async () => {
    expectGate(
      await call(FREE, 'PATCH', `/voice/${VP_FREE_DRAFT}`, { is_draft: false, replace_existing: true }),
      false,
    );
    expectGate(
      await call(PAID, 'PATCH', `/voice/${VP_PAID_DRAFT}`, { is_draft: false, replace_existing: true }),
      true,
    );
  });

  it('제자리 교체(replaceVoiceInPlace)', async () => {
    const free = await replaceVoiceInPlace(db as never, {
      targetUserIds: [FREE],
      draftProfileId: VP_FREE_DRAFT,
      language: 'ko',
      ownerPk: FREE,
      loginId: FREE,
    });
    expect(free.ok).toBe(false);
    if (!free.ok) expect(free.errorCode).toBe(PAID_REQUIRED);
    const paid = await replaceVoiceInPlace(db as never, {
      targetUserIds: [PAID],
      draftProfileId: VP_PAID_DRAFT,
      language: 'ko',
      ownerPk: PAID,
      loginId: PAID,
    });
    expect(paid.ok).toBe(false);
    if (!paid.ok) expect(paid.errorCode).toBe(PASSED);
  });

  it('응원 보충(POST /voice/:id/content-supplement)', async () => {
    const free = await call(FREE, 'POST', `/voice/${VP_FREE}/content-supplement`, { theme: 'cheer' });
    expect(free.status).toBe(403);
    expect(free.body.error_code).toBe(PAID_REQUIRED);
    const paid = await call(PAID, 'POST', `/voice/${VP_PAID}/content-supplement`, { theme: 'cheer' });
    expect(paid.body.error_code).not.toBe(PAID_REQUIRED);
  });
});

describe('내 목소리 합성·오디오와 직접 입력 한도', () => {
  it('/tts/generate — 무료의 내 목소리 직접 입력은 403, 플러스는 통과', async () => {
    const body = { voice_profile_id: VP_FREE, text: '일어나', category: 'custom' };
    expectGate(await call(FREE, 'POST', '/tts/generate', body), false);
    expectGate(await call(PAID, 'POST', '/tts/generate', { ...body, voice_profile_id: VP_PAID }), true);
  });

  it('내 목소리 오디오 — 무료는 잠기고, 플러스는 통과한다(오디오가 없어 404)', async () => {
    const free = await call(FREE, 'GET', `/tts/messages/${MSG_FREE}/audio`);
    expect(free.status).toBe(403);
    expect(free.body.error_code).toBe('VOICE_LOCKED_FREE_PLAN');
    const paid = await call(PAID, 'GET', `/tts/messages/${MSG_PAID}/audio`);
    expect(paid.status).toBe(404);
    expect(paid.body.error_code).toBe('MESSAGE_AUDIO_MISSING');
  });

  it('직접 입력 한도 — 무료·결제 보류는 3, 플러스는 30', async () => {
    for (const user of [FREE, HOLD]) {
      const res = await call(user, 'GET', '/tts/manual-quota');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ plan_key: 'free', limit: 3 });
    }
    const paid = await call(PAID, 'GET', '/tts/manual-quota');
    expect(paid.body).toMatchObject({ plan_key: 'personal', limit: 30 });
  });
});
