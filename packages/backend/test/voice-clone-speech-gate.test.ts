// **말소리가 없으면 등록하지 않는다**(스펙 voice-and-message §4-1 「말소리가 없으면 등록하지 않는다」, 2026-10-11 오너 결정
// — "목소리(말소리) 없으면 등록 못 하도록 막는다. 다시 만들기는 횟수 제한 없음 — 확정 등록만 월 1회").
//
// 2026-10-10 prod(ALARMTALK-BACKEND-F): 한 사용자가 세 번(03:58·04:03·04:32 UTC) 등록했고 세 번 다 클론이 만들어졌다.
// 말투 분석만 셋 다 '실패' 였다 — 뒤의 둘은 전사가 20자 미만(말소리가 거의 없는 녹음), 첫 건은 모델이 확신하지
// 못했다. 사용자는 쓸 수 없는 목소리를 받았고, 다시 등록하다 월 한도에 걸렸다.
//
// 진짜 SQLite 로 돌린다 — "아무것도 쓰지 않는다" 를 원장·집계·초안·삭제 예약 표의 실제 줄 수로 본다. 지키는 것:
//   1. 말소리로 센 전사(`speechCharCount` — 소리 표시를 뺀다)가 `MIN_SPEECH_TRANSCRIPT_CHARS` 자 미만 → 400
//      `VOICE_CLONE_NO_SPEECH`. 초안 행·초안 시도 집계·원장·provider 보이스·R2 원본·삭제 예약·옛 초안 정리 어느 것도 없다
//      — 그래서 다시 녹음하는 데 횟수 제한이 없다.
//   2. 전사 자체가 실패하면(네트워크·시간 초과·제공자 4xx/5xx·답에 글이 없음) 막지 않는다 — 예전처럼 등록하고, 말투
//      분석이 스스로 다시 전사한다. warn 한 줄에는 오류 이름만 남는다.
//   3. 전사가 있으면 말투 분석이 그것을 쓴다 — 등록 한 번에 Scribe 는 한 번이다. 전사 원문은 어떤 로그에도 없다.
//   4. 말투 분석의 '표준 말투'(녹음이 말투를 보여 주지 않았다)는 실패가 아니다 — speech_style NULL·done, 오류 보고
//      없음, 다시 굽기 없음. 다시 하면 될 수 있는 실패만 failed 다. 재시도 엔드포인트도 같다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type InStatement, type TransactionMode } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';
import { runMigrations } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-clone-speech-gate-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
const { mockCreateInstantClone, mockSpeechToText, mockAnalyzeSpeechStyle, actualElevenLabs } = vi.hoisted(() => ({
  mockCreateInstantClone: vi.fn(),
  mockSpeechToText: vi.fn(),
  mockAnalyzeSpeechStyle: vi.fn(),
  /** 진짜 클라이언트 — 전사 답의 모양을 실제 `speechToText` 로 읽어야 하는 갈래만 쓴다(그때도 fetch 는 대역이다). */
  actualElevenLabs: {} as { Client?: typeof import('../src/lib/elevenlabs').ElevenLabsClient },
}));

vi.mock('../src/lib/db', () => ({ getDB: () => recordingDb }));
// 외부는 부르지 않는다 — provider·전사·Vertex 모두 목이다. "부르지 않았다" 가 단언의 절반이다.
vi.mock('../src/lib/elevenlabs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/elevenlabs')>();
  actualElevenLabs.Client = actual.ElevenLabsClient;
  return {
    ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.createInstantClone = mockCreateInstantClone;
      this.speechToText = mockSpeechToText;
      this.deleteVoice = vi.fn();
    }),
  };
});
vi.mock('../src/lib/vertex-translate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/vertex-translate')>();
  return { ...actual, analyzeSpeechStyleWithVertex: mockAnalyzeSpeechStyle };
});

import voiceProfile from '../src/routes/voice-profile';
import { MIN_SPEECH_TRANSCRIPT_CHARS } from '../src/lib/vertex-translate';

