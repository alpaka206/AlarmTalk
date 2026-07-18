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
    expect(body.synthesis_text).toBe(
      '[cheerfully] 우리 아들, 좋은 아침이야. [cheerfully] 오늘도 기분 좋게 일어나자.',
    );
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
      // Gemini 톤 적응 생성 응답 — {text, tag} JSON
      return geminiText(JSON.stringify({ text: toneText, tag: 'cheerfully' }));
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
      expect(body.synthesis_text).toBe('[cheerfully] 우리 아들, 잘 잤어? [cheerfully] 오늘도 기분 좋게 하루 시작해 보자.');
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
    } finally {
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
      return geminiText(JSON.stringify({ text: loserText, tag: 'cheerfully' }));
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
      mockDB.pushResult([{ preview_text: winnerText, preview_tag: 'cheerfully' }]); // 승자 재조회
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
      expect(body.synthesis_text).toBe('[cheerfully] 우리 아들, 잘 잤어? [cheerfully] 오늘 하루도 힘내자.');
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
        preview_tag: 'cheerfully',
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
    expect(body.synthesis_text).toBe('[cheerfully] 우리 아들, 잘 잤어? [cheerfully] 오늘도 힘내 보자.');
    // 재사용 경로는 재생성/재영속하지 않는다.
    expect(mockDB.calls.some((call) => call.sql.includes('SET preview_text'))).toBe(false);
  });

  // 태그 부착 상한 = /tts/generate 의 200자 상한(경계 정합). 기본 상한(300)을 쓰면
  // 원문은 200자 이내인데 문장별 태그 부착으로 200을 넘긴 텍스트가 폴백 없이 통과했다가
  // 뒤늦게 TEXT_TOO_LONG(400)으로 거부된다 — 폴백(선두 1회 태그/무태그)으로 성공해야 한다.
  function pushStoredPreviewFlow(storedText: string) {
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
        preview_tag: 'cheerfully',
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
  }

  it('문장별 태그가 200자를 넘기면 선두 1회 태그로 폴백해 성공한다(경계 정합)', async () => {
    // 183자 2문장: 문장별 태그(209자) > 200, 선두 1회 태그(196자) ≤ 200.
    const s1 = `${'a'.repeat(90)}.`;
    const s2 = `${'b'.repeat(90)}.`;
    const storedText = `${s1} ${s2}`;
    expect(storedText.length).toBe(183);
    pushStoredPreviewFlow(storedText);
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
    expect(body.synthesis_text).toBe(`[cheerfully] ${storedText}`);
    expect(body.synthesis_text.length).toBeLessThanOrEqual(200);
    expect(body.text).toBe(storedText);
  });

  it('선두 1회 태그도 200자를 넘기면 무태그로 폴백해 성공한다(TEXT_TOO_LONG 아님)', async () => {
    // 195자 1문장: 태그 부착 시 208자 > 200 → 원문 그대로 합성.
    const storedText = `${'c'.repeat(194)}.`;
    expect(storedText.length).toBe(195);
    pushStoredPreviewFlow(storedText);
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
      { id: M404, text: 'bye', category: 'evening' },
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

describe('DELETE /tts/messages/:id — 메시지 삭제', () => {
  it('잘못된 UUID 형식이면 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/tts/messages/bad-id'));
    expect(res.status).toBe(400);
  });

  it('preset 클립은 삭제 거부(403)', async () => {
    mockDB.pushResult([{ is_preset: 1 }]); // preset check
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M1}`));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('MESSAGE_PRESET_LOCKED');
  });

  it('연관 알람 있으면 409 경고', async () => {
    mockDB.pushResult([{ is_preset: 0 }]); // preset check
    mockDB.pushResult([{ cnt: 2 }]);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M1}`));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.warning).toBe(true);
    expect(body.alarm_count).toBe(2);
  });

  it('force=true로 연관 알람 있어도 삭제', async () => {
    mockDB.pushResult([{ is_preset: 0 }]); // preset check
    mockDB.pushResult([{ cnt: 2 }]); // alarm check
    mockDB.pushResult([], 1); // UPDATE alarms (detach)
    mockDB.pushResult([], 1); // DELETE message_library
    mockDB.pushResult([]); // SELECT audio_object_key
    mockDB.pushResult([], 1); // DELETE generated_audio_assets
    mockDB.pushResult([], 1); // DELETE messages
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M1}?force=true`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.alarms_affected).toBe(2);
    const alarmUpdate = mockDB.calls.find((c) => c.sql.startsWith('UPDATE alarms'));
    expect(alarmUpdate).toBeDefined();
    expect(alarmUpdate!.sql).toContain("mode = 'sound-only'");
    expect(alarmUpdate!.sql).toContain("wake_mode = 'sound_then_voice'");
    expect(alarmUpdate!.sql).toContain('message_id = NULL');
    expect(alarmUpdate!.sql).toContain('voice_profile_id = NULL');
    expect(alarmUpdate!.sql).toContain('speaker_id = NULL');
    expect(alarmUpdate!.sql).toContain('EXISTS');
    expect(alarmUpdate!.args).toEqual([M1, M1, 'user-1', 'user-1']);
  });

  it('메시지 없으면 404', async () => {
    mockDB.pushResult([]); // preset check (없음)
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 0);
    mockDB.pushResult([], 0);
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M404}`));
    expect(res.status).toBe(404);
  });

  it('정상 삭제', async () => {
    mockDB.pushResult([{ is_preset: 0 }]); // preset check
    mockDB.pushResult([{ cnt: 0 }]); // alarm check
    mockDB.pushResult([], 1); // DELETE message_library
    mockDB.pushResult([]); // SELECT audio_object_key
    mockDB.pushResult([], 1); // DELETE generated_audio_assets
    mockDB.pushResult([], 1); // DELETE messages
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M1}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('GET /tts/presets — 프리셋 메시지', () => {
  it('프리셋 목록 반환', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('GET', '/tts/presets'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presets.length).toBeGreaterThan(0);
    expect(body.presets[0]).toHaveProperty('category');
    expect(body.presets[0]).toHaveProperty('messages');
  });

  it('DB tts_presets row가 있으면 서버 프리셋으로 반환', async () => {
    mockDB.pushResult([
      {
        category: 'morning',
        label: '아침',
        emoji: 'sun',
        messages_json: JSON.stringify(['서버 아침 문구']),
      },
    ]);
    const app = buildApp();
    const res = await reqWithEnv(app, jsonReq('GET', '/tts/presets'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presets).toHaveLength(1);
    expect(body.presets[0].messages).toEqual(['서버 아침 문구']);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — POST /tts/generate                                    */
/* ------------------------------------------------------------------ */
describe('POST /tts/generate — edge cases', () => {
  it('user 미존재 시 사용량 체크 건너뛰고 voice profile 조회로 진행', async () => {
    mockDB.pushResult([]); // users: empty
    mockDB.pushResult([]); // voice_profiles: empty
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
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
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([
      { id: V1, status: 'ready', is_system: 1, elevenlabs_voice_id: 'el-system-1' },
    ]);
    mockDB.pushResult([]);

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

  it('ElevenLabs 실패 시 500 + detail 포함', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]); // cache lookup (miss)
    mockTextToSpeech.mockRejectedValue(new Error('ElevenLabs quota exceeded'));
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('TTS_GENERATION_FAILED');
    expect(body.detail).toBe('ElevenLabs quota exceeded');
  });

  it('ElevenLabs가 비-Error를 throw하면 detail "Unknown error"', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]); // cache lookup (miss)
    mockTextToSpeech.mockRejectedValue('raw string error');
    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, text: 'hello' }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toBe('Unknown error');
  });

  it('성공 시 201 + message_id, audio_base64, category 기본값 custom', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
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
    mockDB.pushResult([{ plan: 'free' }]);
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
  });

  it('checks the provider cache key before synthesizing', async () => {
    const objectKey = 'generated-tts/user-1/eleven-cached.mp3';
    const r2 = createMockR2Bucket({ [objectKey]: new Uint8Array([69, 76]) });
    mockDB.pushResult([{ plan: 'free' }]);
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
    mockDB.pushResult([{ plan: 'free' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
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

  it('수동 입력 문구에도 delivery tag가 자동 삽입된다', async () => {
    const text = '좋은 아침이에요! 일어나세요! 오늘 하루도 힘내봐요!';
    // 신 allowlist 로컬 태깅: '힘' 키워드 → [cheerfully] (구 [encouraging] 폐기).
    const taggedText = `[cheerfully] ${text}`;
    mockDB.pushResult([{ plan: 'free' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
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
    expect(body.tags).toEqual(['cheerfully']);
    const inserted = mockDB.calls.find((c) => c.sql.includes('INSERT INTO messages'));
    expect(inserted!.args[3]).toBe(text);
    expect(inserted!.args[4]).toBe(taggedText);
    expect(inserted!.args[5]).toBe(JSON.stringify(['cheerfully']));
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'el-voice-1',
      taggedText,
      expect.objectContaining({
        model_id: 'eleven_v3',
        language_code: 'ko',
      }),
    );
    const ttsOptions = mockTextToSpeech.mock.calls[0][2];
    expect(ttsOptions).not.toHaveProperty('stability');
    expect(ttsOptions).not.toHaveProperty('similarity_boost');
    expect(ttsOptions).not.toHaveProperty('style');
    expect(ttsOptions).not.toHaveProperty('speed');
  });

  it('영어 직접 입력은 번역 없이 language_code=en 으로 합성한다', async () => {
    const text = 'Good morning! Wake up! I hope you have a great day!';
    // 신 allowlist 로컬 기본 태그(구 [warmly] 폐기).
    const taggedText = `[cheerfully] ${text}`;
    mockDB.pushResult([{ plan: 'free' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
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
    expect(body.tags).toEqual(['cheerfully']);
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
    mockDB.pushResult([{ plan: 'free' }]);
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

  it('random=true 면 서버 프리셋 문구를 골라 TTS를 생성한다', async () => {
    mockDB.pushResult([
      {
        category: 'morning',
        label: '아침',
        emoji: 'sun',
        messages_json: JSON.stringify(['서버가 고른 아침 문구']),
      },
    ]);
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([7]).buffer);
    pushPublicationVoice();
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        category: 'morning',
        random: true,
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.original_text).toBe('서버가 고른 아침 문구');
    expect(body.text).toBe(body.original_text);
    expect(
      body.synthesis_text.replace(/\s*\[[a-z][a-z -]*\]\s*/gi, ' ').replace(/\s+/g, ' ').trim(),
    ).toContain(body.original_text);
    expect(body.tags).toContain('cheerfully');
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'el-voice-1',
      body.synthesis_text,
      expect.any(Object),
    );
    const inserted = mockDB.calls.find((c) => c.sql.includes('INSERT INTO messages'));
    expect(inserted!.args[3]).toBe(body.original_text);
    expect(inserted!.args[4]).toBe(body.synthesis_text);
    expect(inserted!.args[5]).toBe(JSON.stringify(body.tags));
    expect(inserted!.args[6]).toBe('morning');
  });

  it('applies listener_title to preset TTS before synthesis', async () => {
    mockDB.pushResult([
      {
        category: 'morning',
        label: 'Morning',
        emoji: 'sun',
        messages_json: JSON.stringify(['wake now']),
      },
    ]);
    mockDB.pushResult([{ plan: 'free' }]);
    mockDB.pushResult([
      {
        id: V1,
        status: 'ready',
        is_system: 1,
        elevenlabs_voice_id: 'el-system-1',
      },
    ]);
    mockDB.pushResult([]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([10]).buffer);
    pushPublicationVoice({
      is_system: 1,
      elevenlabs_voice_id: 'el-system-1',
    });
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        category: 'morning',
        language: 'en',
        random: true,
        random_context: 'preset',
        listener_title: 'Buddy',
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.original_text).toBe('Buddy, wake now');
    expect(body.text).toBe('Buddy, wake now');
    expect(body.synthesis_text).toContain('Buddy, wake now');
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'el-system-1',
      expect.stringContaining('Buddy, wake now'),
      expect.any(Object),
    );
    const inserted = mockDB.calls.find((c) => c.sql.includes('INSERT INTO messages'));
    expect(inserted!.args[3]).toBe('Buddy, wake now');
  });

  it('random_context=wake_fortune creates a dynamic relationship-aware prompt', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([
      {
        id: V1,
        status: 'ready',
        elevenlabs_voice_id: 'el-voice-1',
        relationship_label: '손녀',
      },
    ]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    mockTextToSpeech.mockResolvedValue(new Uint8Array([8]).buffer);
    pushPublicationVoice({ relationship_label: '손녀' });
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const app = buildApp();
    const res = await reqWithEnv(
      app,
      jsonReq('POST', '/tts/generate', {
        voice_profile_id: V1,
        category: 'morning',
        random: true,
        random_context: 'wake_fortune',
        fortune_gender: '여성',
        fortune_birth_date: '1950-05-19',
        fortune_birth_time: '07:30',
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.random_context).toBe('wake_fortune');
    expect(body.original_text).toContain('일어나실 시간');
    expect(body.original_text).not.toContain('손녀 목소리');
    expect(body.original_text).not.toContain('생년월일');
    expect(body.original_text).not.toContain('태어난 시간');
    expect(
      body.synthesis_text.replace(/\s*\[[a-z][a-z -]*\]\s*/gi, ' ').replace(/\s+/g, ' ').trim(),
    ).toContain(body.original_text);
    expect(mockTextToSpeech).toHaveBeenCalledWith(
      'el-voice-1',
      body.synthesis_text,
      expect.any(Object),
    );
  });

  it('random_context=wake_fortune uses local fallback even when Vertex is configured', async () => {
    const mockFetch = vi.fn(async (url: unknown) => {
      if (String(url) === TOKEN_URI) {
        return new Response(JSON.stringify({ access_token: 'test-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error('dynamic Gemini text should not be called');
    });
    vi.stubGlobal('fetch', mockFetch);
    try {
      mockDB.pushResult([{ plan: 'plus' }]);
      mockDB.pushResult([
        {
          id: V1,
          status: 'ready',
          elevenlabs_voice_id: 'el-voice-1',
          relationship_label: '여자친구',
        },
      ]);
      mockDB.pushResult([
        {
          id: 'user-1',
          dynamic_prompt_settings_json: JSON.stringify({
            fortune: { gender: '남성', birth_date: '1995-05-20', birth_time: '07:30' },
          }),
        },
      ]);
      mockDB.pushResult([]);
      mockDB.pushResult([]);
      mockTextToSpeech.mockResolvedValue(new Uint8Array([9]).buffer);
      pushPublicationVoice({ relationship_label: '여자친구' });
      mockDB.pushResult([], 1);
      mockDB.pushResult([], 1);

      const app = buildApp();
      const res = await app.request(
        jsonReq('POST', '/tts/generate', {
          voice_profile_id: V1,
          category: 'morning',
          random: true,
          random_context: 'wake_fortune',
          target_user_id: 'user-1',
          fortune_gender: '   ',
          fortune_birth_date: '',
          fortune_birth_time: '   ',
          listener_title: '자기야',
        }),
        undefined,
        { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: VERTEX_CREDENTIALS_JSON },
      );

      expect(res.status).toBe(201);
      expect(mockFetch).not.toHaveBeenCalled();
      const body = await res.json();
      expect(body.original_text).toContain('작은 행운');
      expect(
      body.synthesis_text.replace(/\s*\[[a-z][a-z -]*\]\s*/gi, ' ').replace(/\s+/g, ' ').trim(),
    ).toContain(body.original_text);
      expect(body.tags).toEqual(['playfully']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('random=true 에 custom category 면 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/tts/generate', { voice_profile_id: V1, random: true, category: 'custom' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('RANDOM_CATEGORY_REQUIRED');
  });

  it('text 정확히 200자면 허용', async () => {
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([{ id: V1, status: 'ready', elevenlabs_voice_id: 'el-voice-1' }]);
    mockDB.pushResult([]);
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
describe('DELETE /tts/messages/:id — edge cases', () => {
  it('삭제 시 message_library부터 삭제 후 messages 삭제 (순서 검증)', async () => {
    mockDB.pushResult([{ is_preset: 0 }]); // preset check
    mockDB.pushResult([{ cnt: 0 }]); // alarm check
    mockDB.pushResult([], 1); // DELETE message_library
    mockDB.pushResult([]); // SELECT audio_object_key (정리할 R2 오브젝트 없음)
    mockDB.pushResult([], 1); // DELETE generated_audio_assets
    mockDB.pushResult([], 1); // DELETE messages
    const app = buildApp();
    await app.request(jsonReq('DELETE', `/tts/messages/${M1}`));
    expect(mockDB.calls[2].sql).toContain('DELETE FROM message_library');
    expect(mockDB.calls[3].sql).toContain('SELECT audio_object_key');
    expect(mockDB.calls[4].sql).toContain('DELETE FROM generated_audio_assets');
    expect(mockDB.calls[5].sql).toContain('DELETE FROM messages');
  });

  it('삭제 SQL에 user_id 포함 (사용자 격리)', async () => {
    mockDB.pushResult([{ is_preset: 0 }]); // preset check
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]); // SELECT audio_object_key
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp('user-99');
    await app.request(jsonReq('DELETE', `/tts/messages/${M1}`));
    expect(mockDB.calls[2].args).toContain('user-99');
    expect(mockDB.calls[4].args).toContain('user-99');
    expect(mockDB.calls[5].args).toContain('user-99');
  });

  it('force=true이고 알람 0개여도 정상 삭제', async () => {
    mockDB.pushResult([{ is_preset: 0 }]); // preset check
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]); // SELECT audio_object_key
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', `/tts/messages/${M1}?force=true`));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
