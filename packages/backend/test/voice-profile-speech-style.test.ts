/**
 * 목소리 파이프라인 상태/재시도 API 테스트.
 *  - 말투 분석 상태 기록(speech_style_status: pending → done | failed)
 *  - POST /:id/speech-style/retry (원본 업로드 재전사 + 재분석, 동기)
 *  - GET  /:id/prerender-status  (유료 프리셋 사전렌더 진행 n/21 조회)
 *  - POST /:id/prerender-retry   (failed 큐 리셋/재적재)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';
import {
  getSharedInMemoryVoiceStorage,
  resetSharedInMemoryVoiceStorage,
} from '@alarmtalk/voice';

const V1 = '40000000-0000-4000-8000-000000000001';
const V_BAD = 'not-a-uuid';

const mockDB = createMockDB();
const { mockCreateInstantClone, mockSpeechToText, mockDeleteVoice, mockAnalyzeSpeechStyle } =
  vi.hoisted(() => ({
    mockCreateInstantClone: vi.fn(),
    mockSpeechToText: vi.fn(),
    mockDeleteVoice: vi.fn(),
    mockAnalyzeSpeechStyle: vi.fn(),
  }));

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

vi.mock('../src/lib/elevenlabs', () => ({
  ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.createInstantClone = mockCreateInstantClone;
    this.speechToText = mockSpeechToText;
    this.deleteVoice = mockDeleteVoice;
  }),
}));

// stock-clips 등이 vertex-translate 의 다른 export 를 쓰므로 분석 함수만 부분 목킹한다.
vi.mock('../src/lib/vertex-translate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/vertex-translate')>();
  return { ...actual, analyzeSpeechStyleWithVertex: mockAnalyzeSpeechStyle };
});

import voiceProfile from '../src/routes/voice-profile';
import { CLONE_CLIP_SEEDS } from '../src/lib/stock-clips';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'test-key',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

const SAMPLE_STYLE = {
  dialect: '경상',
  strength: 'high',
  register: 'banmal',
  markers: ['~노', '마'],
  persona: '',
};

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/vp', voiceProfile);
  return app;
}

function req(app: Hono<AppEnv>, r: Request) {
  return app.request(r, undefined, ENV);
}

/** waitUntil 태스크를 수집하는 가짜 ExecutionContext — 테스트에서 분석 완료를 await 한다. */
function fakeExecutionCtx() {
  const tasks: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => {
        tasks.push(p);
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
    drain: () => Promise.all(tasks),
  };
}

function cloneForm(name = '엄마'): Request {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }), 'sample.wav');
  form.append('name', name);
  form.append('durationMs', '90000');
  form.append('isDraft', 'true');
  return new Request('http://localhost/vp/clone', { method: 'POST', body: form });
}

/** clone 성공 경로에 필요한 결과들(프로필수 → 슬롯수 → attempt 예약 → INSERT → UPDATE ready). */
function pushCloneSuccessResults() {
  mockDB.pushResult([{ draft_count: 0, official_count: 0 }]);
  mockDB.pushResult([{ draft_count: 0, official_count: 0 }]);
  mockDB.pushResult([], 1);
  mockDB.pushResult([], 1);
  mockDB.pushResult([], 1);
}

/** speech_style_status 를 특정 값으로 기록한 UPDATE 콜 조회. */
function statusCalls(status: string) {
  return mockDB.calls.filter(
    (call) =>
      call.sql.includes('speech_style_status = ?') && call.args.includes(status),
  );
}

/** 재시도 원자적 클레임(failed → pending) UPDATE 콜 조회. */
function retryClaimCalls() {
  return mockDB.calls.filter(
    (call) =>
      call.sql.includes("speech_style_status = 'pending'") &&
      call.sql.includes("speech_style_status = 'failed'"),
  );
}

/** 민감 동의(음성/국외이전) 동의 완료 행 — setConsentMissing(true) 큐 제어용. */
function sensitiveConsentRows() {
  return ['voice_biometric', 'overseas_transfer'].map((t) => ({
    consent_type: t,
    policy_version: CURRENT_POLICY_VERSION,
    agreed: 1,
  }));
}

