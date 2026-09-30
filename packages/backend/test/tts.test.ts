import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';

const V1 = '40000000-0000-4000-8000-000000000001';
const M1 = '10000000-0000-4000-8000-000000000001';
const M404 = '10000000-0000-4000-8000-0000000000ff';

const mockDB = createMockDB();
const mockTextToSpeech = vi.fn();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

vi.mock('../src/lib/elevenlabs', () => ({
  ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.textToSpeech = mockTextToSpeech;
  }),
}));

const ENV: Env = {
  ELEVENLABS_API_KEY: 'test-key',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

const TOKEN_URI = 'https://oauth2.example.com/token';
let VERTEX_CREDENTIALS_JSON = '';

function toPem(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  const base64 = btoa(binary).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  VERTEX_CREDENTIALS_JSON = JSON.stringify({
    client_email: 'svc@test.iam.gserviceaccount.com',
    private_key: toPem(pkcs8),
    project_id: 'test-project',
    token_uri: TOKEN_URI,
  });
});

function createMockR2Bucket(initial: Record<string, Uint8Array> = {}) {
  const store = new Map<
    string,
    { body: ArrayBuffer; contentType?: string; meta: Record<string, string> }
  >();
  for (const [key, bytes] of Object.entries(initial)) {
    store.set(key, {
      body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      contentType: 'audio/mpeg',
      meta: { mimeType: 'audio/mpeg', userId: 'user-1', sizeBytes: String(bytes.byteLength) },
    });
  }
  const bucket = {
    put: async (
      key: string,
      value: ArrayBufferLike,
      options?: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      },
    ) => {
      const body =
        value instanceof ArrayBuffer ? value : new Uint8Array(value as ArrayBufferLike).buffer;
      store.set(key, {
        body,
        contentType: options?.httpMetadata?.contentType,
        meta: options?.customMetadata ?? {},
      });
    },
    get: async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return {
        customMetadata: item.meta,
        httpMetadata: item.contentType ? { contentType: item.contentType } : undefined,
        size: item.body.byteLength,
        uploaded: new Date('2026-05-01T00:00:00Z'),
        arrayBuffer: async () => item.body,
      };
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, store };
}

import ttsRoutes from '../src/routes/tts';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/tts', ttsRoutes);
  return app;
}

function pushPublicationVoice(overrides: Record<string, string | number | null> = {}) {
  mockDB.pushResult([
    {
      id: V1,
      user_id: 'user-1',
      status: 'ready',
      is_draft: 0,
      elevenlabs_voice_id: 'el-voice-1',
      ...overrides,
    },
  ]);
}

function reqWithEnv(app: Hono<AppEnv>, r: Request) {
  return app.request(r, undefined, ENV);
}

function geminiText(text: string) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

function consentRow(type: string) {
  return { consent_type: type, policy_version: CURRENT_POLICY_VERSION, agreed: 1 };
}

// fakeAuthMiddleware 가 실제 authMiddleware 처럼 userIdPK 를 채우면서 '직접 입력(manual) 월 쿼터'
// 경로가 실제로 실행된다(isManualGeneration = !random && !draft_preview && Boolean(userIdPK)).
// 캐시 미스가 확정된 뒤 합성 직전에 공유풀 조회 2건(plan_groups / subscriptions) + 예약 1건이
// 나가므로, 그 세 결과를 순서대로 큐에 넣어 준다. 넣지 않으면 예약 쿼리가 빈 결과를 받아
// MANUAL_TTS_QUOTA_EXCEEDED(429)로 떨어진다.
function pushManualQuotaFlow() {
  mockDB.pushResult([]); // 1) plan_group 공유 풀 조회 — 소속 그룹 없음
  mockDB.pushResult([]); // 2) 개인 활성 구독 조회 — 없음 → users.plan 폴백(plus → personal, 30회)
  mockDB.pushResult([{ used_count: 1, usage_month: '2026-07' }], 1); // 3) 원자적 +1 예약 성공
}

beforeEach(() => {
  mockDB.reset();
  mockTextToSpeech.mockReset();
});

