import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware } from './helpers';
import { getSharedInMemoryVoiceStorage, resetSharedInMemoryVoiceStorage } from '@alarmtalk/voice';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';

const UPLOAD_ID = '50000000-0000-4000-8000-000000000001';
const SPEAKER_ID = '60000000-0000-4000-8000-000000000001';
const UUID_BAD = 'not-a-uuid';

const mockDB = createMockDB();
const mockDiarize = vi.fn();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

vi.mock('../src/lib/elevenlabs', () => ({
  ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.diarize = mockDiarize;
  }),
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
    c.set('userPicture', '');
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

async function storeTestVoiceObject(
  userId = 'user-1',
  mimeType = 'audio/wav',
  originalName = 'sample.wav',
): Promise<string> {
  const meta = await getSharedInMemoryVoiceStorage().store({
    userId,
    bytes: new Uint8Array([1, 2, 3, 4]),
    mimeType,
    durationMs: 90_000,
    originalName,
  });
  return meta.objectKey;
}

function diarizationResult(count = 3) {
  return {
    speakers: Array.from({ length: count }, (_, index) => ({
      speaker_id: `speaker-${index + 1}`,
      segments: [{ start: index, end: index + 0.75 }],
    })),
  };
}

function consentRow(type: string) {
  return { consent_type: type, policy_version: CURRENT_POLICY_VERSION, agreed: 1 };
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
  mockDiarize.mockReset();
});

it('저장된 mp3 MIME 과 파일명을 ElevenLabs diarize 로 전달', async () => {
  const objectKey = await storeTestVoiceObject('user-1', 'audio/mpeg', 'voice.mp3');
  mockDiarize.mockResolvedValueOnce(diarizationResult());
  mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'user-1', object_key: objectKey }]);
  mockDB.pushResult([], 0);
  mockDB.pushResult([], 1);
  mockDB.pushResult([], 1);
  mockDB.pushResult([], 1);

  const res = await req(
    buildApp(),
    new Request(`http://localhost/vu/uploads/${UPLOAD_ID}/separate`, { method: 'POST' }),
  );

  expect(res.status).toBe(201);
  expect(mockDiarize).toHaveBeenCalledOnce();
  const [, optionsArg] = mockDiarize.mock.calls[0]! as [
    ArrayBuffer,
    { mimeType?: string; fileName?: string; numSpeakers?: number },
  ];
  expect(optionsArg).toEqual({
    mimeType: 'audio/mpeg',
    fileName: 'voice.mp3',
    numSpeakers: 3,
  });
});

/* ------------------------------------------------------------------ */
/*  POST /vu/upload — 오디오 업로드                                     */
/* ------------------------------------------------------------------ */
describe('POST /upload — 오디오 업로드 (voice-upload)', () => {
  it('정상 업로드 → 201 + 메타데이터', async () => {
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
    mockDB.pushResult([], 1);
    await req(
      buildApp('user-X'),
      uploadForm({
        audio: { bytes: new Uint8Array([10, 20]), type: 'audio/mpeg' },
        fields: { durationMs: '90000' },
      }),
    );
    const insertCall = mockDB.calls[0]!;
    expect(insertCall.sql).toContain('INSERT INTO voice_uploads');
    expect(insertCall.args[1]).toBe('user-X');
    expect(insertCall.args[3]).toBe('audio/mpeg');
    expect(insertCall.args[4]).toBe(2);
    expect(insertCall.args[5]).toBe(90000);
  });
});