const USER = '77777777-7777-4777-8777-777777777777';
const OLD_DRAFT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OFFICIAL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
/** 말소리가 있는 전사 — 로그에 이 글이 한 조각도 없어야 한다. */
const SPEECH = '오늘도 또박또박 소리 내어 읽은 등록 녹음의 전사입니다. 매일 아침 이 목소리로 깨워 줄게요.';
const STYLE = {
  dialect: '경상',
  strength: 'high',
  register: 'banmal',
  markers: ['~카이'],
  persona: '',
  childlike: false,
  energy: '',
};

/** R2 대역 — `put` 이 불렸는지를 본다(원본 보관은 provider 등록 뒤에만 일어난다). */
const objects = new Map<string, { bytes: Uint8Array; customMetadata: Record<string, string>; contentType: string }>();
const bucket = {
  put: vi.fn(async (key: string, bytes: Uint8Array, options: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) => {
    objects.set(key, {
      bytes: new Uint8Array(bytes),
      customMetadata: options.customMetadata ?? {},
      contentType: options.httpMetadata?.contentType ?? 'application/octet-stream',
    });
  }),
  get: vi.fn(async (key: string) => {
    const stored = objects.get(key);
    if (!stored) return null;
    return {
      customMetadata: stored.customMetadata,
      httpMetadata: { contentType: stored.contentType },
      size: stored.bytes.byteLength,
      uploaded: new Date(),
      arrayBuffer: async () => stored.bytes.slice().buffer,
    };
  }),
  delete: vi.fn(async (key: string) => {
    objects.delete(key);
  }),
};

/** 라우트가 DB 에 보낸 모든 문장(트랜잭션 안 포함)과 연 트랜잭션 — 거절이 한 줄도 쓰지 않았는지를 문장 단위로 본다. */
const executed: string[] = [];
const transactionsOpened: string[] = [];
const sqlOf = (stmt: InStatement) => (typeof stmt === 'string' ? stmt : stmt.sql);
const recordingDb = {
  execute: (stmt: InStatement) => {
    executed.push(sqlOf(stmt));
    return db.execute(stmt);
  },
  batch: (stmts: InStatement[], mode?: TransactionMode) => {
    executed.push(...stmts.map(sqlOf));
    return db.batch(stmts, mode);
  },
  transaction: async (mode?: TransactionMode) => {
    transactionsOpened.push(String(mode));
    const tx = await db.transaction(mode);
    return new Proxy(tx, {
      get(target, prop) {
        if (prop === 'execute') {
          return (stmt: InStatement) => {
            executed.push(sqlOf(stmt));
            return target.execute(stmt);
          };
        }
        if (prop === 'batch') {
          return (stmts: InStatement[]) => {
            executed.push(...stmts.map(sqlOf));
            return target.batch(stmts);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  },
};

const ENV = {
  ELEVENLABS_API_KEY: 'test-key',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
  VOICE_BUCKET: bucket as unknown as R2Bucket,
} satisfies Env;

const sentry = { captureException: vi.fn(), setTag: vi.fn(), setTags: vi.fn() };

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', USER);
    c.set('userIdPK', USER);
    c.set('sentry', sentry);
    await next();
  });
  app.route('/voice', voiceProfile);
  return app;
}

/** waitUntil 로 넘어간 말투 분석을 끝까지 기다린다. */
function fakeExecutionCtx() {
  const tasks: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (task: Promise<unknown>) => tasks.push(task),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
    drain: () => Promise.all(tasks),
  };
}

function cloneForm(): FormData {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' }), 'sample.wav');
  form.append('name', '새 목소리');
  form.append('durationMs', '45000');
  form.append('isDraft', 'true');
  return form;
}

function clone(executionCtx?: ExecutionContext) {
  return buildApp().request('/voice/clone', { method: 'POST', body: cloneForm() }, ENV, executionCtx);
}

async function count(sql: string): Promise<number> {
  return Number((await db.execute(sql)).rows[0]!.n);
}

/** 거절이 한 줄도 쓰지 않았다 — 맨 처음 깔아 둔 상태 그대로다. */
async function expectNothingWritten() {
  expect(await count('SELECT COUNT(*) AS n FROM voice_profiles')).toBe(1);
  const oldDraft = await db.execute({
    sql: 'SELECT deleted_at, is_draft, status, elevenlabs_voice_id FROM voice_profiles WHERE id = ?',
    args: [OLD_DRAFT],
  });
  // 옛 초안 정리(`discardAbandonedDrafts`)도 돌지 않았다.
  expect(oldDraft.rows[0]).toMatchObject({ deleted_at: null, is_draft: 1, status: 'ready', elevenlabs_voice_id: 'elv-old' });
  expect(await count('SELECT COUNT(*) AS n FROM voice_draft_attempt_usage')).toBe(0);
  expect(await count('SELECT COUNT(*) AS n FROM voice_profile_change_ledger')).toBe(0);
  expect(await count('SELECT COUNT(*) AS n FROM pending_external_deletions')).toBe(0);
  expect(await count('SELECT COUNT(*) AS n FROM voice_uploads')).toBe(0);
  expect(mockCreateInstantClone).not.toHaveBeenCalled();
  expect(bucket.put).not.toHaveBeenCalled();
  // 문장 단위로도 — 쓰는 문장은 하나도 없고(INSERT·UPDATE·DELETE·REPLACE), 쓰기 트랜잭션도 열지 않았다.
  expect(executed.filter((sql) => /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql))).toEqual([]);
  expect(transactionsOpened).toEqual([]);
}

