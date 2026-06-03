import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware } from './helpers';
import { resetSharedInMemoryVoiceStorage } from '@voice-alarm/voice';

const mockDB = createMockDB();
const mockDiarize = vi.fn();

const ENV: Env = {
  ELEVENLABS_API_KEY: 'test-key',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

vi.mock('../src/lib/elevenlabs', () => ({
  ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.diarize = mockDiarize;
  }),
}));

import voiceRoutes from '../src/routes/voice';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/voice', voiceRoutes);
  return app;
}

function reqWithEnv(app: Hono<AppEnv>, r: Request) {
  return app.request(r, undefined, ENV);
}

function uploadRequest(bytes = new Uint8Array([1, 2, 3, 4]), mime = 'audio/mpeg') {
  const form = new FormData();
  form.append('audio', new Blob([bytes], { type: mime }), 'sample.mp3');
  form.append('durationMs', '90000');
  return new Request('http://localhost/voice/upload', { method: 'POST', body: form });
}

function jsonRequest(method: string, path: string, body?: Record<string, unknown>): Request {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

beforeEach(() => {
  mockDB.reset();
  resetSharedInMemoryVoiceStorage();
  mockDiarize.mockReset();
  mockDiarize.mockResolvedValue(diarizationResult());
});

function diarizationResult(count = 3) {
  return {
    speakers: Array.from({ length: count }, (_, index) => ({
      speaker_id: `speaker-${index + 1}`,
      segments: [{ start: index, end: index + 0.75 }],
    })),
  };
}

describe('음성 업로드/화자 편집 E2E 플로우', () => {
  it('정상 플로우: 업로드 → 분리 → 라벨 변경 → 조회 반영', async () => {
    const app = buildApp('user-1');

    // (1) 업로드 — INSERT 1건
    mockDB.pushResult([], 1);
    const uploadRes = await app.request(uploadRequest());
    expect(uploadRes.status).toBe(201);
    const { upload } = await uploadRes.json();
    expect(upload.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // (2) 분리 — SELECT upload (소유자 확인), DELETE 기존 speakers, INSERT N명
    mockDB.pushResult([
      { id: upload.id, user_id: 'user-1', object_key: upload.objectKey },
    ]);
    mockDB.pushResult([], 0); // DELETE
    // 가변 개수 INSERT 응답을 넉넉히 준비 (mock 은 최대 3명까지 만들 수 있음)
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const separateRes = await reqWithEnv(
      app,
      jsonRequest('POST', `/voice/uploads/${upload.id}/separate`),
    );
    expect(separateRes.status).toBe(201);
    const { speakers } = await separateRes.json();
    expect(Array.isArray(speakers)).toBe(true);
    expect(speakers.length).toBeGreaterThanOrEqual(1);
    const targetSpeaker = speakers[0];
    expect(targetSpeaker.label).toMatch(/^화자 \d$/);

    // 분리에서 사용하지 않은 INSERT 응답은 버려 다음 단계 SELECT 가 오염되지 않게 한다
    mockDB.clearResults();

    // (3) 라벨 변경 — SELECT upload, SELECT speaker, UPDATE
    mockDB.pushResult([{ id: upload.id, user_id: 'user-1' }]);
    mockDB.pushResult([{ id: targetSpeaker.id }]);
    mockDB.pushResult([], 1);

    const patchRes = await app.request(
      jsonRequest(
        'PATCH',
        `/voice/uploads/${upload.id}/speakers/${targetSpeaker.id}`,
        { label: '엄마' },
      ),
    );
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.speaker.label).toBe('엄마');

    // (4) 목록 조회 — SELECT upload, SELECT speakers (변경된 라벨 포함)
    mockDB.pushResult([{ id: upload.id, user_id: 'user-1' }]);
    mockDB.pushResult([
      {
        id: targetSpeaker.id,
        upload_id: upload.id,
        label: '엄마',
        start_ms: targetSpeaker.startMs,
        end_ms: targetSpeaker.endMs,
        confidence: targetSpeaker.confidence,
        created_at: '2026-04-21T13:30:00Z',
      },
    ]);

    const listRes = await app.request(
      jsonRequest('GET', `/voice/uploads/${upload.id}/speakers`),
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.speakers).toHaveLength(1);
    expect(listBody.speakers[0].label).toBe('엄마');
    expect(listBody.speakers[0].id).toBe(targetSpeaker.id);

    // UPDATE SQL 이 실제 실행되었는지 교차 확인
    const updateCall = mockDB.calls.find((c) => c.sql.includes('UPDATE voice_speakers'));
    expect(updateCall).toBeDefined();
    expect(updateCall!.args).toContain('엄마');
  });

  it('분리 단계: 다른 사용자 소유 업로드면 403', async () => {
    const app = buildApp('user-1');
    mockDB.pushResult([], 1);
    const uploadRes = await app.request(uploadRequest());
    const { upload } = await uploadRes.json();

    // SELECT 결과가 다른 user_id 를 돌려주도록 설정
    mockDB.pushResult([
      { id: upload.id, user_id: 'intruder-2', object_key: upload.objectKey },
    ]);

    const res = await reqWithEnv(
      app,
      jsonRequest('POST', `/voice/uploads/${upload.id}/separate`),
    );
    expect(res.status).toBe(403);
  });

  it('speakers 조회: 업로드가 없으면 404', async () => {
    const app = buildApp('user-1');
    // 어떤 UUID 든 DB 에는 미존재 → SELECT 가 빈 결과
    mockDB.pushResult([]);
    const missingId = '90000000-0000-4000-8000-0000000000ff';
    const res = await app.request(
      jsonRequest('GET', `/voice/uploads/${missingId}/speakers`),
    );
    expect(res.status).toBe(404);
  });

  it('라벨 변경: 다른 사용자 소유 업로드면 403 (speaker 는 안 건드림)', async () => {
    const app = buildApp('user-1');
    const uploadId = '80000000-0000-4000-8000-000000000001';
    const speakerId = '80000000-0000-4000-8000-0000000000a1';
    mockDB.pushResult([{ id: uploadId, user_id: 'other-7' }]);

    const res = await app.request(
      jsonRequest(
        'PATCH',
        `/voice/uploads/${uploadId}/speakers/${speakerId}`,
        { label: '엄마' },
      ),
    );
    expect(res.status).toBe(403);

    // UPDATE 가 호출되지 않았음을 보장
    const update = mockDB.calls.find((c) => c.sql.includes('UPDATE voice_speakers'));
    expect(update).toBeUndefined();
  });

  it('라벨 변경: speaker 가 upload 에 속하지 않으면 404', async () => {
    const app = buildApp('user-1');
    const uploadId = '80000000-0000-4000-8000-000000000002';
    const speakerId = '80000000-0000-4000-8000-0000000000b1';
    // upload 는 소유자 일치
    mockDB.pushResult([{ id: uploadId, user_id: 'user-1' }]);
    // speaker 매칭 실패
    mockDB.pushResult([]);

    const res = await app.request(
      jsonRequest(
        'PATCH',
        `/voice/uploads/${uploadId}/speakers/${speakerId}`,
        { label: '엄마' },
      ),
    );
    expect(res.status).toBe(404);
  });
});
