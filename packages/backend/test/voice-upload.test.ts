import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware } from './helpers';
import { resetSharedInMemoryVoiceStorage } from '@alarmtalk/voice';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import voiceUpload from '../src/routes/voice-upload';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'test-key',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/vu', voiceUpload);
  return app;
}

function authWithResolvedPk(userId = 'user-1', userPk = 'user-pk-1') {
  return async (c: Context<AppEnv>, next: Next) => {
    c.set('userId', userId);
    c.set('userIdPK', userPk);
    c.set('userEmail', 'user@test.com');
    c.set('userName', 'Test User');
    await next();
  };
}

function buildAppWithResolvedPk(userId = 'user-1', userPk = 'user-pk-1') {
  const app = new Hono<AppEnv>();
  app.use('*', authWithResolvedPk(userId, userPk));
  app.route('/vu', voiceUpload);
  return app;
}

function req(app: Hono<AppEnv>, r: Request) {
  return app.request(r, undefined, ENV);
}

function uploadForm(
  opts: {
    audio?: { bytes: Uint8Array; type: string; name?: string } | null;
    fields?: Record<string, string>;
  } = {},
): Request {
  const form = new FormData();
  if (opts.audio) {
    const blob = new Blob([opts.audio.bytes], { type: opts.audio.type });
    form.append('audio', blob, opts.audio.name ?? 'sample.mp3');
  }
  if (opts.fields) {
    for (const [k, v] of Object.entries(opts.fields)) {
      form.append(k, v);
    }
  }
  return new Request('http://localhost/vu/upload', { method: 'POST', body: form });
}

beforeEach(() => {
  mockDB.reset();
  resetSharedInMemoryVoiceStorage();
});