/** 이 요청 동안 찍힌 모든 로그 줄(info·warn·error). */
let logLines: string[] = [];
const consoleSpies: { mockRestore: () => void }[] = [];

beforeAll(async () => {
  await runMigrations(db);
});

beforeEach(async () => {
  mockCreateInstantClone.mockReset();
  mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-new' });
  mockSpeechToText.mockReset();
  mockSpeechToText.mockResolvedValue(SPEECH);
  mockAnalyzeSpeechStyle.mockReset();
  mockAnalyzeSpeechStyle.mockResolvedValue({ kind: 'style', style: STYLE });
  sentry.captureException.mockReset();
  bucket.put.mockClear();
  objects.clear();
  logLines = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    consoleSpies.push(
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logLines.push(args.map(String).join(' '));
      }),
    );
  }
  for (const table of [
    'voice_prerender_queue',
    'voice_profile_change_ledger',
    'voice_draft_attempt_usage',
    'pending_external_deletions',
    'voice_uploads',
    'user_consents',
    'voice_profiles',
    'users',
  ]) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute({
    sql: 'INSERT INTO users (id, email, name, plan) VALUES (?, ?, ?, ?)',
    args: [USER, 'speech@example.test', 's', 'plus'],
  });
  for (const type of ['voice_biometric', 'overseas_transfer']) {
    await db.execute({
      sql: `INSERT INTO user_consents (id, user_id, consent_type, agreed, policy_version, agreed_at)
            VALUES (?, ?, ?, 1, ?, datetime('now'))`,
      args: [`c-${type}`, USER, type, CURRENT_POLICY_VERSION],
    });
  }
  // 앱이 죽어 남은 옛 초안 — 평소의 새 등록은 이걸 버린다. 거절은 건드리지 않아야 한다.
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, status, is_draft, elevenlabs_voice_id)
          VALUES (?, ?, ?, 'ready', 1, ?)`,
    args: [OLD_DRAFT, USER, '옛 초안', 'elv-old'],
  });
  // 위의 깔기는 테스트가 한 것이다 — 요청이 보낸 것만 센다.
  executed.length = 0;
  transactionsOpened.length = 0;
});

afterEach(() => {
  while (consoleSpies.length > 0) consoleSpies.pop()!.mockRestore();
});

afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('POST /voice/clone — 말소리가 없으면 등록하지 않는다', () => {
  it.each([
    ['빈 전사', '', 0],
    ['공백뿐', '   \n  ', 0],
    [
      `${MIN_SPEECH_TRANSCRIPT_CHARS - 1}자(앞뒤 공백은 세지 않는다)`,
      `  ${'가'.repeat(MIN_SPEECH_TRANSCRIPT_CHARS - 1)}  `,
      MIN_SPEECH_TRANSCRIPT_CHARS - 1,
    ],
    // 2026-10-11 리뷰: Scribe 는 소리 표시를 기본으로 붙인다(`tag_audio_events`). TV·선풍기·발소리만 든 녹음의 표시는
    // 20자를 넘는다 — 표시는 말소리가 아니다(`speechCharCount`).
    ['소리 표시뿐(20자 넘는 표시)', '(background noise) (footsteps) [music] (door closes)', 0],
    ['소리 표시 사이의 한두 마디', '(laughter) 음… 여보세요 (laughter) (background noise)', '음… 여보세요'.length],
  ])('%s → 400 VOICE_CLONE_NO_SPEECH, 아무것도 쓰지 않고 provider·R2 도 부르지 않는다', async (_label, transcript, speechChars) => {
    mockSpeechToText.mockResolvedValue(transcript);

    const res = await clone();

    expect(res.status).toBe(400);
    // `VOICE_CLONE_AUDIO_TOO_SHORT` 와 같은 모양 — { error, error_code } 하나.
    expect(await res.json()).toEqual({
      error: 'voice clone audio contains too little speech',
      error_code: 'VOICE_CLONE_NO_SPEECH',
    });
    expect(mockSpeechToText).toHaveBeenCalledOnce();
    expect(mockSpeechToText).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      mimeType: 'audio/wav',
      fileName: 'sample.wav',
      deadlineAt: expect.any(Number),
    });
    await expectNothingWritten();
    expect(mockAnalyzeSpeechStyle).not.toHaveBeenCalled();
    // 거절의 기록은 길이 한 줄이다(나가는 4xx 한 줄은 errorCode 미들웨어 몫 — 이 앱에는 없다).
    const checks = logLines.filter((line) => line.includes('"at":"voice.clone.speech_check"'));
    expect(checks).toHaveLength(1);
    expect(JSON.parse(checks[0]!)).toMatchObject({
      level: 'info',
      outcome: 'no_speech',
      transcript_chars: speechChars,
    });
  });

  it(`딱 ${MIN_SPEECH_TRANSCRIPT_CHARS}자면 말소리가 있다 — 말투 분석의 '짧은 전사' 와 같은 경계(같은 상수)다`, async () => {
    mockSpeechToText.mockResolvedValue('가'.repeat(MIN_SPEECH_TRANSCRIPT_CHARS));

    const res = await clone();

    expect(res.status).toBe(201);
    expect(mockCreateInstantClone).toHaveBeenCalledOnce();
    // 대조군 — 문장 기록이 실제로 쓰기를 본다(거절 쪽의 '쓰기 0' 이 빈 기록 때문이 아니다).
    expect(executed.some((sql) => sql.includes('INSERT INTO voice_profiles'))).toBe(true);
    expect(transactionsOpened).toContain('write');
  });

  it('소리 표시는 세지 않을 뿐이다 — 말소리가 있으면 등록하고, 말투 분석에는 표시까지 그대로 넘긴다', async () => {
    const withLaugh = `(laughter) ${SPEECH} (laughter)`;
    mockSpeechToText.mockResolvedValue(withLaugh);
    const { ctx, drain } = fakeExecutionCtx();

    const res = await clone(ctx);
    expect(res.status).toBe(201);
    await drain();

    expect(mockSpeechToText).toHaveBeenCalledOnce();
    expect(mockAnalyzeSpeechStyle).toHaveBeenCalledWith(expect.anything(), withLaugh, 'ko', expect.anything());
    const check = logLines.find((line) => line.includes('"at":"voice.clone.speech_check"'));
    expect(JSON.parse(check!)).toMatchObject({ outcome: 'speech', transcript_chars: SPEECH.length });
  });

  it('다시 녹음하는 데 횟수 제한이 없다 — 거절은 몇 번이든 월 등록 횟수와 초안 집계를 건드리지 않는다', async () => {
    mockSpeechToText.mockResolvedValue('음…');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await clone();
      expect(res.status).toBe(400);
      expect((await res.json()).error_code).toBe('VOICE_CLONE_NO_SPEECH');
    }
    await expectNothingWritten();

    const quota = await buildApp().request('/voice/draft-quota', {}, ENV);
    expect(await quota.json()).toMatchObject({ registration_remaining: 1, used: 0 });

    // 말소리가 있는 녹음은 곧바로 된다.
    mockSpeechToText.mockResolvedValue(SPEECH);
    const res = await clone();
    expect(res.status).toBe(201);
    expect(mockCreateInstantClone).toHaveBeenCalledOnce();
    expect(await count('SELECT COUNT(*) AS n FROM voice_profile_change_ledger')).toBe(0);
    expect(
      Number((await db.execute('SELECT used_count FROM voice_draft_attempt_usage')).rows[0]!.used_count),
    ).toBe(1);
  });

  it('전사는 요청 직전부터 10초 안에 끝나야 한다 — 앱의 60초 대기 안에 provider 등록까지 들어가야 한다', async () => {
    const before = Date.now();
    await clone();
    const after = Date.now();
    const { deadlineAt } = mockSpeechToText.mock.calls[0]![1] as { deadlineAt: number };
    expect(deadlineAt).toBeGreaterThanOrEqual(before + 10_000);
    expect(deadlineAt).toBeLessThanOrEqual(after + 10_000);
  });
});

describe('POST /voice/clone — 전사가 실패하면 막지 않는다(fail-open)', () => {
  const PROVIDER_BODY = 'provider says: quota exceeded for key';
  it.each([
    ['네트워크', new TypeError('fetch failed'), 'TypeError'],
    ['시간 초과', new DOMException('The operation was aborted due to timeout', 'TimeoutError'), 'TimeoutError'],
    ['제공자 5xx', new Error(`ElevenLabs API error 503: ${PROVIDER_BODY}`), 'Error'],
    ['제공자 4xx', new Error(`ElevenLabs API error 401: ${PROVIDER_BODY}`), 'Error'],
  ])('%s → 예전처럼 등록하고, 말투 분석이 스스로 다시 전사한다', async (_label, error, errorName) => {
    mockSpeechToText.mockRejectedValueOnce(error);
    mockSpeechToText.mockResolvedValueOnce(SPEECH);
    const { ctx, drain } = fakeExecutionCtx();

    const res = await clone(ctx);

    expect(res.status).toBe(201);
    expect(mockCreateInstantClone).toHaveBeenCalledOnce();
    const warnings = logLines.filter((line) => line.includes('"at":"voice.clone.speech_check"'));
    expect(warnings).toHaveLength(1);
    expect(JSON.parse(warnings[0]!)).toEqual({
      level: 'warn',
      at: 'voice.clone.speech_check',
      outcome: 'unavailable',
      error: errorName,
    });
    // 오류 이름만 — 제공자 응답 본문은 어떤 줄에도 없다.
    expect(logLines.some((line) => line.includes(PROVIDER_BODY))).toBe(false);

    await drain();
    // 받아 둔 전사가 없으니 분석이 같은 녹음을 다시 전사했다.
    expect(mockSpeechToText).toHaveBeenCalledTimes(2);
    expect(mockAnalyzeSpeechStyle).toHaveBeenCalledWith(expect.anything(), SPEECH, 'ko', expect.anything());
    const profile = await db.execute(
      "SELECT speech_style_status, speech_style FROM voice_profiles WHERE id != 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' AND deleted_at IS NULL",
    );
    expect(profile.rows[0]).toMatchObject({ speech_style_status: 'done', speech_style: JSON.stringify(STYLE) });
  });

  // 2026-10-11 리뷰: 진짜 `speechToText` 가 글(`text`)이 없는 200 답을 빈 글로 바꿔, 응답 모양이 바뀌면(필드 이름·`{}`) 모든
  // 등록이 '말소리 없음'(400)으로 막힐 뻔했다. 여기서는 클라이언트를 목으로 두지 않고 진짜 것으로 그 답을 읽는다(fetch 만 대역).
  it('전사 답에 글(text)이 없으면 — 응답 모양이 바뀌었다 — 실패로 보고 막지 않는다', async () => {
    const realClient = new actualElevenLabs.Client!('test-key');
    mockSpeechToText.mockImplementation((audio: ArrayBuffer, options: Parameters<typeof realClient.speechToText>[1]) =>
      realClient.speechToText(audio, options),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ language_code: 'ko', words: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    try {
      const { ctx, drain } = fakeExecutionCtx();

      const res = await clone(ctx);

      expect(res.status).toBe(201);
      expect(mockCreateInstantClone).toHaveBeenCalledOnce();
      const warnings = logLines.filter((line) => line.includes('"at":"voice.clone.speech_check"'));
      expect(warnings).toHaveLength(1);
      expect(JSON.parse(warnings[0]!)).toEqual({
        level: 'warn',
        at: 'voice.clone.speech_check',
        outcome: 'unavailable',
        error: 'Error',
      });

      // 말투 분석도 같은 답을 받는다 — 녹음에 대해 알아낸 것이 없으니 표준 말투로 덮지 않고 다시 할 수 있는 실패다.
      await drain();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      for (const [url] of fetchSpy.mock.calls) expect(String(url)).toBe('https://api.elevenlabs.io/v1/speech-to-text');
      expect(mockAnalyzeSpeechStyle).not.toHaveBeenCalled();
      const profileId = (await res.json()).profile.id as string;
      const row = await db.execute({
        sql: 'SELECT speech_style, speech_style_status FROM voice_profiles WHERE id = ?',
        args: [profileId],
      });
      expect(row.rows[0]).toMatchObject({ speech_style: null, speech_style_status: 'failed' });
      expect(sentry.captureException).toHaveBeenCalledOnce();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('POST /voice/clone — 등록 한 번에 전사는 한 번', () => {
  it('말소리 확인의 전사를 말투 분석이 그대로 쓴다 — 전사 원문은 어떤 로그에도 없다', async () => {
    const { ctx, drain } = fakeExecutionCtx();

    const res = await clone(ctx);
    expect(res.status).toBe(201);
    await drain();

    expect(mockSpeechToText).toHaveBeenCalledOnce();
    expect(mockAnalyzeSpeechStyle).toHaveBeenCalledOnce();
    expect(mockAnalyzeSpeechStyle).toHaveBeenCalledWith(expect.anything(), SPEECH, 'ko', expect.anything());
    const check = logLines.find((line) => line.includes('"at":"voice.clone.speech_check"'));
    expect(JSON.parse(check!)).toMatchObject({ outcome: 'speech', transcript_chars: SPEECH.length });
    // 한 조각도 — 앞 열 자만 봐도 걸린다.
    expect(logLines.some((line) => line.includes(SPEECH.slice(0, 10)))).toBe(false);
  });
});

describe('말투 분석 — 녹음이 말투를 보여 주지 않은 것은 실패가 아니다', () => {
  it.each(['short_transcript', 'low_confidence', 'nothing_detected'] as const)(
    '등록 분석이 표준 말투(%s)면 speech_style NULL·done, 오류 보고 없음',
    async (reason) => {
      mockAnalyzeSpeechStyle.mockResolvedValue({ kind: 'standard', reason });
      const { ctx, drain } = fakeExecutionCtx();

      const res = await clone(ctx);
      expect(res.status).toBe(201);
      const profileId = (await res.json()).profile.id as string;
      await drain();

      const row = await db.execute({
        sql: 'SELECT speech_style, speech_style_status FROM voice_profiles WHERE id = ?',
        args: [profileId],
      });
      expect(row.rows[0]).toMatchObject({ speech_style: null, speech_style_status: 'done' });
      expect(sentry.captureException).not.toHaveBeenCalled();
      const standard = logLines.filter((line) => line.includes('"at":"voice.speech_style.standard"'));
      expect(standard).toHaveLength(1);
      expect(JSON.parse(standard[0]!)).toMatchObject({ level: 'info', reason });
    },
  );

  it.each(['transport', 'not_configured', 'rejected', 'incomplete', 'unparseable'] as const)(
    '등록 분석이 알아내지 못하면(%s) failed — 재시도 버튼, 오류 보고',
    async (reason) => {
      mockAnalyzeSpeechStyle.mockResolvedValue({ kind: 'failed', reason });
      const { ctx, drain } = fakeExecutionCtx();

      const res = await clone(ctx);
      expect(res.status).toBe(201);
      const profileId = (await res.json()).profile.id as string;
      await drain();

      const row = await db.execute({
        sql: 'SELECT speech_style, speech_style_status FROM voice_profiles WHERE id = ?',
        args: [profileId],
      });
      expect(row.rows[0]).toMatchObject({ speech_style: null, speech_style_status: 'failed' });
      expect(sentry.captureException).toHaveBeenCalledOnce();
    },
  );

  /** 정식 목소리 하나 — 말투 분석이 실패해 재시도를 기다린다. 원본은 R2 대역에, 사전렌더는 이미 끝났다. */
  async function seedRetryableOfficialVoice() {
    const objectKey = `voices/${USER}/source`;
    objects.set(objectKey, {
      bytes: new Uint8Array([9, 8, 7]),
      customMetadata: { userId: USER, mimeType: 'audio/wav', sizeBytes: '3' },
      contentType: 'audio/wav',
    });
    await db.execute({
      sql: `INSERT INTO voice_profiles
              (id, user_id, name, status, is_draft, elevenlabs_voice_id, preview_language, speech_style, speech_style_status)
            VALUES (?, ?, '엄마', 'ready', 0, 'elv-official', 'ko', ?, 'failed')`,
      // 옛 값이 남아 있어도 표준 말투는 그것을 비운다.
      args: [OFFICIAL, USER, JSON.stringify({ ...STYLE, dialect: '전라' })],
    });
    await db.execute({
      sql: `INSERT INTO voice_uploads (id, user_id, object_key, mime_type, size_bytes, original_name, voice_profile_id)
            VALUES ('up-1', ?, ?, 'audio/wav', 3, 'sample.wav', ?)`,
      args: [USER, objectKey, OFFICIAL],
    });
    await db.execute({
      sql: `INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, language, status, attempts, refresh_existing)
            VALUES (?, ?, 'ko', 'done', 1, 0)`,
      args: [OFFICIAL, USER],
    });
  }

  async function retry() {
    return buildApp().request(`/voice/${OFFICIAL}/speech-style/retry`, { method: 'POST' }, ENV);
  }

  it('재시도가 표준 말투면 200 done — speech_style NULL, 이미 구운 클립을 다시 굽지 않는다', async () => {
    await seedRetryableOfficialVoice();
    mockAnalyzeSpeechStyle.mockResolvedValue({ kind: 'standard', reason: 'low_confidence' });

    const res = await retry();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: 'done' });
    const row = await db.execute({
      sql: 'SELECT speech_style, speech_style_status FROM voice_profiles WHERE id = ?',
      args: [OFFICIAL],
    });
    expect(row.rows[0]).toMatchObject({ speech_style: null, speech_style_status: 'done' });
    const queue = await db.execute({
      sql: 'SELECT status, refresh_existing FROM voice_prerender_queue WHERE voice_profile_id = ?',
      args: [OFFICIAL],
    });
    expect(queue.rows[0]).toMatchObject({ status: 'done', refresh_existing: 0 });
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('재시도가 말투를 찾으면 그 말투로 클립을 다시 굽는다(대조군)', async () => {
    await seedRetryableOfficialVoice();

    const res = await retry();

    expect(res.status).toBe(200);
    const queue = await db.execute({
      sql: 'SELECT status, refresh_existing FROM voice_prerender_queue WHERE voice_profile_id = ?',
      args: [OFFICIAL],
    });
    expect(queue.rows[0]).toMatchObject({ status: 'pending', refresh_existing: 1 });
  });

  it('재시도가 알아내지 못하면 502 failed — 다시 누를 수 있다', async () => {
    await seedRetryableOfficialVoice();
    mockAnalyzeSpeechStyle.mockResolvedValue({ kind: 'failed', reason: 'transport' });

    const res = await retry();

    expect(res.status).toBe(502);
    expect((await res.json()).error_code).toBe('SPEECH_STYLE_ANALYSIS_FAILED');
    const row = await db.execute({
      sql: 'SELECT speech_style_status FROM voice_profiles WHERE id = ?',
      args: [OFFICIAL],
    });
    expect(row.rows[0]!.speech_style_status).toBe('failed');
    expect(sentry.captureException).toHaveBeenCalledOnce();
  });
});