beforeEach(() => {
  mockDB.reset();
  mockCreateInstantClone.mockReset();
  mockSpeechToText.mockReset();
  mockDeleteVoice.mockReset();
  mockAnalyzeSpeechStyle.mockReset();
  resetSharedInMemoryVoiceStorage();
});

/* ------------------------------------------------------------------ */
/*  clone — 말투 분석 상태 기록                                        */
/* ------------------------------------------------------------------ */
describe('POST /clone — 말투 분석 상태 기록 (speech_style_status)', () => {
  it('분석 성공 시 pending → done + speech_style 저장', async () => {
    pushCloneSuccessResults();
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-ok' });
    mockSpeechToText.mockResolvedValue('마 오늘 아침은 우째 이래 좋노, 퍼뜩 일어나라 마');
    mockAnalyzeSpeechStyle.mockResolvedValue(SAMPLE_STYLE);

    const { ctx, drain } = fakeExecutionCtx();
    const app = buildApp();
    const res = await app.request(cloneForm(), undefined, ENV, ctx);
    expect(res.status).toBe(201);
    await drain();

    // 분석 시작 시 'pending' 기록.
    expect(statusCalls('pending')).toHaveLength(1);
    // 성공 시 speech_style + status='done' 을 한 번에 저장.
    const doneCall = mockDB.calls.find((call) =>
      call.sql.includes("speech_style_status = 'done'"),
    );
    expect(doneCall).toBeDefined();
    expect(doneCall!.args).toContain(JSON.stringify(SAMPLE_STYLE));
    expect(mockAnalyzeSpeechStyle).toHaveBeenCalledWith(
      expect.anything(),
      '마 오늘 아침은 우째 이래 좋노, 퍼뜩 일어나라 마',
      'ko',
    );
  });

  it('전사 실패 시 speech_style_status=failed 기록 (조용히 삼키지 않음)', async () => {
    pushCloneSuccessResults();
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-ok' });
    mockSpeechToText.mockRejectedValue(new Error('ElevenLabs API error 400: invalid_model_id'));

    const { ctx, drain } = fakeExecutionCtx();
    const app = buildApp();
    const res = await app.request(cloneForm(), undefined, ENV, ctx);
    expect(res.status).toBe(201); // 분석 실패는 등록 성공을 막지 않는다
    await drain();

    expect(statusCalls('pending')).toHaveLength(1);
    expect(statusCalls('failed')).toHaveLength(1);
    expect(mockDB.calls.some((call) => call.sql.includes("speech_style_status = 'done'"))).toBe(
      false,
    );
  });

  it('Vertex 분석이 null 이면 failed 기록', async () => {
    pushCloneSuccessResults();
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-ok' });
    mockSpeechToText.mockResolvedValue('짧은 전사');
    mockAnalyzeSpeechStyle.mockResolvedValue(null);

    const { ctx, drain } = fakeExecutionCtx();
    const app = buildApp();
    const res = await app.request(cloneForm(), undefined, ENV, ctx);
    expect(res.status).toBe(201);
    await drain();

    expect(statusCalls('failed')).toHaveLength(1);
  });

  it('ExecutionContext 없어 분석을 태울 수 없으면 즉시 failed 기록', async () => {
    pushCloneSuccessResults();
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-ok' });

    // executionCtx 미전달 → c.executionCtx getter throw → 분석 미시작.
    const res = await req(buildApp(), cloneForm());
    expect(res.status).toBe(201);

    expect(statusCalls('pending')).toHaveLength(1);
    expect(statusCalls('failed')).toHaveLength(1);
    expect(mockSpeechToText).not.toHaveBeenCalled();
  });

  it('성공 시 등록 원본을 voice_uploads 에 프로필 연결(voice_profile_id)로 남긴다 (C10)', async () => {
    pushCloneSuccessResults();
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-ok' });
    mockSpeechToText.mockResolvedValue('오늘도 또박또박 말하는 전사 텍스트입니다');
    mockAnalyzeSpeechStyle.mockResolvedValue(SAMPLE_STYLE);

    const { ctx, drain } = fakeExecutionCtx();
    const app = buildApp();
    const res = await app.request(cloneForm(), undefined, ENV, ctx);
    expect(res.status).toBe(201);
    const profileId = (await res.json()).profile.id as string;
    await drain();

    // 재시도(/:id/speech-style/retry)가 이 연결로 소스를 찾는다.
    const uploadInsert = mockDB.calls.find((call) =>
      call.sql.includes('INSERT INTO voice_uploads'),
    );
    expect(uploadInsert).toBeDefined();
    expect(uploadInsert!.sql).toContain('voice_profile_id');
    expect(uploadInsert!.args).toContain(profileId);
    expect(uploadInsert!.args).toContain('user-1');
    // 원본 오디오가 실제 스토리지에 저장돼 object_key 로 다시 읽을 수 있어야 한다.
    const objectKey = String(uploadInsert!.args[2]);
    const stored = await getSharedInMemoryVoiceStorage().get(objectKey);
    expect(stored).not.toBeNull();
  });

  it('클론 완료 직후 동의 철회 시 원본 보관을 스킵하고 외부 전사도 시작하지 않는다 (H)', async () => {
    mockDB.setConsentMissing(true);
    mockDB.pushResult(sensitiveConsentRows()); // 1) 라우트 진입 동의 확인 — 동의됨
    mockDB.pushResult([{ draft_count: 0, official_count: 0 }]); // 2) 프로필 수
    mockDB.pushResult([{ draft_count: 0, official_count: 0 }]); // 3) 슬롯 수(tx)
    mockDB.pushResult([], 1); // 4) 월간 attempt 예약
    mockDB.pushResult([], 1); // 5) voice_profiles INSERT
    mockDB.pushResult(sensitiveConsentRows()); // 6) 완료 tx 동의 재확인 — 아직 동의됨
    mockDB.pushResult([], 1); // 7) status='ready' 전환
    mockDB.pushResult([]); // 8) 원본 보관 직전 재확인 — 철회됨(빈 결과)
    // 이후(상태 pending 기록, 분석 시작 동의 재확인)는 큐 소진 → 기본 빈 결과(=철회 유지).
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-ok' });

    const { ctx, drain } = fakeExecutionCtx();
    const app = buildApp();
    const res = await app.request(cloneForm(), undefined, ENV, ctx);
    expect(res.status).toBe(201); // 등록 자체는 이미 완료 — 보관/분석만 중단한다
    await drain();

    // 철회 후에는 원본을 R2/voice_uploads 에 새로 남기지 않는다.
    expect(mockDB.calls.some((call) => call.sql.includes('INSERT INTO voice_uploads'))).toBe(false);
    // 분석 시작 재확인에도 걸려 외부 전사(ElevenLabs)로 원본을 보내지 않는다.
    expect(mockSpeechToText).not.toHaveBeenCalled();
    expect(statusCalls('pending')).toHaveLength(1);
    expect(statusCalls('failed')).toHaveLength(1);
  });

  it('분석 왕복 중 동의 철회 시 말투 결과를 저장하지 않는다 (H — 저장 직전 재확인)', async () => {
    mockDB.setConsentMissing(true);
    mockDB.pushResult(sensitiveConsentRows()); // 1) 라우트 진입
    mockDB.pushResult([{ draft_count: 0, official_count: 0 }]); // 2) 프로필 수
    mockDB.pushResult([{ draft_count: 0, official_count: 0 }]); // 3) 슬롯 수
    mockDB.pushResult([], 1); // 4) attempt 예약
    mockDB.pushResult([], 1); // 5) voice_profiles INSERT
    mockDB.pushResult(sensitiveConsentRows()); // 6) 완료 tx 재확인
    mockDB.pushResult([], 1); // 7) ready 전환
    mockDB.pushResult(sensitiveConsentRows()); // 8) 원본 보관 직전 재확인 — 동의됨(보관 진행)
    mockDB.pushResult([], 1); // 9) voice_uploads INSERT
    mockDB.pushResult([], 1); // 10) status='pending'
    mockDB.pushResult(sensitiveConsentRows()); // 11) 분석 시작 재확인 — 동의됨
    mockDB.pushResult([]); // 12) 저장 직전 재확인 — 철회됨
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-ok' });
    mockSpeechToText.mockResolvedValue('마 오늘 아침은 우째 이래 좋노, 퍼뜩 일어나라 마');
    mockAnalyzeSpeechStyle.mockResolvedValue(SAMPLE_STYLE);

    const { ctx, drain } = fakeExecutionCtx();
    const app = buildApp();
    const res = await app.request(cloneForm(), undefined, ENV, ctx);
    expect(res.status).toBe(201);
    await drain();

    // 철회 전에 시작된 전사는 있었지만, 파생 결과(speech_style)는 저장하지 않는다.
    expect(mockSpeechToText).toHaveBeenCalled();
    expect(mockDB.calls.some((call) => call.sql.includes("speech_style_status = 'done'"))).toBe(
      false,
    );
    expect(statusCalls('failed')).toHaveLength(1);
    // 보관은 철회 전에 이뤄졌으므로 존재한다(원본 보관 스킵과 구분).
    expect(mockDB.calls.some((call) => call.sql.includes('INSERT INTO voice_uploads'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  POST /:id/speech-style/retry — 말투 분석 재시도                    */
/* ------------------------------------------------------------------ */
describe('POST /:id/speech-style/retry — 말투 분석 재시도', () => {
  async function storeSourceUpload() {
    return getSharedInMemoryVoiceStorage().store({
      userId: 'user-1',
      bytes: new Uint8Array([10, 20, 30]),
      mimeType: 'audio/wav',
      durationMs: 90000,
      originalName: 'sample.wav',
    });
  }

  /** 소스 조회가 프로필 연결본만 대상으로 하는지 (C10 — '사용자 최신 1건' 폴백 제거). */
  function expectProfileScopedSourceQuery() {
    const sourceQueries = mockDB.calls.filter((call) => call.sql.includes('FROM voice_uploads'));
    expect(sourceQueries.length).toBeGreaterThan(0);
    for (const call of sourceQueries) {
      expect(call.sql).toContain('voice_profile_id = ?');
      expect(call.args).toContain(V1);
    }
  }

  it('잘못된 UUID → 400', async () => {
    const res = await req(buildApp(), jsonReq('POST', `/vp/${V_BAD}/speech-style/retry`));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

  it('타인 목소리(소유권 불일치)면 404', async () => {
    mockDB.pushResult([]); // 소유권 조회 미스
    const res = await req(buildApp(), jsonReq('POST', `/vp/${V1}/speech-style/retry`));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
    expect(mockSpeechToText).not.toHaveBeenCalled();
  });

  it('프로필 연결 업로드가 없으면(TTL 삭제·보관 실패) 409 SOURCE_AUDIO_MISSING', async () => {
    mockDB.pushResult([{ id: V1, preview_language: 'ko' }]);
    mockDB.pushResult([]); // voice_profile_id = V1 연결본 없음
    const res = await req(buildApp(), jsonReq('POST', `/vp/${V1}/speech-style/retry`));
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('SOURCE_AUDIO_MISSING');
    expect(mockSpeechToText).not.toHaveBeenCalled();
    // 소스가 없으면 상태를 pending 으로 바꾸지 않는다(기존 failed 유지 — 클레임도 없음).
    expect(statusCalls('pending')).toHaveLength(0);
    expect(retryClaimCalls()).toHaveLength(0);
    expectProfileScopedSourceQuery();
  });

  it('무관 업로드(voice_profile_id NULL)만 있어도 폴백하지 않고 409 (C10)', async () => {
    // DB 에 가족알람용 등 프로필 미연결 업로드가 있어도, 소스 조회는
    // voice_profile_id = :id 로만 매칭하므로 빈 결과 → 409 가 나야 한다.
    mockDB.pushResult([{ id: V1, preview_language: 'ko' }]);
    mockDB.pushResult([]); // 연결본 없음 (미연결 행은 WHERE 조건에서 걸러짐)
    const res = await req(buildApp(), jsonReq('POST', `/vp/${V1}/speech-style/retry`));
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('SOURCE_AUDIO_MISSING');
    // '사용자 최신 1건' 폴백 쿼리(프로필 조건 없는 voice_uploads 조회)가 없어야 한다.
    expectProfileScopedSourceQuery();
    expect(mockSpeechToText).not.toHaveBeenCalled();
  });

  it('voice_uploads 행은 있지만 R2 오브젝트가 지워졌으면 409', async () => {
    mockDB.pushResult([{ id: V1, preview_language: 'ko' }]);
    mockDB.pushResult([
      { object_key: 'mem://user-1/gone', mime_type: 'audio/wav', original_name: 'a.wav' },
    ]);
    const res = await req(buildApp(), jsonReq('POST', `/vp/${V1}/speech-style/retry`));
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('SOURCE_AUDIO_MISSING');
  });

  it('성공: 프로필 연결 업로드로 재전사→재분석→done, 응답 {success, status:done}', async () => {
    const meta = await storeSourceUpload();
    mockDB.pushResult([{ id: V1, preview_language: 'ko' }]);
    mockDB.pushResult([
      { object_key: meta.objectKey, mime_type: 'audio/wav', original_name: 'sample.wav' },
    ]);
    mockDB.pushResult([], 1); // 원자적 클레임(failed → pending) 성공
    mockSpeechToText.mockResolvedValue('오늘도 존댓말로 또박또박 말하는 전사 텍스트입니다');
    mockAnalyzeSpeechStyle.mockResolvedValue(SAMPLE_STYLE);

    const res = await req(buildApp(), jsonReq('POST', `/vp/${V1}/speech-style/retry`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('done');
    expectProfileScopedSourceQuery();
    expect(mockSpeechToText).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      mimeType: 'audio/wav',
      fileName: 'sample.wav',
    });
    // pending 전환은 무조건 UPDATE 가 아니라 failed 일 때만 성립하는 원자적 클레임이다.
    const claims = retryClaimCalls();
    expect(claims).toHaveLength(1);
    expect(claims[0]!.args).toContain(V1);
    const doneCall = mockDB.calls.find((call) =>
      call.sql.includes("speech_style_status = 'done'"),
    );
    expect(doneCall).toBeDefined();
    expect(doneCall!.args).toContain(JSON.stringify(SAMPLE_STYLE));
    expect(doneCall!.args).toContain(V1);
  });

  it('동시 재시도 경쟁: 클레임(failed→pending) 0행이면 409 + 분석 미실행', async () => {
    const meta = await storeSourceUpload();
    mockDB.pushResult([{ id: V1, preview_language: 'ko' }]);
    mockDB.pushResult([
      { object_key: meta.objectKey, mime_type: 'audio/wav', original_name: 'sample.wav' },
    ]);
    mockDB.pushResult([], 0); // 다른 요청이 이미 pending 점유(또는 failed 아님)

    const res = await req(buildApp(), jsonReq('POST', `/vp/${V1}/speech-style/retry`));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('SPEECH_STYLE_RETRY_CONFLICT');
    // 진 쪽은 전사/분석(외부 호출)을 시작하지 않는다.
    expect(mockSpeechToText).not.toHaveBeenCalled();
    expect(mockAnalyzeSpeechStyle).not.toHaveBeenCalled();
  });

  it('동의 철회 후 재시도는 403 CONSENT_REQUIRED — 전사/클레임 없이 차단', async () => {
    mockDB.setConsentMissing(true);
    mockDB.pushResult([{ id: V1, preview_language: 'ko' }]); // 소유권 조회
    mockDB.pushResult([]); // user_consents — 철회 상태(빈 결과)

    const res = await req(buildApp(), jsonReq('POST', `/vp/${V1}/speech-style/retry`));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('CONSENT_REQUIRED');
    expect(body.consent).toBe('voice_biometric');
    expect(mockSpeechToText).not.toHaveBeenCalled();
    expect(retryClaimCalls()).toHaveLength(0);
  });

  it('preview_language=ja 는 분석 언어로 전달된다', async () => {
    const meta = await storeSourceUpload();
    mockDB.pushResult([{ id: V1, preview_language: 'ja' }]);
    mockDB.pushResult([
      { object_key: meta.objectKey, mime_type: 'audio/wav', original_name: 'sample.wav' },
    ]);
    mockDB.pushResult([], 1); // 원자적 클레임 성공
    mockSpeechToText.mockResolvedValue('関西弁でほんまに元気よく話す文字起こしテキストやで');
    mockAnalyzeSpeechStyle.mockResolvedValue(SAMPLE_STYLE);

    const res = await req(buildApp(), jsonReq('POST', `/vp/${V1}/speech-style/retry`));
    expect(res.status).toBe(200);
    expect(mockAnalyzeSpeechStyle).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'ja');
  });

  it('재분석 실패 시 failed 기록 + 502 SPEECH_STYLE_ANALYSIS_FAILED', async () => {
    const meta = await storeSourceUpload();
    mockDB.pushResult([{ id: V1, preview_language: 'ko' }]);
    mockDB.pushResult([
      { object_key: meta.objectKey, mime_type: 'audio/wav', original_name: 'sample.wav' },
    ]);
    mockDB.pushResult([], 1); // 원자적 클레임 성공
    mockSpeechToText.mockRejectedValue(new Error('scribe down'));

    const res = await req(buildApp(), jsonReq('POST', `/vp/${V1}/speech-style/retry`));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error_code).toBe('SPEECH_STYLE_ANALYSIS_FAILED');
    expect(body.status).toBe('failed');
    expect(statusCalls('failed')).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  GET /:id — speech_style_status 직렬화                              */
/* ------------------------------------------------------------------ */
describe('GET — speech_style_status 직렬화', () => {
  it('목록 조회에 speech_style_status 포함', async () => {
    mockDB.pushResult([{ total: 1 }]); // count
    mockDB.pushResult([{ id: V1, name: '엄마', speech_style_status: 'failed' }]);
    const res = await req(buildApp(), new Request('http://localhost/vp'));
    expect(res.status).toBe(200);
    expect((await res.json()).profiles[0].speech_style_status).toBe('failed');
  });

  it('컬럼이 비어 있으면 null (분석 대상 아님)', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: V1, name: '엄마' }]);
    const res = await req(buildApp(), new Request('http://localhost/vp'));
    expect((await res.json()).profiles[0].speech_style_status).toBe(null);
  });

  it('목록 조회에도 포함', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: V1, name: '엄마', speech_style_status: 'done' }]);
    const res = await req(buildApp(), new Request('http://localhost/vp'));
    expect((await res.json()).profiles[0].speech_style_status).toBe('done');
  });
});

/* ------------------------------------------------------------------ */
/*  GET /:id/prerender-status — 사전렌더 준비 상태                     */
/* ------------------------------------------------------------------ */
describe('GET /:id/prerender-status — 사전렌더 준비 상태', () => {
  it('total 은 CLONE_CLIP_SEEDS 시드 합(=21)에서 계산된다', async () => {
    const expectedTotal = CLONE_CLIP_SEEDS.reduce((sum, group) => sum + group.seeds.length, 0);
    expect(expectedTotal).toBe(21);

    mockDB.pushResult([{ id: V1 }]);
    mockDB.pushResult([{ count: 7 }]);
    mockDB.pushResult([{ status: 'pending', attempts: 2 }]);

    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}/prerender-status`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'pending', total: 21, generated: 7, attempts: 2 });
  });

  it('생성 수 집계 쿼리는 preset + audio_url 존재 조건', async () => {
    mockDB.pushResult([{ id: V1 }]);
    mockDB.pushResult([{ count: 21 }]);
    mockDB.pushResult([{ status: 'done', attempts: 0 }]);

    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}/prerender-status`));
    const body = await res.json();
    expect(body.status).toBe('done');
    expect(body.generated).toBe(21);
    const countCall = mockDB.calls.find((call) => call.sql.includes('FROM messages'));
    expect(countCall).toBeDefined();
    expect(countCall!.sql).toContain('COALESCE(is_preset, 0) = 1');
    expect(countCall!.sql).toContain('audio_url IS NOT NULL');
    expect(countCall!.args).toContain(V1);
  });

  it('큐가 failed 면 status=failed + attempts 반영', async () => {
    mockDB.pushResult([{ id: V1 }]);
    mockDB.pushResult([{ count: 3 }]);
    mockDB.pushResult([{ status: 'failed', attempts: 5 }]);

    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}/prerender-status`));
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.generated).toBe(3);
    expect(body.attempts).toBe(5);
  });

  it('큐 행이 없으면 status=none', async () => {
    mockDB.pushResult([{ id: V1 }]);
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([]);

    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}/prerender-status`));
    const body = await res.json();
    expect(body.status).toBe('none');
    expect(body.attempts).toBe(0);
  });

  it('타인/시스템/draft 목소리는 404', async () => {
    mockDB.pushResult([]);
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}/prerender-status`));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('잘못된 UUID → 400', async () => {
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V_BAD}/prerender-status`),
    );
    expect(res.status).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/*  POST /:id/prerender-retry — 사전렌더 재시도                        */