/* ------------------------------------------------------------------ */
/*  POST /vu/uploads/:id/separate — 화자 분리                          */
/* ------------------------------------------------------------------ */
describe('POST /uploads/:id/separate — 화자 분리 (voice-upload)', () => {
  it('잘못된 UUID → 400', async () => {
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vu/uploads/${UUID_BAD}/separate`, { method: 'POST' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_UPLOAD_ID');
  });

  it('업로드 없으면 404', async () => {
    mockDB.pushResult([]);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vu/uploads/${UPLOAD_ID}/separate`, { method: 'POST' }),
    );
    expect(res.status).toBe(404);
  });

  it('타인 소유 → 403', async () => {
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'other-user', object_key: 'mem://x' }]);
    const res = await req(
      buildApp('user-1'),
      new Request(`http://localhost/vu/uploads/${UPLOAD_ID}/separate`, { method: 'POST' }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('FORBIDDEN');
  });

  it('정상 화자 분리 → 201 + speakers + provider', async () => {
    const objectKey = await storeTestVoiceObject();
    mockDiarize.mockResolvedValueOnce(diarizationResult());
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'user-1', object_key: objectKey }]);
    mockDB.pushResult([], 0); // DELETE old speakers
    mockDB.pushResult([], 1); // INSERT speaker 1
    mockDB.pushResult([], 1); // INSERT speaker 2
    mockDB.pushResult([], 1); // INSERT speaker 3
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vu/uploads/${UPLOAD_ID}/separate`, { method: 'POST' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.speakers.length).toBeGreaterThanOrEqual(1);
    expect(body.speakers.length).toBeLessThanOrEqual(3);
    expect(body.provider).toBe('elevenlabs');
    expect(body.speakers[0].label).toMatch(/^화자 \d+$/);
  });

  it('blocks stored-upload diarization when overseas_transfer consent is missing', async () => {
    const objectKey = await storeTestVoiceObject();
    mockDB.setConsentMissing(true);
    mockDiarize.mockResolvedValueOnce(diarizationResult());
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'user-1', object_key: objectKey }]);
    mockDB.pushResult([consentRow('voice_biometric')]);

    const res = await req(
      buildApp(),
      new Request(`http://localhost/vu/uploads/${UPLOAD_ID}/separate`, { method: 'POST' }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('CONSENT_REQUIRED');
    expect(body.consent).toBe('overseas_transfer');
    expect(mockDiarize).not.toHaveBeenCalled();
  });

  it('기존 화자 DELETE 후 새 INSERT (멱등성)', async () => {
    const objectKey = await storeTestVoiceObject();
    mockDiarize.mockResolvedValueOnce(diarizationResult());
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'user-1', object_key: objectKey }]);
    mockDB.pushResult([], 2); // DELETE old
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    await req(
      buildApp(),
      new Request(`http://localhost/vu/uploads/${UPLOAD_ID}/separate`, { method: 'POST' }),
    );
    const deleteCall = mockDB.calls[1]!;
    expect(deleteCall.sql).toContain('DELETE FROM voice_speakers');
    expect(deleteCall.args).toContain(UPLOAD_ID);
  });
});

/* ------------------------------------------------------------------ */
/*  GET /vu/uploads/:id/speakers — 화자 목록                           */
/* ------------------------------------------------------------------ */
describe('GET /uploads/:id/speakers — 화자 목록 (voice-upload)', () => {
  it('잘못된 UUID → 400', async () => {
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vu/uploads/${UUID_BAD}/speakers`),
    );
    expect(res.status).toBe(400);
  });

  it('업로드 없으면 404', async () => {
    mockDB.pushResult([]);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vu/uploads/${UPLOAD_ID}/speakers`),
    );
    expect(res.status).toBe(404);
  });

  it('타인 소유 → 403', async () => {
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'other' }]);
    const res = await req(
      buildApp('user-1'),
      new Request(`http://localhost/vu/uploads/${UPLOAD_ID}/speakers`),
    );
    expect(res.status).toBe(403);
  });

  it('자기 업로드의 화자 목록 반환 (start_ms 정렬)', async () => {
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'user-1' }]);
    mockDB.pushResult([
      {
        id: 's1',
        upload_id: UPLOAD_ID,
        label: '화자 1',
        start_ms: 0,
        end_ms: 5000,
        confidence: 0.9,
        created_at: '2026-01-01',
      },
      {
        id: 's2',
        upload_id: UPLOAD_ID,
        label: '화자 2',
        start_ms: 5000,
        end_ms: 10000,
        confidence: 0.85,
        created_at: '2026-01-01',
      },
    ]);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vu/uploads/${UPLOAD_ID}/speakers`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.speakers).toHaveLength(2);
    expect(body.speakers[0].label).toBe('화자 1');
    expect(body.speakers[1].start_ms).toBe(5000);
  });

  it('화자 없으면 빈 배열', async () => {
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'user-1' }]);
    mockDB.pushResult([]);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vu/uploads/${UPLOAD_ID}/speakers`),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).speakers).toEqual([]);
  });

  it('쿼리에 ORDER BY start_ms ASC 포함', async () => {
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'user-1' }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request(`http://localhost/vu/uploads/${UPLOAD_ID}/speakers`));
    expect(mockDB.calls[1]!.sql).toContain('ORDER BY start_ms ASC');
  });
});