describe('POST /tts/generate — TTS 생성', () => {
  it('draft 음성은 명시적인 미리듣기 요청 외 일반 TTS에 사용할 수 없다', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', is_draft: 1, elevenlabs_voice_id: 'el-draft' }]);
    const app = buildApp();

    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: '임의 문구' }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('VOICE_DRAFT_NOT_USABLE');
    expect(mockTextToSpeech).not.toHaveBeenCalled();
  });

  it('draft 미리듣기는 요청 text를 무시하고 고정 문구를 합성한 뒤 완료 시각을 기록한다', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([
      {
        id: V1,
        user_id: 'user-1',
        status: 'ready',
        is_draft: 1,
        elevenlabs_voice_id: 'el-draft',
        listener_title: '우리 아들',
      },
    ]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]);
    pushPublicationVoice({
      is_draft: 1,
      elevenlabs_voice_id: 'el-draft',
      listener_title: '우리 아들',
    });
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([1, 2]).buffer);

    const res = await reqWithEnv(
      buildApp(),
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        text: '공격자가 바꾼 문구',
        language: 'ko',
        draft_preview: true,
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.text).toBe('우리 아들, 좋은 아침이야. 오늘도 기분 좋게 일어나자.');
    // 태그를 붙이지 않는다(2026-09-30) — 화면 문구 그대로 합성한다.
    expect(body.synthesis_text).toBe(body.text);
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'el-draft',
      body.synthesis_text,
      expect.any(Object),
    );
    expect(body.preview_playback_token).toBeTypeOf('string');
    expect(body.preview_playback_confirmed).toBe(false);
    expect(mockDB.calls.some((call) => call.sql.includes('SET previewed_at = datetime'))).toBe(
      false,
    );
    expect(mockDB.calls.some((call) => call.sql.includes('INSERT INTO message_library'))).toBe(
      false,
    );
    const claimCall = mockDB.calls.find((call) => call.sql.includes('preview_claim_token = ?'));
    expect(claimCall?.sql).toContain("COALESCE(relationship_label, '') = ?");
    expect(claimCall?.sql).toContain("COALESCE(listener_title, '') = ?");
    // 목소리의 결도 페르소나다 — 결만 바뀐 PATCH 뒤의 낡은 요청이 claim 을 잡지 못해야 한다(Codex #802).
    expect(claimCall?.sql).toContain("COALESCE(voice_energy, '') = ?");
    // `preview_tag` 는 읽지도 쓰지도 않는다(다음 회차에 DROP).
    expect(claimCall?.sql).not.toContain('preview_tag');
  });

  // ⚠ iOS `playDraftPreview` 는 **`random:true` 와 `draft_preview:true` 를 함께** 보낸다
  // (`VoiceStudioViewModel`). 라이브 랜덤 거절(`RANDOM_TTS_RETIRED`)이 `body.random` 만 보거나
  // draft 판정보다 앞에 오면 이 요청이 400 이 되어 **새 목소리를 아예 등록할 수 없다.**
  it('iOS 미리듣기 모양(random:true + draft_preview:true)은 거절되지 않고 미리듣기로 합성한다', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([
      {
        id: V1,
        user_id: 'user-1',
        status: 'ready',
        is_draft: 1,
        elevenlabs_voice_id: 'el-draft',
        listener_title: '우리 아들',
      },
    ]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]);
    pushPublicationVoice({
      is_draft: 1,
      elevenlabs_voice_id: 'el-draft',
      listener_title: '우리 아들',
    });
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([1, 2]).buffer);

    const res = await reqWithEnv(
      buildApp(),
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        text: '',
        category: 'morning',
        language: 'ko',
        translate: false,
        random: true,
        listener_title: '우리 아들',
        draft_preview: true,
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.text).toBe('우리 아들, 좋은 아침이야. 오늘도 기분 좋게 일어나자.');
    expect(body.random_context ?? null).toBeNull();
    expect(mockTextToSpeech).toHaveBeenCalledWith('el-draft', body.synthesis_text, expect.any(Object));
    expect(mockDB.calls.some((call) => call.sql.includes('INSERT INTO message_library'))).toBe(false);
  });

  it('draft 미리듣기는 Vertex 설정 시 관계·호칭 톤 적응 문구로 합성한다', async () => {
    const toneText = '우리 아들, 잘 잤어? 오늘도 기분 좋게 하루 시작해 보자.';
    const mockFetch = vi.fn(async (url: unknown) => {
      if (String(url) === TOKEN_URI) {
        return new Response(JSON.stringify({ access_token: 'test-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      // Gemini 톤 적응 생성 응답 — {text} JSON(태그 없음)
      return geminiText(JSON.stringify({ text: toneText }));
    });
    vi.stubGlobal('fetch', mockFetch);
    try {
      mockDB.pushResult([{ plan: 'plus' }]);
      mockDB.pushResult([
        {
          id: V1,
          user_id: 'user-1',
          status: 'ready',
          is_draft: 1,
          elevenlabs_voice_id: 'el-draft',
          relationship_label: '엄마',
          listener_title: '우리 아들',
        },
      ]);
      mockDB.pushResult([], 1); // preview_text 영속 UPDATE
      mockDB.pushResult([], 1); // preview claim UPDATE
      mockDB.pushResult([]);
      pushPublicationVoice({
        is_draft: 1,
        elevenlabs_voice_id: 'el-draft',
        relationship_label: '엄마',
        listener_title: '우리 아들',
      });
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);
      mockTextToSpeech.mockResolvedValue(new Uint8Array([1, 2]).buffer);

      const res = await buildApp().request(
        jsonReq('POST', '/tts/generate', {
          voice_profile_id: V1,
          language: 'ko',
          draft_preview: true,
        }),
        undefined,
        { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: VERTEX_CREDENTIALS_JSON },
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      // 고정 예문이 아니라 관계·호칭 톤 적응 생성 문구로 합성/표시된다.
      expect(body.text).toBe(toneText);
      expect(body.synthesis_text).toBe(toneText);
      expect(mockTextToSpeech).toHaveBeenCalledWith(
        'el-draft',
        body.synthesis_text,
        expect.any(Object),
      );
      expect(body.preview_playback_token).toBeTypeOf('string');
      // 생성 문구를 draft 행에 영속해 이후 재생이 같은 문구(=캐시 히트)로 성립하게 한다.
      const persist = mockDB.calls.find((call) => call.sql.includes('SET preview_text'));
      expect(persist).toBeDefined();
      expect(persist!.args).toContain(toneText);
      // 확정/활성 claim 중에는 저장 금지(늦은 영속이 실제 합성 문구와 어긋나는 것 방지).
      expect(persist!.sql).toContain('previewed_at IS NULL');
      expect(persist!.sql).toContain('preview_claimed_at IS NULL');
      expect(persist!.sql).not.toContain('preview_tag');
      // 태그·웃음을 쓰게 하지 않는다(2026-09-30).
      const vertexBodies = mockFetch.mock.calls
        .filter((call) => String(call[0]) !== TOKEN_URI)
        .map((call) => String(((call as unknown[])[1] as RequestInit | undefined)?.body ?? ''));
      expect(vertexBodies.length).toBeGreaterThan(0);
      expect(vertexBodies.every((b) => !b.includes('LAUGHTER: a laugh is a sound'))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // ⚠ **첫 미리듣기는 말투 분석을 잠깐 기다린다**(Codex #802). 등록 화면은 클론 직후 곧바로 미리듣기를
  // 부르고 분석은 그 뒤에 돈다 — 안 기다리면 결 없이 만든 문구가 영속되고 사용자가 그걸 확정한다.
  it('첫 미리듣기는 분석이 끝나기를 기다렸다가 그 말투·결로 만든다', async () => {
    const calmStyle = JSON.stringify({
      dialect: '', strength: '', register: 'banmal', markers: [], persona: '', childlike: false, energy: 'calm',
    });
    const prompts: string[] = [];
    const mockFetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) === TOKEN_URI) {
        return new Response(JSON.stringify({ access_token: 'test-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      prompts.push(String(init?.body ?? ''));
      return geminiText(JSON.stringify({ text: '우리 아들, 이제 일어날 시간이야. 천천히 시작하자.' }));
    });
    vi.stubGlobal('fetch', mockFetch);
    try {
      mockDB.pushResult([{ plan: 'plus' }]);
      mockDB.pushResult([
        {
          id: V1, user_id: 'user-1', status: 'ready', is_draft: 1, elevenlabs_voice_id: 'el-draft',
          relationship_label: '엄마', listener_title: '우리 아들',
          speech_style_status: 'pending', speech_style: null,
        },
      ]);
      mockDB.pushResult([{ speech_style: calmStyle, analysis_pending: 0 }]); // 분석 대기 — 곧바로 끝나 있다
      mockDB.pushResult([], 1); // preview_text 영속
      mockDB.pushResult([], 1); // preview claim
      mockDB.pushResult([]);
      pushPublicationVoice({ is_draft: 1, elevenlabs_voice_id: 'el-draft', relationship_label: '엄마', listener_title: '우리 아들' });
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);
      mockTextToSpeech.mockResolvedValue(new Uint8Array([1, 2]).buffer);

      const res = await buildApp().request(
        jsonReq('POST', '/tts/generate', { voice_profile_id: V1, language: 'ko', draft_preview: true }),
        undefined,
        { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: VERTEX_CREDENTIALS_JSON },
      );
      expect(res.status).toBe(201);
      const waitCall = mockDB.calls.find((call) => call.sql.includes('AS analysis_pending'));
      expect(waitCall).toBeDefined();
      // 방금 끝난 분석의 결(차분)이 생성 프롬프트에 실린다 — 스냅샷(`speech_style: null`)이 아니라.
      expect(prompts.some((body) => body.includes('VOICE ENERGY') && body.includes('CALM'))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // 생성이 실패하면 고정 예문을 태그 없이 합성하고 영속하지 않는다 — 다음 미리듣기가 다시 만든다.
  it('분석 뒤 생성이 실패하면 고정 예문을 태그 없이 합성하고 영속하지 않는다', async () => {
    const calmStyle = JSON.stringify({
      dialect: '', strength: '', register: 'banmal', markers: [], persona: '', childlike: false, energy: 'calm',
    });
    const mockFetch = vi.fn(async (url: unknown) => {
      if (String(url) === TOKEN_URI) {
        return new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 });
      }
      return new Response('upstream down', { status: 503 });
    });
    vi.stubGlobal('fetch', mockFetch);
    try {
      mockDB.pushResult([{ plan: 'plus' }]);
      mockDB.pushResult([
        {
          id: V1, user_id: 'user-1', status: 'ready', is_draft: 1, elevenlabs_voice_id: 'el-draft',
          listener_title: '우리 아들', speech_style_status: 'pending',
        },
      ]);
      mockDB.pushResult([{ speech_style: calmStyle, analysis_pending: 0 }]);
      mockDB.pushResult([], 1); // preview claim
      mockDB.pushResult([]);
      pushPublicationVoice({ is_draft: 1, elevenlabs_voice_id: 'el-draft', listener_title: '우리 아들' });
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);
      mockTextToSpeech.mockResolvedValue(new Uint8Array([1, 2]).buffer);

      const res = await buildApp().request(
        jsonReq('POST', '/tts/generate', { voice_profile_id: V1, language: 'ko', draft_preview: true }),
        undefined,
        { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: VERTEX_CREDENTIALS_JSON },
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.synthesis_text).toBe('우리 아들, 좋은 아침이야. 오늘도 기분 좋게 일어나자.');
      const claim = mockDB.calls.find((call) => call.sql.includes('preview_claim_token = ?'));
      expect(claim!.sql).not.toContain('preview_tag');
      expect(mockDB.calls.some((call) => call.sql.includes('SET preview_text'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('분석이 상한까지 안 끝나면 생성하지 않고 고정 예문으로 들려주며 영속하지 않는다', async () => {
    const mockFetch = vi.fn(async (url: unknown) => {
      if (String(url) === TOKEN_URI) {
        return new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 });
      }
      throw new Error('analysis still pending — must not call Vertex');
    });
    vi.stubGlobal('fetch', mockFetch);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      mockDB.pushResult([{ plan: 'plus' }]);
      mockDB.pushResult([
        {
          id: V1, user_id: 'user-1', status: 'ready', is_draft: 1, elevenlabs_voice_id: 'el-draft',
          listener_title: '우리 아들', speech_style_status: 'pending',
        },
      ]);
      for (let i = 0; i < 6; i += 1) mockDB.pushResult([{ speech_style: null, analysis_pending: 1 }]);
      mockDB.pushResult([], 1); // preview claim
      mockDB.pushResult([]);
      pushPublicationVoice({ is_draft: 1, elevenlabs_voice_id: 'el-draft', listener_title: '우리 아들' });
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);
      mockTextToSpeech.mockResolvedValue(new Uint8Array([1, 2]).buffer);

      const pending = buildApp().request(
        jsonReq('POST', '/tts/generate', { voice_profile_id: V1, language: 'ko', draft_preview: true }),
        undefined,
        { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: VERTEX_CREDENTIALS_JSON },
      );
      for (let i = 0; i < 8; i += 1) await vi.advanceTimersByTimeAsync(3_000);
      const res = await pending;

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.text).toBe('우리 아들, 좋은 아침이야. 오늘도 기분 좋게 일어나자.');
      expect(mockDB.calls.filter((call) => call.sql.includes('AS analysis_pending'))).toHaveLength(6);
      // 영속하지 않아야 다음 미리듣기가 분석 뒤에 다시 만든다. 확정돼도 재생은 같은 고정 예문이다.
      expect(mockDB.calls.some((call) => call.sql.includes('SET preview_text'))).toBe(false);
      expect(mockFetch.mock.calls.some((call) => String(call[0]) !== TOKEN_URI)).toBe(false);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('동시 첫-미리듣기 레이스에서 진 쪽은 승자의 preview_text 를 재사용한다', async () => {
    const loserText = '우리 아들, 오늘도 상쾌하게 일어나 볼까?';
    const winnerText = '우리 아들, 잘 잤어? 오늘 하루도 힘내자.';
    const mockFetch = vi.fn(async (url: unknown) => {
      if (String(url) === TOKEN_URI) {
        return new Response(JSON.stringify({ access_token: 'test-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return geminiText(JSON.stringify({ text: loserText }));
    });
    vi.stubGlobal('fetch', mockFetch);
    try {
      mockDB.pushResult([{ plan: 'plus' }]);
      mockDB.pushResult([
        {
          id: V1,
          user_id: 'user-1',
          status: 'ready',
          is_draft: 1,
          elevenlabs_voice_id: 'el-draft',
          relationship_label: '엄마',
          listener_title: '우리 아들',
        },
      ]);
      mockDB.pushResult([], 0); // 조건부 영속 실패(다른 요청이 먼저 씀)
      mockDB.pushResult([{ preview_text: winnerText }]); // 승자 재조회
      mockDB.pushResult([], 1); // preview claim
      mockDB.pushResult([]);
      pushPublicationVoice({
        is_draft: 1,
        elevenlabs_voice_id: 'el-draft',
        relationship_label: '엄마',
        listener_title: '우리 아들',
      });
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);
      mockTextToSpeech.mockResolvedValue(new Uint8Array([1, 2]).buffer);

      const res = await buildApp().request(
        jsonReq('POST', '/tts/generate', {
          voice_profile_id: V1,
          language: 'ko',
          draft_preview: true,
        }),
        undefined,
        { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: VERTEX_CREDENTIALS_JSON },
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      // 진 쪽의 새 생성 문구(loserText)가 아니라 이미 영속된 승자 문구로 합성된다.
      expect(body.text).toBe(winnerText);
      expect(body.synthesis_text).toBe(winnerText);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // ⚠ **결만 바꾼 PATCH 도 생성 왕복을 낡게 만든다**(Codex #802). 첫 미리듣기가 Gemini 를 기다리는
  // 사이 사용자가 결을 '차분' 으로 바꾸면 PATCH 가 preview_text 를 비운다. 이 요청은 옛 결로 만든
  // 문구를 들고 있으므로 **저장도 합성도 하면 안 된다** — 저장하면 이후 미리듣기가 그 문구를 재사용한다.
  it('생성 왕복 중 목소리의 결이 바뀌면 옛 결 문구를 저장하지도 합성하지도 않는다', async () => {
    const staleText = '우리 아들, 잘 잤어? 오늘도 신나게 시작하자!';
    const mockFetch = vi.fn(async (url: unknown) => {
      if (String(url) === TOKEN_URI) {
        return new Response(JSON.stringify({ access_token: 'test-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return geminiText(JSON.stringify({ text: staleText }));
    });
    vi.stubGlobal('fetch', mockFetch);
    try {
      mockDB.pushResult([{ plan: 'plus' }]);
      mockDB.pushResult([
        {
          id: V1,
          user_id: 'user-1',
          status: 'ready',
          is_draft: 1,
          elevenlabs_voice_id: 'el-draft',
          relationship_label: '엄마',
          listener_title: '우리 아들',
          voice_energy: 'lively',
        },
      ]);
      mockDB.pushResult([], 0); // 영속 실패 — PATCH 가 결을 바꿨다
      mockDB.pushResult([{ preview_text: null }]); // 승자 없음(PATCH 가 비웠다)
      mockDB.pushResult([], 0); // claim 실패 — 결이 달라 잡지 못한다

      const res = await buildApp().request(
        jsonReq('POST', '/tts/generate', {
          voice_profile_id: V1,
          language: 'ko',
          draft_preview: true,
        }),
        undefined,
        { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: VERTEX_CREDENTIALS_JSON },
      );

      expect(res.status).toBe(409);
      expect((await res.json()).error_code).toBe('VOICE_PREVIEW_IN_PROGRESS');
      expect(mockTextToSpeech).not.toHaveBeenCalled();
      const persist = mockDB.calls.find((call) => call.sql.includes('SET preview_text'));
      expect(persist!.sql).toContain("COALESCE(voice_energy, '') = ?");
      // 비교 값은 요청이 읽은 그 결이다.
      expect(persist!.args.at(-1)).toBe('lively');
      const claim = mockDB.calls.find((call) => call.sql.includes('preview_claim_token = ?'));
      expect(claim!.args.at(-1)).toBe('lively');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('확정됐지만 preview_text 없는 레거시 draft 재생은 새로 생성하지 않는다(고정 폴백 유지)', async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error('legacy replay must not call Vertex');
    });
    vi.stubGlobal('fetch', mockFetch);
    try {
      mockDB.pushResult([{ plan: 'plus' }]);
      mockDB.pushResult([
        {
          id: V1,
          user_id: 'user-1',
          status: 'ready',
          is_draft: 1,
          elevenlabs_voice_id: 'el-draft',
          relationship_label: '엄마',
          listener_title: '우리 아들',
          previewed_at: '2026-07-15 00:00:00',
        },
      ]);
      // previewed_at 이 있으므로 claim 없음. 캐시 미스(mock 빈 결과) → 409 VOICE_PREVIEW_UNAVAILABLE
      // 가 정상 경로다(실환경에선 고정 문구가 이미 합성돼 있어 캐시 히트로 재생됨). 핵심 단언은
      // '생성/영속을 시도하지 않는다' — 새 문구를 만들면 캐시 키가 어긋나 재생이 영구히 깨진다.
      const res = await buildApp().request(
        jsonReq('POST', '/tts/generate', {
          voice_profile_id: V1,
          language: 'ko',
          draft_preview: true,
        }),
        undefined,
        { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: VERTEX_CREDENTIALS_JSON },
      );

      expect(res.status).toBe(409);
      expect((await res.json()).error_code).toBe('VOICE_PREVIEW_UNAVAILABLE');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockDB.calls.some((call) => call.sql.includes('SET preview_text'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('draft 미리듣기는 저장된 preview_text 가 있으면 재생성 없이 재사용한다', async () => {
    const storedText = '우리 아들, 잘 잤어? 오늘도 힘내 보자.';
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([
      {
        id: V1,
        user_id: 'user-1',
        status: 'ready',
        is_draft: 1,
        elevenlabs_voice_id: 'el-draft',
        relationship_label: '엄마',
        listener_title: '우리 아들',
        preview_text: storedText,
      },
    ]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]);
    pushPublicationVoice({
      is_draft: 1,
      elevenlabs_voice_id: 'el-draft',
      relationship_label: '엄마',
      listener_title: '우리 아들',
    });
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([1, 2]).buffer);

    const res = await reqWithEnv(
      buildApp(),
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        language: 'ko',
        draft_preview: true,
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    // 고정 예문/새 생성이 아니라 저장된 문구 그대로 — 재생이 결정적(같은 캐시키)이다.
    expect(body.text).toBe(storedText);
    expect(body.synthesis_text).toBe(storedText);
    // 재사용 경로는 재생성/재영속하지 않는다.
    expect(mockDB.calls.some((call) => call.sql.includes('SET preview_text'))).toBe(false);
  });

  // 예전에는 문장마다 태그를 붙이다 200자 상한을 넘겨 태그를 줄이는 폴백이 있었다. 이제 태그를 붙이지 않으므로
  // 200자에 가까운 저장 문구도 그대로 합성된다(TEXT_TOO_LONG 아님).
  it('200자에 가까운 저장 문구도 태그 없이 그대로 합성한다', async () => {
    const storedText = `${'a'.repeat(90)}. ${'c'.repeat(103)}.`;
    expect(storedText.length).toBe(196);
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([
      {
        id: V1,
        user_id: 'user-1',
        status: 'ready',
        is_draft: 1,
        elevenlabs_voice_id: 'el-draft',
        relationship_label: '엄마',
        listener_title: '우리 아들',
        preview_text: storedText,
      },
    ]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]);
    pushPublicationVoice({
      is_draft: 1,
      elevenlabs_voice_id: 'el-draft',
      relationship_label: '엄마',
      listener_title: '우리 아들',
    });
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([1, 2]).buffer);

    const res = await reqWithEnv(
      buildApp(),
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        language: 'ko',
        draft_preview: true,
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.synthesis_text).toBe(storedText);
    expect(body.text).toBe(storedText);
  });

  it('합성 중 민감 동의를 철회하면 생성 결과를 게시하지 않는다', async () => {
    mockDB.setConsentMissing(true);
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([
      {
        id: V1,
        user_id: 'user-1',
        status: 'ready',
        is_draft: 1,
        elevenlabs_voice_id: 'el-draft',
        relationship_label: '엄마',
        listener_title: '우리 아들',
      },
    ]);
    mockDB.pushResult([
      { consent_type: 'voice_biometric', policy_version: CURRENT_POLICY_VERSION, agreed: 1 },
      { consent_type: 'overseas_transfer', policy_version: CURRENT_POLICY_VERSION, agreed: 1 },
    ]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]);
    pushPublicationVoice({
      is_draft: 1,
      elevenlabs_voice_id: 'el-draft',
      relationship_label: '엄마',
      listener_title: '우리 아들',
    });
    mockDB.pushResult([]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([1, 2]).buffer);

    const res = await reqWithEnv(
      buildApp(),
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        language: 'ko',
        draft_preview: true,
      }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('CONSENT_REQUIRED');
    expect(mockDB.calls.some((call) => call.sql.includes('INSERT INTO messages'))).toBe(false);
  });
  it('필수 필드 없으면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/tts/generate', {}));
    expect(res.status).toBe(400);
  });

  it('잘못된 voice_profile_id 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: 'bad', text: 'hi' }),
    );
    expect(res.status).toBe(400);
  });

  it('텍스트 200자 초과면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'x'.repeat(201) }),
    );
    expect(res.status).toBe(400);
  });

  it('잘못된 카테고리면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        text: 'hello',
        category: 'invalid',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('음성 프로필 없으면 404', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(404);
  });

  it('음성 프로필 ready 아니면 400', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'processing', elevenlabs_voice_id: null }]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('not ready');
  });
});

describe('GET /tts/messages — 메시지 목록', () => {
  it('빈 목록 반환', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(0);
    expect(body.total).toBe(0);
    expect(mockDB.calls[0]!.sql).toContain('COALESCE(visible_vp.is_draft, 0) = 0');
    expect(mockDB.calls[0]!.sql).toContain('COALESCE(m.is_preset, 0) = 0');
    expect(mockDB.calls[0]!.sql).toContain('FROM message_library ml');
  });

  it('메시지 목록 반환', async () => {
    mockDB.pushResult([{ total: 2 }]);
    mockDB.pushResult([
      { id: M1, text: 'hello', category: 'morning' },
      { id: M404, text: 'bye', category: 'custom' },
    ]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('카테고리 필터 적용', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: M1, text: 'hello', category: 'morning' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages?category=morning'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
  });

  it('잘못된 voice_profile_id 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages?voice_profile_id=bad'));
    expect(res.status).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — POST /tts/generate                                    */
/* ------------------------------------------------------------------ */
describe('POST /tts/generate — edge cases', () => {
  // 기대값 변경: 예전엔 'user 미존재 → 사용량 체크 건너뛰고 404' 를 봤는데, 그 건너뛰기는
  // userIdPK 가 비어 있을 때만 도는 분기다(tts.ts: `else if (resolvedUserPk) return 403`).
  // 실제 authMiddleware 는 users 행을 못 찾으면 401 이라 라우트에 도달하는 요청은 항상
  // userIdPK 를 갖는다 — 인증 이후 계정이 사라진 상태의 정답은 fail-closed 403 이다.
  // fakeAuthMiddleware 가 userIdPK 를 심게 되면서 이제 그 실제 경로를 검증한다.
  it('인증 후 users 행이 없으면 유료 게이트로 fail-closed 403', async () => {
    mockDB.pushResult([]); // users: empty
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
    expect(mockTextToSpeech).not.toHaveBeenCalled();
  });

  it('elevenlabs_voice_id 없으면 NO_VOICE_ID 400', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: null }]);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NO_VOICE_ID');
  });

  it('blocks custom voice TTS when voice_biometric consent is missing', async () => {
    mockDB.setConsentMissing(true);
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);

    const res = await reqWithEnv(
      buildApp(),
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('CONSENT_REQUIRED');
    expect(body.consent).toBe('voice_biometric');
    expect(mockTextToSpeech).not.toHaveBeenCalled();
  });

  it('blocks custom voice TTS when overseas_transfer consent is missing', async () => {
    mockDB.setConsentMissing(true);
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([consentRow('voice_biometric')]);

    const res = await reqWithEnv(
      buildApp(),
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('CONSENT_REQUIRED');
    expect(body.consent).toBe('overseas_transfer');
    expect(mockTextToSpeech).not.toHaveBeenCalled();
  });

  it('blocks system voice TTS when overseas_transfer consent is missing', async () => {
    mockDB.setConsentMissing(true);
    // 기본(시스템) 목소리로 합성하는 요청은 이제 **유료 직접 입력** 하나다(라이브 랜덤 프리셋은
    // `RANDOM_TTS_RETIRED` 로 거절된다). 유료(plus)라 `manualTextOnSystemVoice` 갈래로 합성 직전
    // 동의 게이트에 도달한다. 문구는 ko 라 요청 기본 언어와 맞아 언어 불일치 게이트도 피한다.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([
      { id: V1, status: 'ready', is_system: 1, elevenlabs_voice_id: 'el-system-1' },
    ]); // user_consents (setConsentMissing → 큐 소비, 빈 결과 = 미동의)
    mockDB.pushResult([]);

    const res = await reqWithEnv(
      buildApp(),
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        text: '약 먹을 시간이야',
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('CONSENT_REQUIRED');
    expect(body.consent).toBe('overseas_transfer');
    expect(mockTextToSpeech).not.toHaveBeenCalled();
  });

  it('ElevenLabs 실패 시 500 + 제공자 원문 미노출(K1)', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]); // cache lookup (miss)
    pushManualQuotaFlow(); // userIdPK 가 채워져 직접 입력 쿼터 예약이 실제로 실행된다
    mockTextToSpeech.mockRejectedValue(new Error('ElevenLabs quota exceeded'));
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('TTS_GENERATION_FAILED');
    // K1: 제공자 응답 원문은 detail 로 반사하지 않고 안정 에러코드만 노출한다.
    expect(body.detail).toBe('TTS_GENERATION_FAILED');
    expect(JSON.stringify(body)).not.toContain('ElevenLabs quota exceeded');
  });

  it('ElevenLabs가 비-Error를 throw해도 detail 은 안정 코드(K1)', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]); // cache lookup (miss)
    pushManualQuotaFlow(); // userIdPK 가 채워져 직접 입력 쿼터 예약이 실제로 실행된다
    mockTextToSpeech.mockRejectedValue('raw string error');
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toBe('TTS_GENERATION_FAILED');
  });

  it('성공 시 201 + message_id, audio_base64, category 기본값 custom', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
    pushManualQuotaFlow(); // userIdPK 가 채워져 직접 입력 쿼터 예약이 실제로 실행된다
    mockTextToSpeech.mockResolvedValue(new Uint8Array([72, 101]).buffer);
    pushPublicationVoice();
    mockDB.pushResult([], 1); // INSERT messages
    mockDB.pushResult([], 1); // INSERT message_library
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message_id).toBeDefined();
    expect(body.audio_base64).toBeDefined();
    expect(body.audio_format).toBe('mp3');
    expect(body.voice_profile_id).toBe(V1);
    // category defaults to 'custom'
    const insertSql = mockDB.calls.find((c) => c.sql.includes('INSERT INTO messages'));
    expect(insertSql!.args[6]).toBe('custom');
  });

  it('R2 bucket configured: stores generated TTS under a deterministic cache object key', async () => {
    const r2 = createMockR2Bucket();
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]); // cache lookup (miss)
    pushManualQuotaFlow(); // userIdPK 가 채워져 직접 입력 쿼터 예약이 실제로 실행된다
    mockTextToSpeech.mockResolvedValue(new Uint8Array([72, 101]).buffer);
    pushPublicationVoice();
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
      undefined,
      { ...ENV, VOICE_BUCKET: r2.bucket },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.cache_hit).toBe(false);
    expect(body.cache_key).toBeDefined();
    expect(body.audio_object_key).toContain(`generated-tts/${encodeURIComponent('user-1')}/`);
    expect([...r2.store.keys()][0]).toBe(body.audio_object_key);
    expect(mockTextToSpeech).toHaveBeenCalledOnce();

    const cacheInsert = mockDB.calls.find((c) =>
      c.sql.includes('INSERT OR IGNORE INTO generated_audio_assets'),
    );
    expect(cacheInsert).toBeDefined();
    expect(cacheInsert!.args).toContain(body.cache_key);
  });

  it('generated audio cache hit skips provider calls', async () => {
    const objectKey = 'generated-tts/user-1/cached.mp3';
    const r2 = createMockR2Bucket({ [objectKey]: new Uint8Array([67, 72]) });
    // userIdPK 가 채워지며 플랜 게이트가 실제로 동작한다 — free + 커스텀(비시스템) 보이스는
    // 직접 입력 자체가 403 이라 캐시 히트까지 도달하지 못한다. 이 테스트의 관심사는 '캐시 히트가
    // 제공자 호출을 건너뛰는가' 이므로 시나리오가 성립하는 유료 플랜 행으로 바꾼다.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([
      {
        message_id: M1,
        provider: 'elevenlabs',
        text: 'hello',
        audio_url: `r2://${objectKey}`,
        audio_object_key: objectKey,
        audio_format: 'mp3',
      },
    ]);
    // 캐시 히트도 **지금 목소리인지** 다시 확인한다(Codex #703 P1) — 그 조회분.
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    // ⚠ **캐시 히트도 직접 입력이면 한 번으로 센다**(2026-09-07 규칙 변경).
    //   한도의 뜻이 "합성했는가" 가 아니라 "폰에 없어서 서버에 달라고 했는가" 로 바뀌었다.
    pushManualQuotaFlow();
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
      undefined,
      { ...ENV, VOICE_BUCKET: r2.bucket },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cache_hit).toBe(true);
    expect(body.message_id).toBe(M1);
    expect(body.audio_base64).toBe('Q0g=');
    expect(mockTextToSpeech).not.toHaveBeenCalled();
    expect(mockDB.calls.some((c) => c.sql.includes('INSERT INTO messages'))).toBe(false);
    // 합성은 건너뛰되 **횟수는 줄어든다** — 앱이 화면 숫자를 갱신할 수 있게 응답에 싣는다.
    expect(
      mockDB.calls.some((c) => c.sql.includes('INSERT INTO manual_tts_usage')),
    ).toBe(true);
    expect(body.manual_quota).toEqual({ used: 1, limit: 30, remaining: 29 });
  });

  it('캐시 히트 뒤에 실패하면 예약한 횟수를 환불한다 — 못 받은 오디오로 차감하지 않는다', async () => {
    const objectKey = 'generated-tts/user-1/cached.mp3';
    const r2 = createMockR2Bucket({ [objectKey]: new Uint8Array([67, 72]) });
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([
      {
        message_id: M1,
        provider: 'elevenlabs',
        text: 'hello',
        audio_url: `r2://${objectKey}`,
        audio_object_key: objectKey,
        audio_format: 'mp3',
      },
    ]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    pushManualQuotaFlow();
    // 예약과 응답 사이에 남아 있는 DB 쓰기(LRU 갱신)가 터진 상황.
    mockDB.pushErrorFor('voice_profiles SET last_used_at', new Error('db unavailable'));

    const res = await buildApp().request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
      undefined,
      { ...ENV, VOICE_BUCKET: r2.bucket },
    );

    expect(res.status).toBe(500);
    expect((await res.json()).error_code).toBe('TTS_GENERATION_FAILED');
    // 히트 예약도 캐시 미스와 똑같이 되돌아와야 한다 — 안 그러면 재시도할 때마다 또 깎인다.
    const refund = mockDB.calls.find((c) => c.sql.includes('used_count = used_count - 1'));
    expect(refund).toBeDefined();
    expect(refund!.args).toEqual(['user-1', '2026-07']);
  });

  it('checks the provider cache key before synthesizing', async () => {
    const objectKey = 'generated-tts/user-1/eleven-cached.mp3';
    const r2 = createMockR2Bucket({ [objectKey]: new Uint8Array([69, 76]) });
    // 위와 동일 — free 플랜은 커스텀 보이스 직접 입력이 403 이라 캐시 키 검사 전에 막힌다.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([
      {
        id: V1,
        status: 'ready',
        elevenlabs_voice_id: 'el-voice-1',
      },
    ]);
    mockDB.pushResult([
      {
        message_id: M1,
        provider: 'elevenlabs',
        text: 'hello',
        audio_url: `r2://${objectKey}`,
        audio_object_key: objectKey,
        audio_format: 'mp3',
      },
    ]);
    // 캐시 히트도 **지금 목소리인지** 다시 확인한다(Codex #703 P1) — 그 조회분.
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    // 캐시 히트도 직접 입력이면 한 번으로 센다(2026-09-07) — 그 예약분.
    pushManualQuotaFlow();

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
      undefined,
      { ...ENV, VOICE_BUCKET: r2.bucket },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cache_hit).toBe(true);
    expect(body.provider).toBe('elevenlabs');
    expect(body.audio_base64).toBe('RUw=');
    expect(mockTextToSpeech).not.toHaveBeenCalled();
  });

  it('성공 시 category 명시하면 해당 category 저장', async () => {
    // 직접 입력(수동) 경로는 유료 전용 — userIdPK 가 채워지며 페이월이 실제로 판정되므로
    // free 대신 유료 플랜 행을 넣는다(테스트 관심사는 category 저장값).
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
    pushManualQuotaFlow(); // 캐시 미스 후 직접 입력 쿼터 예약이 실제로 실행된다
    mockTextToSpeech.mockResolvedValue(new Uint8Array([1]).buffer);
    pushPublicationVoice();
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'test', category: 'morning' }),
    );
    expect(res.status).toBe(201);
    const insertSql = mockDB.calls.find((c) => c.sql.includes('INSERT INTO messages'));
    expect(insertSql!.args[6]).toBe('morning');
  });

  // 2026-09-30: 직접 입력에 태그를 붙이지 않는다 — 같은 언어는 Gemini 도 부르지 않고 친 글 그대로 합성한다.
  it('수동 입력 문구는 태그 없이 친 글 그대로 합성한다', async () => {
    const text = '좋은 아침이에요! 일어나세요! 오늘 하루도 힘내봐요!';
    const taggedText = text;
    // 수동 입력은 유료 전용 경로 — free 로 두면 페이월(403)에 걸려 태깅까지 못 간다.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
    pushManualQuotaFlow(); // 캐시 미스 후 직접 입력 쿼터 예약이 실제로 실행된다
    mockTextToSpeech.mockResolvedValue(new Uint8Array([2]).buffer);
    pushPublicationVoice();
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text, category: 'custom' }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.text).toBe(text);
    expect(body.original_text).toBe(text);
    expect(body.synthesis_text).toBe(taggedText);
    expect(body.tags).toEqual([]);
    const inserted = mockDB.calls.find((c) => c.sql.includes('INSERT INTO messages'));
    expect(inserted!.args[3]).toBe(text);
    expect(inserted!.args[4]).toBe(taggedText);
    expect(inserted!.args[5]).toBe('[]');
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'el-voice-1',
      taggedText,
      // 모델·합성 설정은 호출부가 고르지 않는다 — `textToSpeech` 가 `TTS_MODEL_ID`·`TTS_VOICE_SETTINGS` 로 보낸다.
      { language_code: 'ko' },
    );
    const ttsOptions = mockTextToSpeech.mock.calls[0][2];
    expect(ttsOptions).not.toHaveProperty('stability');
    expect(ttsOptions).not.toHaveProperty('similarity_boost');
    expect(ttsOptions).not.toHaveProperty('style');
    expect(ttsOptions).not.toHaveProperty('speed');
  });

  // 스펙 §9: 글자 웃음(ㅋㅋ)은 합성 글자에서만 `[laughs]` 로 바뀐다 — 화면·저장 문구는 사용자가 친 그대로다.
  // 화면 문구를 합성 문구에서 태그를 벗겨 만들면 사용자가 친 ㅋㅋ 가 사라진다.
  it('직접 입력의 ㅋㅋ 는 [laughs] 로 합성하고, 화면 문구는 친 글 그대로 둔다', async () => {
    const text = '일어나 ㅋㅋㅋ 벌써 8시야';
    const synthesis = '일어나 [laughs] 벌써 8시야';
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
    pushManualQuotaFlow();
    mockTextToSpeech.mockResolvedValue(new Uint8Array([4]).buffer);
    pushPublicationVoice();
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text, category: 'custom' }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.text).toBe(text);
    expect(body.original_text).toBe(text);
    expect(body.synthesis_text).toBe(synthesis);
    expect(body.tags).toEqual(['laughs']);
    const inserted = mockDB.calls.find((c) => c.sql.includes('INSERT INTO messages'));
    expect(inserted!.args[3]).toBe(text);
    expect(inserted!.args[4]).toBe(synthesis);
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'el-voice-1',
      synthesis,
      expect.objectContaining({ language_code: 'ko' }),
    );
  });

  // Codex #830: ㅋㅋ·ㅋㅋㅋ·haha 는 같은 `[laughs]` 로 합성된다. 캐시 키가 합성 글자만 보면 캐시 히트가
  // 다른 철자로 만든 옛 행(message_id·messages.text)을 돌려준다 — 화면 문구가 합성 문구에서 나오지 않을 때만
  // 키가 화면 문구까지 가린다. 웃음이 없으면 예전 키 그대로다(쌓인 캐시를 버리지 않는다).
  it('웃음 철자가 다르면 합성 글자가 같아도 캐시 키가 다르고, 웃음이 없으면 예전 키 그대로다', async () => {
    const generate = async (text: string) => {
      mockDB.reset();
      mockTextToSpeech.mockReset();
      mockDB.pushResult([{ plan: 'plus' }]);
      mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
      mockDB.pushResult([]);
      pushManualQuotaFlow();
      mockTextToSpeech.mockResolvedValue(new Uint8Array([5]).buffer);
      pushPublicationVoice();
      mockDB.pushResult([], 1);
      const res = await reqWithEnv(
        buildApp(),
        jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text, category: 'custom' }),
      );
      expect(res.status).toBe(201);
      return (await res.json()) as { cache_key: string; synthesis_text: string; text: string };
    };

    const twice = await generate('일어나 ㅋㅋ 벌써 8시야');
    const thrice = await generate('일어나 ㅋㅋㅋ 벌써 8시야');
    expect(twice.synthesis_text).toBe(thrice.synthesis_text);
    expect(twice.cache_key).not.toBe(thrice.cache_key);
    expect(thrice.text).toBe('일어나 ㅋㅋㅋ 벌써 8시야');

    // 사용자가 대괄호를 친 문구는 화면 문구가 그 글 그대로라, 공백만 달라도 키가 다르다(Codex #830).
    const spaced = await generate('[excited] 일어나  벌써 8시야');
    const single = await generate('[excited] 일어나 벌써 8시야');
    expect(spaced.text).toBe('[excited] 일어나  벌써 8시야');
    expect(spaced.cache_key).not.toBe(single.cache_key);

    const plain = await generate('일어나 벌써 8시야');
    const { computeTtsCacheKey } = await import('../src/lib/audio-cache');
    expect(plain.cache_key).toBe(
      await computeTtsCacheKey({
        provider: 'elevenlabs',
        providerVoiceId: 'el-voice-1',
        voiceProfileId: V1,
        modelId: 'eleven_v4_turbo',
        language: 'ko',
        languageCode: 'ko',
        text: plain.synthesis_text,
        outputFormat: 'mp3',
      }),
    );
  });

  // 같은 언어 직접 입력은 Gemini 를 부르지 않는다(2026-09-30) — 결과 무관하게 친 글 그대로다.
  it('같은 언어 직접 입력은 Vertex 가 설정돼 있어도 Gemini 를 부르지 않는다', async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error('same-language manual input must not call Vertex');
    });
    vi.stubGlobal('fetch', mockFetch);
    try {
      mockDB.pushResult([{ plan: 'plus' }]);
      mockDB.pushResult([
        { id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1', voice_energy: 'calm' },
      ]);
      mockDB.pushResult([]);
      pushManualQuotaFlow();
      mockTextToSpeech.mockResolvedValue(new Uint8Array([6]).buffer);
      pushPublicationVoice();
      mockDB.pushResult([], 1);
      const res = await buildApp().request(
        jsonReq('POST', '/tts/generate', {
          voice_profile_id: V1,
          text: '일어나! 오늘도 가 보자.',
          category: 'custom',
        }),
        undefined,
        { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: VERTEX_CREDENTIALS_JSON },
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.synthesis_text).toBe('일어나! 오늘도 가 보자.');
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('영어 직접 입력은 번역 없이 language_code=en 으로 합성한다', async () => {
    const text = 'Good morning! Wake up! I hope you have a great day!';
    const taggedText = text;
    // 수동 입력은 유료 전용 경로 — free 로 두면 페이월(403)에 걸려 합성 언어 검증까지 못 간다.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
    pushManualQuotaFlow(); // 캐시 미스 후 직접 입력 쿼터 예약이 실제로 실행된다
    mockTextToSpeech.mockResolvedValue(new Uint8Array([3]).buffer);
    pushPublicationVoice();
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        text,
        category: 'custom',
        language: 'ko',
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.text).toBe(text);
    expect(body.original_text).toBe(text);
    expect(body.synthesis_text).toBe(taggedText);
    expect(body.tags).toEqual([]);
    expect(body.language).toBe('en');
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'el-voice-1',
      taggedText,
      expect.objectContaining({
        language_code: 'en',
      }),
    );
  });

  it('번역 요청인데 번역 설정이 없으면 원문 언어로 잘못 합성하지 않고 실패한다', async () => {
    // free 는 번역 자체가 프리셋 전용 게이트(403)에 먼저 걸린다 — 검증하려는 건 번역 미설정
    // 실패(503)이므로 게이트를 통과하는 유료 플랜 행으로 둔다.
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        text: '좋은 아침이에요!',
        category: 'custom',
        language: 'en',
        translate: true,
      }),
    );

    expect(res.status).toBe(503);
    expect((await res.json()).error_code).toBe('TRANSLATION_NOT_CONFIGURED');
    expect(mockTextToSpeech).not.toHaveBeenCalled();
  });

  // ⚠ **라이브 랜덤 생성은 서버가 거절한다**(핸드오프 「5. 알람 음성의 최종 목적지」 5단계).
  // 이 요청 모양이 막으려던 구멍이다: 무료 + 기본 목소리 + 프리셋 + 매번 다른 호칭이면 요금제
  // 게이트를 통과하고(프리셋은 무료 허용), 호칭이 문장 앞에 붙어 캐시가 빗나가 요청마다 합성이
  // 돌았으며, 월 한도(`isManualGeneration`)도 세지 않았다. 앞서 이 모양은 201 로 굳어 있었다.
  it('random=true 는 400 RANDOM_TTS_RETIRED — 무료 기본 목소리 + 호칭으로도 합성·저장하지 않는다', async () => {
    const res = await reqWithEnv(
      buildApp(),
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        category: 'medication',
        language: 'en',
        random: true,
        random_context: 'preset',
        listener_title: 'Buddy',
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('RANDOM_TTS_RETIRED');
    expect(mockTextToSpeech).not.toHaveBeenCalled();
    // 어떤 조회보다 먼저 거절한다 — 요금제·목소리 조회도, 메시지·오디오 기록도 없다.
    expect(mockDB.calls.some((c) => /\bplan\b/.test(c.sql))).toBe(false);
    expect(mockDB.calls.some((c) => c.sql.includes('voice_profiles'))).toBe(false);
    expect(mockDB.calls.some((c) => c.sql.includes('INSERT INTO messages'))).toBe(false);
    expect(mockDB.calls.some((c) => c.sql.includes('generated_audio_assets'))).toBe(false);
  });

  it('random_context=wake_fortune 도 400 RANDOM_TTS_RETIRED — Vertex·날씨 조회·합성 없음', async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error('live random generation must not reach any provider');
    });
    vi.stubGlobal('fetch', mockFetch);
    try {
      const res = await buildApp().request(
        jsonReq('POST', '/tts/generate', {
          voice_profile_id: V1,
          category: 'morning',
          random: true,
          random_context: 'wake_fortune',
          fortune_gender: '여성',
          fortune_birth_date: '1950-05-19',
          fortune_birth_time: '07:30',
        }),
        undefined,
        { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: VERTEX_CREDENTIALS_JSON },
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error_code).toBe('RANDOM_TTS_RETIRED');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockTextToSpeech).not.toHaveBeenCalled();
      expect(mockDB.calls.some((c) => c.sql.includes('INSERT INTO messages'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('random=true 에 custom category 도 400 RANDOM_TTS_RETIRED — 거절이 카테고리 검사보다 앞이다', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, random: true, category: 'custom' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('RANDOM_TTS_RETIRED');
  });

  it('text 정확히 200자면 허용', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
    pushManualQuotaFlow(); // 캐시 미스 후 직접 입력 쿼터 예약이 실제로 실행된다
    mockTextToSpeech.mockResolvedValue(new Uint8Array([0]).buffer);
    pushPublicationVoice();
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'a'.repeat(200) }),
    );
    expect(res.status).toBe(201);
  });

  it('voice_profile_id 있고 text 없으면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/tts/generate', { voice_profile_id: V1 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_AND_TEXT_REQUIRED');
  });

  it('text 있고 voice_profile_id 없으면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/tts/generate', { text: 'hello' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_AND_TEXT_REQUIRED');
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — GET /tts/messages                                     */
/* ------------------------------------------------------------------ */
describe('GET /tts/messages — edge cases', () => {
  it('limit > 100이면 100으로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages?limit=999'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(100);
  });

  it('limit=0은 falsy이므로 기본값 50으로 폴백', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages?limit=0'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(50);
  });

  it('limit 비숫자이면 기본값 50', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages?limit=abc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(50);
  });

  it('offset 음수이면 0으로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/messages?offset=-5'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.offset).toBe(0);
  });

  it('유효한 voice_profile_id 필터 SQL에 포함', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: M1, text: 'hello' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('GET', `/tts/messages?voice_profile_id=${V1}`));
    expect(res.status).toBe(200);
    const countCall = mockDB.calls[0];
    expect(countCall.sql).toContain('voice_profile_id');
    expect(countCall.args).toContain(V1);
  });

  it('category + voice_profile_id 복합 필터', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(
      jsonReq('GET', `/tts/messages?category=morning&voice_profile_id=${V1}`),
    );
    expect(res.status).toBe(200);
    const countCall = mockDB.calls[0];
    expect(countCall.sql).toContain('category');
    expect(countCall.sql).toContain('voice_profile_id');
    expect(countCall.args).toContain('morning');
    expect(countCall.args).toContain(V1);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — DELETE /tts/messages/:id                              */
/* ------------------------------------------------------------------ */