/* ------------------------------------------------------------------ */
describe('POST /:id/prerender-retry — 사전렌더 재시도', () => {
  it('failed 큐 행을 pending 으로 리셋(attempts/claim 초기화)', async () => {
    mockDB.pushResult([{ id: V1, preview_language: 'ko' }]);
    mockDB.pushResult([], 1); // failed → pending 리셋 성공

    const res = await req(buildApp(), jsonReq('POST', `/vp/${V1}/prerender-retry`));

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    const resetCall = mockDB.calls.find((call) =>
      call.sql.includes('UPDATE voice_prerender_queue'),
    );
    expect(resetCall).toBeDefined();
    expect(resetCall!.sql).toContain("status = 'pending'");
    expect(resetCall!.sql).toContain('attempts = 0');
    expect(resetCall!.sql).toContain('claimed_at = NULL');
    expect(resetCall!.sql).toContain('claim_token = NULL');
    expect(resetCall!.sql).toContain("status = 'failed'");
    expect(resetCall!.args).toContain(V1);
    // 리셋에 성공했으면 재적재(INSERT)는 하지 않는다.
    expect(
      mockDB.calls.some((call) => call.sql.includes('INSERT INTO voice_prerender_queue')),
    ).toBe(false);
  });

  it('큐 행이 없으면 확정 언어(preview_language)로 재적재', async () => {
    mockDB.pushResult([{ id: V1, preview_language: 'ja' }]);
    mockDB.pushResult([], 0); // failed 행 없음 → 리셋 0행
    mockDB.pushResult([], 1); // enqueuePrerender INSERT

    const res = await req(buildApp(), jsonReq('POST', `/vp/${V1}/prerender-retry`));

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    const enqueueCall = mockDB.calls.find((call) =>
      call.sql.includes('INSERT INTO voice_prerender_queue'),
    );
    expect(enqueueCall).toBeDefined();
    expect(enqueueCall!.args).toContain(V1);
    expect(enqueueCall!.args).toContain('user-1'); // 소유자(userPk 폴백=userId)
    expect(enqueueCall!.args).toContain('ja');
  });

  it('소유권 게이트는 draft/시스템 제외 + ready 만 허용', async () => {
    mockDB.pushResult([{ id: V1, preview_language: 'ko' }]);
    mockDB.pushResult([], 1);
    await req(buildApp(), jsonReq('POST', `/vp/${V1}/prerender-retry`));
    const gate = mockDB.calls[0]!;
    expect(gate.sql).toContain('COALESCE(is_system, 0) = 0');
    expect(gate.sql).toContain('COALESCE(is_draft, 0) = 0');
    expect(gate.sql).toContain("status = 'ready'");
    expect(gate.args).toContain('user-1');
  });

  it('타인 목소리는 404', async () => {
    mockDB.pushResult([]);
    const res = await req(buildApp(), jsonReq('POST', `/vp/${V1}/prerender-retry`));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('잘못된 UUID → 400', async () => {
    const res = await req(buildApp(), jsonReq('POST', `/vp/${V_BAD}/prerender-retry`));
    expect(res.status).toBe(400);
  });
});