/* ------------------------------------------------------------------ */
/*  PATCH /vu/uploads/:id/speakers/:sid — 화자 라벨 수정               */
/* ------------------------------------------------------------------ */
describe('PATCH /uploads/:id/speakers/:sid — 라벨 수정 (voice-upload)', () => {
  function patchReq(uploadId: string, speakerId: string, body?: Record<string, unknown>): Request {
    const init: RequestInit = {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) init.body = JSON.stringify(body);
    return new Request(`http://localhost/vu/uploads/${uploadId}/speakers/${speakerId}`, init);
  }

  it('uploadId UUID 잘못 → 400', async () => {
    const res = await req(buildApp(), patchReq(UUID_BAD, SPEAKER_ID, { label: 'ok' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_ID_FORMAT');
  });

  it('speakerId UUID 잘못 → 400', async () => {
    const res = await req(buildApp(), patchReq(UPLOAD_ID, UUID_BAD, { label: 'ok' }));
    expect(res.status).toBe(400);
  });

  it('JSON 아닌 body → 400', async () => {
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vu/uploads/${UPLOAD_ID}/speakers/${SPEAKER_ID}`, {
        method: 'PATCH',
        body: 'plain',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('JSON_BODY_REQUIRED');
  });

  it('빈 label → 400', async () => {
    const res = await req(buildApp(), patchReq(UPLOAD_ID, SPEAKER_ID, { label: '' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_LABEL_LENGTH');
  });

  it('공백만 label → 400 (trim 후 빈 문자열)', async () => {
    const res = await req(buildApp(), patchReq(UPLOAD_ID, SPEAKER_ID, { label: '   ' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_LABEL_LENGTH');
  });

  it('label 51자 초과 → 400', async () => {
    const res = await req(buildApp(), patchReq(UPLOAD_ID, SPEAKER_ID, { label: 'x'.repeat(51) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_LABEL_LENGTH');
  });

  it('label 50자 정확히 → 통과', async () => {
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'user-1' }]);
    mockDB.pushResult([{ id: SPEAKER_ID }]);
    mockDB.pushResult([], 1);
    const res = await req(buildApp(), patchReq(UPLOAD_ID, SPEAKER_ID, { label: 'a'.repeat(50) }));
    expect(res.status).toBe(200);
  });

  it('업로드 없으면 404', async () => {
    mockDB.pushResult([]);
    const res = await req(buildApp(), patchReq(UPLOAD_ID, SPEAKER_ID, { label: '화자 A' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_UPLOAD_NOT_FOUND');
  });

  it('타인 소유 → 403', async () => {
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'other' }]);
    const res = await req(buildApp('user-1'), patchReq(UPLOAD_ID, SPEAKER_ID, { label: 'ok' }));
    expect(res.status).toBe(403);
  });

  it('화자 없으면 404', async () => {
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'user-1' }]);
    mockDB.pushResult([]);
    const res = await req(buildApp(), patchReq(UPLOAD_ID, SPEAKER_ID, { label: 'ok' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('SPEAKER_NOT_FOUND');
  });

  it('정상 수정 → 200 + 업데이트된 라벨', async () => {
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'user-1' }]);
    mockDB.pushResult([{ id: SPEAKER_ID }]);
    mockDB.pushResult([], 1);
    const res = await req(buildApp(), patchReq(UPLOAD_ID, SPEAKER_ID, { label: '엄마 목소리' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.speaker.id).toBe(SPEAKER_ID);
    expect(body.speaker.uploadId).toBe(UPLOAD_ID);
    expect(body.speaker.label).toBe('엄마 목소리');
  });

  it('UPDATE 쿼리에 올바른 값 전달', async () => {
    mockDB.pushResult([{ id: UPLOAD_ID, user_id: 'user-1' }]);
    mockDB.pushResult([{ id: SPEAKER_ID }]);
    mockDB.pushResult([], 1);
    await req(buildApp(), patchReq(UPLOAD_ID, SPEAKER_ID, { label: '새 라벨' }));
    const updateCall = mockDB.calls[2]!;
    expect(updateCall.sql).toContain('UPDATE voice_speakers');
    expect(updateCall.args).toContain('새 라벨');
    expect(updateCall.args).toContain(SPEAKER_ID);
  });
});

/* ------------------------------------------------------------------ */
/*  POST /vu/diarize — ElevenLabs 화자 분리                            */
/* ------------------------------------------------------------------ */
describe('POST /diarize — ElevenLabs 화자 분리 (voice-upload)', () => {
  function diarizeReq(audio: Uint8Array | null): Request {
    const form = new FormData();
    if (audio) {
      form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'rec.wav');
    }
    return new Request('http://localhost/vu/diarize', { method: 'POST', body: form });
  }

  it('audio 누락 → 400', async () => {
    const form = new FormData();
    const res = await req(
      buildApp(),
      new Request('http://localhost/vu/diarize', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUDIO_FILE_REQUIRED');
  });

  it('성공 시 화자 목록 + 자동 라벨 + duration 계산', async () => {
    mockDiarize.mockResolvedValue({
      speakers: [
        {
          speaker_id: 'spk-1',
          segments: [
            { start: 0, end: 5.2 },
            { start: 8.0, end: 10.0 },
          ],
        },
        { speaker_id: 'spk-2', segments: [{ start: 5.5, end: 7.5 }] },
      ],
    });
    const res = await req(buildApp(), diarizeReq(new Uint8Array([1, 2, 3])));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.speakers).toHaveLength(2);
    expect(body.speakers[0].speaker_id).toBe('spk-1');
    expect(body.speakers[0].label).toBe('Speaker 1');
    expect(body.speakers[0].total_duration).toBeCloseTo(7.2);
    expect(body.speakers[1].label).toBe('Speaker 2');
    expect(body.speakers[1].total_duration).toBeCloseTo(2.0);
  });

  it('blocks one-off diarization when overseas_transfer consent is missing', async () => {
    mockDB.setConsentMissing(true);
    mockDB.pushResult([consentRow('voice_biometric')]);

    const res = await req(buildApp(), diarizeReq(new Uint8Array([1, 2, 3])));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('CONSENT_REQUIRED');
    expect(body.consent).toBe('overseas_transfer');
    expect(mockDiarize).not.toHaveBeenCalled();
  });

  it('ElevenLabs 실패 → 500 DIARIZATION_FAILED', async () => {
    mockDiarize.mockRejectedValue(new Error('service down'));
    const res = await req(buildApp(), diarizeReq(new Uint8Array([1])));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('DIARIZATION_FAILED');
    expect(body.detail).toBe('service down');
  });

  it('DB 에 저장하지 않음 (쿼리 0건)', async () => {
    mockDiarize.mockResolvedValue({
      speakers: [{ speaker_id: 'spk-1', segments: [{ start: 0, end: 1 }] }],
    });
    await req(buildApp(), diarizeReq(new Uint8Array([1])));
    expect(mockDB.calls).toHaveLength(0);
  });

  it('non-Error 예외도 처리', async () => {
    mockDiarize.mockRejectedValue('string error');
    const res = await req(buildApp(), diarizeReq(new Uint8Array([1])));
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toBe('Unknown error');
  });
});