/* ------------------------------------------------------------------ */
/*  POST /vu/upload — 오디오 업로드                                     */
/* ------------------------------------------------------------------ */
describe('POST /upload — 오디오 업로드 (voice-upload)', () => {
  it('계정 행을 못 찾으면 업로드를 막는다 — 유료 게이트는 fail-closed', async () => {
    // 예전에는 hasPaidVoiceAccess 가 `if (!resolvedUserPk) return true` 로 식별자를
    // 해석하지 못하면 게이트를 통째로 열었다. 지금은 플랜 조회가 0행이면 막는다.
    mockDB.pushResult([]); // SELECT plan FROM users → 계정 행 없음
    const res = await req(
      buildApp(),
      uploadForm({
        audio: { bytes: new Uint8Array([1, 2, 3, 4]), type: 'audio/wav', name: 'my.wav' },
        fields: { durationMs: '90000' },
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
  });

  it('정상 업로드 → 201 + 메타데이터', async () => {
    // fakeAuthMiddleware 가 userIdPK 를 채우면서 hasPaidVoiceAccess 의 플랜 조회가
    // 실제로 실행된다 — 유료 플랜 행을 INSERT 결과보다 먼저 큐에 넣어 준다.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([], 1);
    const res = await req(
      buildApp(),
      uploadForm({
        audio: { bytes: new Uint8Array([1, 2, 3, 4]), type: 'audio/wav', name: 'my.wav' },
        fields: { durationMs: '90000', originalName: '녹음파일.wav' },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.upload.mimeType).toBe('audio/wav');
    expect(body.upload.sizeBytes).toBe(4);
    expect(body.upload.durationMs).toBe(90000);
    expect(body.upload.originalName).toBe('녹음파일.wav');
    expect(body.upload.objectKey).toContain('mem://');
  });

  it('blocks upload before storage when voice_biometric consent is missing', async () => {
    mockDB.setConsentMissing(true);
    // 동의 조회에 도달하려면 먼저 플랜 게이트를 통과해야 한다(userIdPK 가 채워져
    // 플랜 조회가 실행됨) — 유료 플랜 행 → 빈 동의 행 순서로 큐를 채운다.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([]);

    const res = await req(
      buildApp(),
      uploadForm({
        audio: { bytes: new Uint8Array([1, 2, 3, 4]), type: 'audio/wav', name: 'my.wav' },
        fields: { durationMs: '90000' },
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('CONSENT_REQUIRED');
    expect(body.consent).toBe('voice_biometric');
    expect(mockDB.calls.some((call) => call.sql.includes('INSERT INTO voice_uploads'))).toBe(false);
  });

  it('returns paid-plan error before sensitive consent for free upload users', async () => {
    mockDB.setConsentMissing(true);
    mockDB.pushResult([{ plan: 'free' }]);

    const res = await req(
      buildAppWithResolvedPk(),
      uploadForm({
        audio: { bytes: new Uint8Array([1, 2, 3, 4]), type: 'audio/wav', name: 'my.wav' },
        fields: { durationMs: '90000' },
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
    expect(body.consent).toBeUndefined();
    expect(mockDB.calls.some((call) => /FROM user_consents/i.test(call.sql))).toBe(false);
    expect(mockDB.calls.some((call) => call.sql.includes('INSERT INTO voice_uploads'))).toBe(false);
  });

  it('audio 파일 누락 → 400', async () => {
    const form = new FormData();
    const res = await req(
      buildApp(),
      new Request('http://localhost/vu/upload', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUDIO_FILE_REQUIRED');
  });

  it('MIME 이 audio/* 아니면 → 415', async () => {
    const res = await req(
      buildApp(),
      uploadForm({ audio: { bytes: new Uint8Array([1]), type: 'image/png', name: 'fake.png' } }),
    );
    expect(res.status).toBe(415);
    expect((await res.json()).error_code).toBe('INVALID_AUDIO_MIME_TYPE');
  });

  it('빈 파일 → 400', async () => {
    const res = await req(
      buildApp(),
      uploadForm({ audio: { bytes: new Uint8Array([]), type: 'audio/mp3' } }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUDIO_FILE_EMPTY');
  });

  it('25 MiB 초과 → 413', async () => {
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    const res = await req(buildApp(), uploadForm({ audio: { bytes: big, type: 'audio/wav' } }));
    expect(res.status).toBe(413);
    expect((await res.json()).error_code).toBe('AUDIO_FILE_TOO_LARGE');
  });

  it('25 MiB 정확히 → 통과', async () => {
    // 플랜 조회가 INSERT 앞에서 큐를 소비한다 — 유료 플랜 행 선행 push.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([], 1);
    const exact = new Uint8Array(25 * 1024 * 1024);
    exact[0] = 1;
    const res = await req(
      buildApp(),
      uploadForm({
        audio: { bytes: exact, type: 'audio/wav' },
        fields: { durationMs: '90000' },
      }),
    );
    expect(res.status).toBe(201);
  });

  it('durationMs 0 → 400', async () => {
    const res = await req(
      buildApp(),
      uploadForm({
        audio: { bytes: new Uint8Array([1]), type: 'audio/wav' },
        fields: { durationMs: '0' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_DURATION');
  });

  it('durationMs 음수 → 400', async () => {
    const res = await req(
      buildApp(),
      uploadForm({
        audio: { bytes: new Uint8Array([1]), type: 'audio/wav' },
        fields: { durationMs: '-100' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_DURATION');
  });

  it('durationMs 문자열 → 400', async () => {
    const res = await req(
      buildApp(),
      uploadForm({
        audio: { bytes: new Uint8Array([1]), type: 'audio/wav' },
        fields: { durationMs: 'abc' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_DURATION');
  });

  it('durationMs 생략 시 400', async () => {
    const res = await req(
      buildApp(),
      uploadForm({ audio: { bytes: new Uint8Array([1, 2]), type: 'audio/wav' } }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_DURATION');
  });

  it('1분 미만 durationMs 는 400', async () => {
    const res = await req(
      buildApp(),
      uploadForm({
        audio: { bytes: new Uint8Array([1, 2]), type: 'audio/wav' },
        fields: { durationMs: '59999' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUDIO_DURATION_TOO_SHORT');
  });

  it('2분에서 5초 이내 durationMs 오차는 허용', async () => {
    // 플랜 조회가 INSERT 앞에서 큐를 소비한다 — 유료 플랜 행 선행 push.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([], 1);
    const res = await req(
      buildApp(),
      uploadForm({
        audio: { bytes: new Uint8Array([1, 2]), type: 'audio/wav' },
        fields: { durationMs: '125000' },
      }),
    );
    expect(res.status).toBe(201);
  });

  it('2분 5초를 넘는 durationMs 는 400', async () => {
    const res = await req(
      buildApp(),
      uploadForm({
        audio: { bytes: new Uint8Array([1, 2]), type: 'audio/wav' },
        fields: { durationMs: '125001' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUDIO_DURATION_TOO_LONG');
  });

  it('originalName 200자 초과 시 잘림', async () => {
    // 플랜 조회가 INSERT 앞에서 큐를 소비한다 — 유료 플랜 행 선행 push.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([], 1);
    const longName = 'a'.repeat(250);
    const res = await req(
      buildApp(),
      uploadForm({
        audio: { bytes: new Uint8Array([1]), type: 'audio/wav' },
        fields: { durationMs: '90000', originalName: longName },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.upload.originalName.length).toBe(200);
  });

  it('originalName 생략 시 파일명 사용', async () => {
    // 플랜 조회가 INSERT 앞에서 큐를 소비한다 — 유료 플랜 행 선행 push.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([], 1);
    const res = await req(
      buildApp(),
      uploadForm({
        audio: { bytes: new Uint8Array([1]), type: 'audio/wav', name: 'voice.wav' },
        fields: { durationMs: '90000' },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.upload.originalName).toBe('voice.wav');
  });

  it('DB INSERT 에 올바른 값 전달', async () => {
    // 플랜 조회가 INSERT 앞에서 큐를 소비한다 — 유료 플랜 행 선행 push.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([], 1);
    await req(
      buildApp('user-X'),
      uploadForm({
        audio: { bytes: new Uint8Array([10, 20]), type: 'audio/mpeg' },
        fields: { durationMs: '90000' },
      }),
    );
    // calls[0] 은 이제 플랜 조회(SELECT plan FROM users), INSERT 는 calls[1] 로 밀린다.
    expect(mockDB.calls[0]!.sql).toContain('SELECT plan FROM users');
    const insertCall = mockDB.calls[1]!;
    expect(insertCall.sql).toContain('INSERT INTO voice_uploads');
    expect(insertCall.args[1]).toBe('user-X');
    expect(insertCall.args[3]).toBe('audio/mpeg');
    expect(insertCall.args[4]).toBe(2);
    expect(insertCall.args[5]).toBe(90000);
  });
});

