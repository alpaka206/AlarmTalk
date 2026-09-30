import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types';
import {
  AlarmTextPreparationInvalidError,
  GeminiIncompleteResponseError,
  analyzeSpeechStyleWithVertex,
  hasAssumedMorning,
  hasMixedKoreanRegister,
  isUncontractedEnglish,
  tidyEllipsis,
  withVoiceEnergy,
  buildGenerationConfig,
  deriveAlarmDisplayText,
  extractGeneratedText,
  generateDynamicAlarmTextWithVertex,
  generatePrerenderClipText,
  modernizeKoreanHonorific,
  prepareAlarmTextWithVertex,
  speakTypedLaughter,
  stripAllTags,
  vertexGenerateContentEndpoint,
  VERTEX_MODEL,
} from '../src/lib/vertex-translate';

const mockFetch = vi.fn();

const TOKEN_URI = 'https://oauth2.example.com/token';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  GOOGLE_VERTEX_CREDENTIALS_JSON: '',
  GOOGLE_VERTEX_DYNAMIC_TEXT_ENABLED: 'true',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

function okJson(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function geminiText(text: string) {
  return okJson({
    candidates: [
      {
        content: {
          parts: [{ text }],
        },
      },
    ],
  });
}

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
  ENV.GOOGLE_VERTEX_CREDENTIALS_JSON = JSON.stringify({
    client_email: 'svc@test.iam.gserviceaccount.com',
    private_key: toPem(pkcs8),
    project_id: 'test-project',
    token_uri: TOKEN_URI,
  });
});

// Vertex synthesis runs two fetches per call: an OAuth token exchange, then the
// generateContent request. The token endpoint is auto-answered; tests queue only
// the content responses they care about.
let contentResponses: Response[];

function queueContent(response: Response) {
  contentResponses.push(response);
}

function contentRequestBody(): { contents: { parts: { text: string }[] }[] } {
  const call = mockFetch.mock.calls.find((c) => String(c[0]) !== TOKEN_URI);
  return JSON.parse(String(call?.[1]?.body));
}

beforeEach(() => {
  contentResponses = [];
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: unknown) => {
    if (String(url) === TOKEN_URI) {
      return okJson({ access_token: 'test-access-token' });
    }
    const next = contentResponses.shift();
    if (!next) throw new Error('no content response queued');
    return next;
  });
  vi.stubGlobal('fetch', mockFetch);
});

/**
 * 모델은 코드 상수 `VERTEX_MODEL`(`gemini-3.8-flash`) 하나가 정한다 — 워커 시크릿 `GOOGLE_VERTEX_MODEL` 로
 * 덮는 길은 없앴다(2026-09-30). dev·prod 워커에는 옛 값(`gemini-3.5-flash`)이 남아 있으므로, 그 값이
 * 요청에 새어 나가면 안 된다. 3.8 Flash 는 `thinkingLevel: 'MINIMAL'` 을 400 으로 거절한다 — 호출부가
 * 실패를 삼키고 폴백하므로 400 은 경보 없이 문구 품질만 떨어뜨린다. 보내는 요청 본문으로 잠근다.
 */
describe('Gemini 요청 — 모델·사고 설정은 코드가 정한다(3.8 Flash)', () => {
  function contentCall(): { url: string; body: { generationConfig: Record<string, unknown> } } {
    const call = mockFetch.mock.calls.find((c) => String(c[0]) !== TOKEN_URI);
    return { url: String(call?.[0]), body: JSON.parse(String(call?.[1]?.body)) };
  }

  function candidateResponse(candidate: Record<string, unknown>) {
    return okJson({ candidates: [candidate] });
  }

  const SPEECH_STYLE_JSON =
    '{"dialect":"경상","strength":"high","register":"banmal","markers":["~카이"],"persona":"","childlike":false,"energy":"bright","confidence":0.9}';
  const SPEECH_TRANSCRIPT =
    '아이고 오늘은 날씨가 참 좋네예. 밥은 묵었나? 니도 밥 잘 챙겨 묵고 댕기래이.';

  it('멀티리전 us·eu 는 전용 호스트, 그 밖은 전역 호스트다', () => {
    expect(vertexGenerateContentEndpoint('p', 'us', 'gemini-3.8-flash')).toBe(
      'https://aiplatform.us.rep.googleapis.com/v1/projects/p/locations/us/publishers/google/models/gemini-3.8-flash:generateContent',
    );
    expect(vertexGenerateContentEndpoint('p', 'eu', 'gemini-3.8-flash')).toBe(
      'https://aiplatform.eu.rep.googleapis.com/v1/projects/p/locations/eu/publishers/google/models/gemini-3.8-flash:generateContent',
    );
    expect(vertexGenerateContentEndpoint('p', 'global', 'gemini-3.8-flash')).toBe(
      'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/gemini-3.8-flash:generateContent',
    );
  });

  it('모델은 3.8 Flash 다', () => {
    expect(VERTEX_MODEL).toBe('gemini-3.8-flash');
  });

  it('설정은 thinkingLevel LOW · 상한 4096 · temperature·thinkingBudget 없음', () => {
    const config = buildGenerationConfig({ responseSchema: { type: 'object' } });
    expect(config).toEqual({
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'LOW' },
      responseSchema: { type: 'object' },
    });
    expect(config).not.toHaveProperty('temperature');
    expect(buildGenerationConfig({})).not.toHaveProperty('responseSchema');
  });

  it('요청은 3.8 Flash · us 주소와 LOW 사고로 나간다 — MINIMAL·temperature 를 싣지 않는다', async () => {
    queueContent(geminiText(SPEECH_STYLE_JSON));
    const style = await analyzeSpeechStyleWithVertex(ENV, SPEECH_TRANSCRIPT, 'ko');
    expect(style?.dialect).toBe('경상');
    const { url, body } = contentCall();
    expect(url).toBe(
      'https://aiplatform.us.rep.googleapis.com/v1/projects/test-project/locations/us/publishers/google/models/gemini-3.8-flash:generateContent',
    );
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(body.generationConfig.maxOutputTokens).toBe(4096);
    expect(body.generationConfig).not.toHaveProperty('temperature');
  });

  it('워커에 옛 GOOGLE_VERTEX_MODEL 시크릿이 남아 있어도 코드의 3.8 Flash 로 부른다', async () => {
    queueContent(geminiText(SPEECH_STYLE_JSON));
    // dev·prod 워커가 아직 들고 있는 값이다. Env 타입에서는 뺐으므로 캐스팅해서 넣는다.
    const staleEnv = {
      ...ENV,
      GOOGLE_VERTEX_MODEL: 'gemini-3.5-flash',
      GOOGLE_VERTEX_LOCATION: 'us',
    } as Env;
    await analyzeSpeechStyleWithVertex(staleEnv, SPEECH_TRANSCRIPT, 'ko');
    const { url, body } = contentCall();
    expect(url).toContain('/models/gemini-3.8-flash:generateContent');
    expect(url).not.toContain('gemini-3.5-flash');
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  it('답을 꺼낼 때 사고 part 는 버리고 나머지 텍스트 part 를 잇는다', () => {
    expect(
      extractGeneratedText({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                { thought: true, text: 'Let me think… {"text":"wrong"}' },
                { text: '{"text":"[cheerfully] 오늘도 ' },
                { text: '화이팅","tags":["cheerfully"]}', thoughtSignature: 'sig' },
              ],
            },
          },
        ],
      }),
    ).toBe('{"text":"[cheerfully] 오늘도 화이팅","tags":["cheerfully"]}');
  });

  it('finishReason 이 없으면 STOP 으로 본다(옛 응답·목)', () => {
    expect(extractGeneratedText({ candidates: [{ content: { parts: [{ text: ' ok ' }] } }] })).toBe('ok');
  });

  it('MAX_TOKENS 로 잘린 응답은 던진다 — 원문은 오류 메시지에 싣지 않는다', () => {
    let caught: unknown;
    try {
      extractGeneratedText({
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"text": "[cheerful] 엄마, 일' }] } }],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GeminiIncompleteResponseError);
    expect((caught as Error).message).toBe('Gemini generation incomplete (MAX_TOKENS)');
    expect((caught as Error).message).not.toContain('엄마');
  });

  // 같은 언어 직접 입력은 Gemini 를 부르지 않는다(2026-09-30) — 호출 로그는 번역으로 확인한다.
  const TRANSLATE_KO_EN = { targetLanguage: 'en', sourceLanguage: 'ko', translate: true } as const;

  it('번역은 잘린 응답을 받으면 upstream_unavailable 로 던진다 — `{"text":` 가 문구에 새지 않는다', async () => {
    queueContent(
      candidateResponse({
        finishReason: 'MAX_TOKENS',
        content: { parts: [{ text: '{"text": "Mom, it is ti', thoughtSignature: 'sig' }] },
      }),
    );
    await expect(
      prepareAlarmTextWithVertex(ENV, '엄마, 일어날 시간이야.', TRANSLATE_KO_EN),
    ).rejects.toMatchObject({ reason: 'upstream_unavailable' });
  });

  it('호출 로그 수준은 생성이 끝났는가로 고른다 — HTTP 200 이어도 잘렸으면 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      queueContent(candidateResponse({ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"text": "Mom' }] } }));
      queueContent(geminiText('{"text":"Mom, time to get up."}'));
      for (let i = 0; i < 2; i += 1) {
        await prepareAlarmTextWithVertex(ENV, '엄마, 일어날 시간이야.', TRANSLATE_KO_EN).catch(() => undefined);
      }
      const lines = (spy: typeof warn) =>
        spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"vertex.generate"'));
      expect(lines(warn)).toHaveLength(1);
      expect(lines(warn)[0]).toContain('"finish_reason":"MAX_TOKENS"');
      expect(lines(info)).toHaveLength(1);
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it('자격 증명 JSON 이 깨져도 vertex.generate 를 warn(stage auth)으로 남긴다 — 비밀값은 싣지 않는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const env = { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: '{"private_key":"SECRET-KEY-BODY", broken' } as Env;
      await expect(prepareAlarmTextWithVertex(env, '엄마, 일어날 시간이야.', TRANSLATE_KO_EN)).rejects.toMatchObject({
        reason: 'upstream_unavailable',
      });
      const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"vertex.generate"'));
      expect(line).toContain('"stage":"auth"');
      expect(line).toContain('must be valid service account JSON');
      expect(line).not.toContain('SECRET-KEY-BODY');
    } finally {
      warn.mockRestore();
    }
  });

  it('토큰 발급이 실패해도 vertex.generate 를 warn(stage auth)으로 남긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch.mockImplementation(async () => new Response('{"error":"invalid_grant"}', { status: 400 }));
    try {
      await expect(prepareAlarmTextWithVertex(ENV, '엄마, 일어날 시간이야.', TRANSLATE_KO_EN)).rejects.toMatchObject({
        reason: 'upstream_unavailable',
      });
      const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"vertex.generate"'));
      expect(line).toContain('"stage":"auth"');
      expect(line).toContain('invalid_grant');
      expect(line).not.toContain('엄마');
    } finally {
      warn.mockRestore();
    }
  });

  it('호출이 던져도(타임아웃·네트워크) vertex.generate 를 warn 으로 한 줄 남긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 큐가 비어 있으면 목 fetch 가 던진다 — 응답 없는 실패와 같은 경로다.
      await expect(prepareAlarmTextWithVertex(ENV, '엄마, 일어날 시간이야.', TRANSLATE_KO_EN)).rejects.toMatchObject({
        reason: 'upstream_unavailable',
      });
      const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"vertex.generate"'));
      expect(line).toContain('"status":null');
      expect(line).toContain('"elapsed_ms"');
      expect(line).not.toContain('엄마');
    } finally {
      warn.mockRestore();
    }
  });

  /** 스키마 안의 모든 enum 을 훑어 빈 문자열이 든 자리를 모은다. */
  function emptyEnumPaths(node: unknown, path = 'responseSchema'): string[] {
    if (!node || typeof node !== 'object') return [];
    const found: string[] = [];
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'enum' && Array.isArray(value) && value.some((v) => v === '')) found.push(`${path}.enum`);
      else found.push(...emptyEnumPaths(value, `${path}.${key}`));
    }
    return found;
  }

  // ⚠ Gemini 3 계열은 enum 에 빈 문자열이 있으면 요청을 **400** 으로 거절한다("enum[0]: cannot be
  // empty", 2026-09-23 실측). 말투 분석이 그랬고, 그 함수는 실패를 삼켜 null 을 돌려주므로 모델만
  // 바꿨으면 사투리 분석이 **경보 없이** 전부 꺼졌다. 보내는 요청 본문으로 확인한다.
  it('보내는 응답 스키마에 빈 문자열 enum 이 없다 — 말투 분석·사전렌더 문구', async () => {
    queueContent(
      geminiText(
        '{"dialect":"경상","strength":"high","register":"banmal","markers":["~카이"],"persona":"","childlike":false,"confidence":0.9}',
      ),
    );
    const style = await analyzeSpeechStyleWithVertex(
      ENV,
      '아이고 오늘은 날씨가 참 좋네예. 밥은 묵었나? 니도 밥 잘 챙겨 묵고 댕기래이.',
      'ko',
    );
    expect(style?.dialect).toBe('경상');
    expect(style?.strength).toBe('high');
    const speechSchema = contentCall().body.generationConfig.responseSchema;
    expect(speechSchema).toBeTruthy();
    expect(emptyEnumPaths(speechSchema)).toEqual([]);

    mockFetch.mockClear();
    queueContent(geminiText('{"text":"[warmly] 우리 딸, 좋은 아침이에요.","tag":"warmly"}'));
    await generatePrerenderClipText(ENV, {
      seed: '[warmly] 좋은 아침이에요.',
      relationshipLabel: '엄마',
      listenerTitle: '우리 딸',
      targetLanguage: 'ko',
    }).catch(() => null);
    const clipSchema = contentCall().body.generationConfig.responseSchema;
    expect(clipSchema).toBeTruthy();
    expect(emptyEnumPaths(clipSchema)).toEqual([]);
  });

  it('말투 분석은 enum 없이도 강도를 low·medium·high 로만 받는다(그 밖은 빈 값)', async () => {
    queueContent(
      geminiText(
        '{"dialect":"경상","strength":"very strong","register":"banmal","markers":["~카이"],"persona":"","childlike":false,"confidence":0.9}',
      ),
    );
    const style = await analyzeSpeechStyleWithVertex(
      ENV,
      '아이고 오늘은 날씨가 참 좋네예. 밥은 묵었나? 니도 밥 잘 챙겨 묵고 댕기래이.',
      'ko',
    );
    expect(style?.dialect).toBe('경상');
    expect(style?.strength).toBe('');
  });

  it('번역문이 태그뿐이면(태그를 지우면 말이 없으면) 번역 실패로 던진다', async () => {
    queueContent(geminiText('{"text":"[softly]"}'));
    await expect(
      prepareAlarmTextWithVertex(ENV, '일어나, 학교 갈 시간이야.', {
        targetLanguage: 'en',
        sourceLanguage: 'ko',
        translate: true,
      }),
    ).rejects.toMatchObject({ reason: 'empty_spoken' });
  });

  // 우리는 태그를 붙이지 않는다(2026-09-30). 번역 모델이 지시를 어기고 톤 태그를 넣으면 벗긴다 — 사용자가 친
  // 대괄호는 그대로 둔다.
  it('번역문에 모델이 붙인 톤 태그는 벗기고, 사용자가 친 대괄호는 남긴다', async () => {
    queueContent(geminiText('{"text":"[softly] Wake up, [cheerfully] it is time for school."}'));
    const prepared = await prepareAlarmTextWithVertex(ENV, '일어나, 학교 갈 시간이야.', {
      targetLanguage: 'en',
      sourceLanguage: 'ko',
      translate: true,
    });
    expect(prepared.translated).toBe(true);
    expect(prepared.text).toBe('Wake up, it is time for school.');
    expect(prepared.tags).toEqual([]);

    queueContent(geminiText('{"text":"[excited] Wake up, [cheerfully] it is time for school."}'));
    const typed = await prepareAlarmTextWithVertex(ENV, '[excited] 일어나, 학교 갈 시간이야.', {
      targetLanguage: 'en',
      sourceLanguage: 'ko',
      translate: true,
    });
    expect(typed.text).toBe('[excited] Wake up, it is time for school.');
    // 번역 지시는 대괄호를 새로 넣지 말라고 한다.
    expect(sentPromptText()).toContain('never add new square brackets');
  });

  it('사전렌더: 모델이 낸 태그는 거절하지 않고 벗긴다 — 문장은 살리고 다시 묻지 않는다', async () => {
    queueContent(geminiText('{"text":"[caring] 우리 딸, 약 먹을 시간이야. [gently] 알람 끄기 전에 얼른 먹자."}'));
    const out = await generatePrerenderClipText(ENV, {
      seed: '약 먹을 시간이라고 알린다.',
      relationshipLabel: '엄마',
      listenerTitle: '우리 딸',
      targetLanguage: 'ko',
    });
    expect(out).toEqual({ text: '우리 딸, 약 먹을 시간이야. 알람 끄기 전에 얼른 먹자.' });
    expect(mockFetch.mock.calls.filter((c) => String(c[0]) !== TOKEN_URI)).toHaveLength(1);
  });

  it('사전렌더: 길어서 걸린 다음 회차에는 길이를 숫자로 다시 말한다', async () => {
    const tooLong = `[warmly] Hey sweetie, ${'I know it is so tempting to stay under the covers today. '.repeat(4)}Come on, up you get.`;
    queueContent(geminiText(JSON.stringify({ text: tooLong })));
    queueContent(geminiText('{"text":"[warmly] Hey sweetie, gray out there. [encouraging] Open the curtains and let\'s get up."}'));
    const out = await generatePrerenderClipText(ENV, {
      seed: '흐리다고 알리고 공감한 뒤 커튼부터 열고 일어나자고 한다.',
      relationshipLabel: 'mom',
      listenerTitle: 'sweetie',
      targetLanguage: 'en',
    });
    expect(out.text).toContain('Open the curtains');
    const prompts = mockFetch.mock.calls
      .filter((c) => String(c[0]) !== TOKEN_URI)
      .map((c) => JSON.parse(String(c[1]?.body)).contents[0].parts[0].text as string);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain('TOO LONG');
    expect(prompts[1]).toContain('TOO LONG');
    expect(prompts[1]).toContain('about 25 English words');
  });

  it('사전렌더: 인사 클립이 길면 인사는 남기라고 하고, 인사가 아니면 빼라고 한다', async () => {
    const long = `[warmly] 우리 딸, 좋은 아침. ${'오늘도 정말 기분 좋게 시작하자. '.repeat(14)}`;
    queueContent(geminiText(JSON.stringify({ text: long })));
    queueContent(geminiText('{"text":"[warmly] 우리 딸, 좋은 아침. 잘 잤어? 오늘도 기분 좋게 시작하자."}'));
    await generatePrerenderClipText(ENV, {
      seed: '다정하게 아침 인사를 하며 잘 잤는지 안부를 묻고, 오늘 하루도 기분 좋게 시작하자고 따뜻하게 깨워 준다.',
      relationshipLabel: '엄마',
      listenerTitle: '우리 딸',
      targetLanguage: 'ko',
    });
    const prompts = mockFetch.mock.calls
      .filter((c) => String(c[0]) !== TOKEN_URI)
      .map((c) => JSON.parse(String(c[1]?.body)).contents[0].parts[0].text as string);
    expect(prompts[1]).toContain('keep the greeting itself');
    expect(prompts[1]).not.toContain('drop the greeting');
  });

  it('사전렌더: 아침 인사로 걸린 재시도는 기상 문구를 권하지 않는다', async () => {
    queueContent(geminiText('{"text":"[warmly] 좋은 아침이에요. [caring] 약 드실 시간이에요."}'));
    queueContent(geminiText('{"text":"[warmly] 약 드실 시간이에요. [caring] 지금 바로 챙겨 드세요."}'));
    await generatePrerenderClipText(ENV, {
      seed: '약 드실 시간이라고 알리며 지금 챙겨 드시라고 한다.',
      targetLanguage: 'ko',
    });
    const prompts = mockFetch.mock.calls
      .filter((c) => String(c[0]) !== TOKEN_URI)
      .map((c) => JSON.parse(String(c[1]?.body)).contents[0].parts[0].text as string);
    expect(prompts[1]).toContain('assumed it was morning');
    expect(prompts[1]).not.toContain('wake-up phrase');
  });

  it('한국어 한 줄 안의 반말·존댓말 섞임을 가른다 — 명사 외침은 셈하지 않는다', () => {
    const mom = { relationshipLabel: '엄마' };
    expect(hasMixedKoreanRegister('우리 딸, 오늘 하늘이 많이 흐리대요. 커튼부터 열자.', mom)).toBe(true);
    expect(hasMixedKoreanRegister('우리 딸, 잘 잤어? 오늘도 화이팅이야.', mom)).toBe(false);
    expect(hasMixedKoreanRegister('할머니, 일어나실 시간이에요. 오늘도 화이팅!', { relationshipLabel: '손녀' })).toBe(false);
    expect(hasMixedKoreanRegister('자기야, 비 온대. 우산 챙겨.', { relationshipLabel: '남자친구' })).toBe(false);
    // 반말만 써야 하는 관계는 존댓말 한 문장으로도 걸린다.
    expect(hasMixedKoreanRegister('자기야, 오늘 비 온대요.', { relationshipLabel: '남자친구' })).toBe(true);
    // 자유 입력 라벨도 프롬프트와 같은 판정 — '친한 친구'·'큰언니' 는 반말 관계다.
    expect(hasMixedKoreanRegister('오늘 비 온대요. 우산 챙기세요.', { relationshipLabel: '친한 친구' })).toBe(true);
    expect(hasMixedKoreanRegister('오늘 비 온대요. 우산 챙기세요.', { relationshipLabel: '큰언니' })).toBe(true);
    // 어느 갈래에도 안 드는 자유 입력 라벨('동료')은 관계 없음과 같이 해요체다.
    expect(hasMixedKoreanRegister('오늘 비 온대. 우산 챙겨.', { relationshipLabel: '동료' })).toBe(true);
    expect(hasMixedKoreanRegister('오늘 비 온대요. 우산 챙기세요.', { relationshipLabel: '동료' })).toBe(false);
    // 부모 쪽이 앞선다 — '엄마친구' 는 해요체 한 줄도 허용되는 어른 말투다.
    expect(hasMixedKoreanRegister('오늘 비 온대요. 우산 챙기세요.', { relationshipLabel: '엄마친구' })).toBe(false);
    // 손주·자식 → 어르신은 반말 한 문장도 안 된다. 아이 목소리·반말로 녹음한 화자는 그 말투를 따른다.
    expect(hasMixedKoreanRegister('할머니, 지금 일어나. 우산 챙겨.', { relationshipLabel: '손녀' })).toBe(true);
    expect(hasMixedKoreanRegister('엄마, 일어나실 시간이에요. 우산 챙기세요.', { relationshipLabel: '딸' })).toBe(false);
    expect(
      hasMixedKoreanRegister('할머니, 지금 일어나. 우산 챙겨.', {
        relationshipLabel: '손녀',
        speechStyle: { dialect: '', strength: '', register: 'banmal', markers: [], persona: '', childlike: false },
      }),
    ).toBe(false);
    // 호칭만 외친 문장('할머니!')은 어체로 세지 않는다.
    expect(
      hasMixedKoreanRegister('할머니! 일어나실 시간이에요.', { relationshipLabel: '손녀', listenerTitle: '할머니' }),
    ).toBe(false);
    // 어간과 합쳐진 반말(일어나·챙겨·마셔)도 반말이다.
    expect(hasMixedKoreanRegister('우리 딸, 오늘 비 온대요. 우산 챙겨.', mom)).toBe(true);
    expect(hasMixedKoreanRegister('자기야, 물 많이 마셔요.', { relationshipLabel: '남자친구' })).toBe(true);
    // 쉼표로 이은 두 절의 어체가 다르면 걸린다.
    expect(hasMixedKoreanRegister('오늘 비 온대요, 우산 챙겨.', { relationshipLabel: '남자친구' })).toBe(true);
    expect(hasMixedKoreanRegister('오늘 비 온대, 우산 챙기세요.', { relationshipLabel: '동료' })).toBe(true);
    // 쉼표 앞 부름말·감탄사와 이음 어미는 세지 않는다.
    expect(hasMixedKoreanRegister('우리 아들아, 오늘 비 온대요. 우산 챙겨요.', { relationshipLabel: '엄마' })).toBe(false);
    expect(hasMixedKoreanRegister('자, 이제 일어나 볼까요?', {})).toBe(false);
    // 짧아도 부름말이 아닌 절은 센다.
    expect(hasMixedKoreanRegister('오늘 휴일이야, 푹 쉬세요.', { relationshipLabel: '동료' })).toBe(true);
    expect(hasMixedKoreanRegister('괜찮아, 천천히 시작하세요.', { relationshipLabel: '동료' })).toBe(true);
    // 청자 호칭을 지우고 남은 부름 조사('자기야' → '야')는 건너뛴다.
    expect(hasMixedKoreanRegister('자기야, 이제 일어나.', { relationshipLabel: '남자친구', listenerTitle: '자기' })).toBe(false);
    expect(hasMixedKoreanRegister('비가 오니까, 우산 꼭 챙기세요.', {})).toBe(false);
    // '-ㅂ시다' 는 존댓말이다 — 반말 전용 관계에서 걸린다.
    expect(hasMixedKoreanRegister('자기야, 이제 일어납시다.', { relationshipLabel: '남자친구' })).toBe(true);
    expect(hasMixedKoreanRegister('할머니, 같이 일어납시다.', { relationshipLabel: '손녀', listenerTitle: '할머니' })).toBe(false);
    // 합쇼체 명령(-십시오)도 존댓말이다 — 반말 전용 관계에서 걸린다.
    expect(hasMixedKoreanRegister('자기야, 지금 일어나십시오.', { relationshipLabel: '남자친구' })).toBe(true);
    // 문장 끝 '-까'(먹을까?) 도 반말이다 — '합니까' 는 존댓말, '…' 앞 '-니까' 는 이음 어미.
    expect(hasMixedKoreanRegister('약 먹을까? 지금 챙겨 드세요.', { relationshipLabel: '동료' })).toBe(true);
    expect(hasMixedKoreanRegister('준비됐습니까? 이제 가시죠.', { relationshipLabel: '손자' })).toBe(false);
    // 문장 끝 '-는데' 도 반말이다 — 쉼표 앞 '-는데' 는 이음 어미라 세지 않는다.
    expect(hasMixedKoreanRegister('오늘 비가 오는데. 우산 챙기세요.', { relationshipLabel: '동료' })).toBe(true);
    expect(hasMixedKoreanRegister('오늘 비가 오는데, 우산 챙기세요.', { relationshipLabel: '동료' })).toBe(false);
    // 문장 끝 '-거든' 도 반말이다.
    expect(hasMixedKoreanRegister('오늘 비가 오거든. 우산 챙기세요.', { relationshipLabel: '동료' })).toBe(true);
    // '힘내'·'걱정 마' 도 반말이다.
    expect(hasMixedKoreanRegister('엄마, 오늘도 힘내. 약 드실 시간이에요.', { relationshipLabel: '딸', listenerTitle: '엄마' })).toBe(true);
    expect(hasMixedKoreanRegister('할머니, 걱정 마. 우산 챙기세요.', { relationshipLabel: '손녀', listenerTitle: '할머니' })).toBe(true);
    // 확정 문구(styleReference)의 어체가 관계보다 앞선다.
    expect(
      hasMixedKoreanRegister('자기야, 오늘 비 온대요. 우산 챙겨요.', {
        relationshipLabel: '아내',
        listenerTitle: '자기',
        styleReference: '[warmly] 자기야, 일어날 시간이에요. 오늘도 힘내요.',
      }),
    ).toBe(false);
    expect(
      hasMixedKoreanRegister('오늘 비 온대. 우산 챙겨.', { relationshipLabel: '동료', styleReference: '일어나. 오늘도 힘내.' }),
    ).toBe(false);
    // 확정 문구가 한 어체만 쓰면 그 어체로 고정한다 — 반대 어체는 걸린다.
    expect(
      hasMixedKoreanRegister('자기야, 오늘 비 온대. 우산 챙겨.', {
        relationshipLabel: '아내',
        listenerTitle: '자기',
        styleReference: '[warmly] 자기야, 일어날 시간이에요. 오늘도 힘내요.',
      }),
    ).toBe(true);
    expect(
      hasMixedKoreanRegister('오늘 비 온대요. 우산 챙기세요.', { relationshipLabel: '동료', styleReference: '일어나. 오늘도 힘내.' }),
    ).toBe(true);
    // 확정 문구가 없으면 관계대로 — 배우자의 해요체는 걸린다.
    expect(hasMixedKoreanRegister('자기야, 오늘 비 온대요. 우산 챙겨요.', { relationshipLabel: '아내' })).toBe(true);
    // 평서 '-다' 는 반말이고, '-니다' 는 존댓말이다.
    expect(hasMixedKoreanRegister('우리 딸, 오늘은 날씨가 좋다. 우산 챙기세요.', mom)).toBe(true);
    expect(hasMixedKoreanRegister('준비됐습니다. 이제 가세요.', { relationshipLabel: '손자' })).toBe(false);
    // '…' 로 끊긴 문장도 본다 — 단 '…' 앞의 이음 어미(-니까·-니·-면)는 어체로 세지 않는다.
    expect(hasMixedKoreanRegister('우리 딸, 흐리대요… 이제 일어나자!', mom)).toBe(true);
    expect(hasMixedKoreanRegister('비가 오니까… 우산 꼭 챙기세요.', {})).toBe(false);
    expect(hasMixedKoreanRegister('할 일이 많으면… 하나씩 해 봐요.', {})).toBe(false);
    expect(hasMixedKoreanRegister('그래도… 이제 일어나자!', mom)).toBe(false);
    // '합니까/습니까' 만 존댓말이다 — 문장 끝 '오니까.' 는 아니다.
    expect(hasMixedKoreanRegister('준비됐습니까? 이제 가자.', mom)).toBe(true);
    expect(hasMixedKoreanRegister('비 오니까. 우산 챙겨.', mom)).toBe(false);
    expect(
      hasMixedKoreanRegister('아빠, 약 먹을 시간이에요.', {
        relationshipLabel: '딸',
        speechStyle: { dialect: '', strength: '', register: 'banmal', markers: [], persona: '', childlike: true },
      }),
    ).toBe(true);
  });

  it('사전렌더: 어체가 섞이면 다시 묻고, 다음 회차에 그 사유를 말한다', async () => {
    queueContent(geminiText('{"text":"[warmly] 우리 딸, 오늘 하늘이 많이 흐리대요. [encouraging] 커튼부터 열고 일어나자."}'));
    queueContent(geminiText('{"text":"[warmly] 우리 딸, 오늘 하늘이 많이 흐리대. [encouraging] 커튼부터 열고 일어나자."}'));
    const out = await generatePrerenderClipText(ENV, {
      seed: '흐리다고 알리고 커튼부터 열고 일어나자고 한다.',
      relationshipLabel: '엄마',
      listenerTitle: '우리 딸',
      targetLanguage: 'ko',
    });
    expect(out.text).toContain('흐리대.');
    const prompts = mockFetch.mock.calls
      .filter((c) => String(c[0]) !== TOKEN_URI)
      .map((c) => JSON.parse(String(c[1]?.body)).contents[0].parts[0].text as string);
    expect(prompts).toHaveLength(2);
    // 무엇이 틀렸는지 낱말로 짚어 준다 — '어체를 맞춰라' 만으로는 같은 '-요' 를 되풀이했다.
    expect(prompts[1]).toContain('WRONG speech level');
    expect(prompts[1]).toContain("'흐리대요'");
  });

  it('사전렌더: 확정 문구가 해요체면 배우자 목소리의 해요체 클립도 통과한다(영구 실패 방지)', async () => {
    queueContent(geminiText('{"text":"[warmly] 자기야, 오늘 비 온대요. [caring] 나갈 때 우산 꼭 챙겨요."}'));
    const out = await generatePrerenderClipText(ENV, {
      seed: '비가 온다고 알리고 우산을 챙기라고 한다.',
      relationshipLabel: '아내',
      listenerTitle: '자기야',
      targetLanguage: 'ko',
      styleReference: '[warmly] 자기야, 일어날 시간이에요. 오늘도 힘내요.',
    });
    expect(out.text).toContain('챙겨요');
    const prompts = mockFetch.mock.calls.filter((c) => String(c[0]) !== TOKEN_URI);
    expect(prompts).toHaveLength(1);
  });

  it('목소리의 결: 사용자가 고른 값이 분석값보다 앞서고, 고르지 않으면 분석값을 둔다', () => {
    const analyzed = { dialect: '경상', strength: 'low' as const, register: 'banmal', markers: ['~카이'], persona: '', childlike: false, energy: 'lively' as const };
    expect(withVoiceEnergy(analyzed, 'calm')).toEqual({ ...analyzed, energy: 'calm' });
    expect(withVoiceEnergy(analyzed, '')).toBe(analyzed);
    expect(withVoiceEnergy(analyzed, null)).toBe(analyzed);
    expect(withVoiceEnergy(null, 'lively')?.energy).toBe('lively');
    expect(withVoiceEnergy(null, 'weird')).toBeNull();
  });

  it('사전렌더 프롬프트: 결과 사람이 쓴 본보기를 싣는다 — 진중한 결은 문장 모양으로 말한다', async () => {
    queueContent(geminiText('{"text":"[warmly] 자기야, 약 먹을 시간이야. [sincerely] 지금 바로 챙겨 먹자."}'));
    await generatePrerenderClipText(ENV, {
      seed: '약 먹을 시간이라고 알리고 지금 바로 챙겨 먹으라고 당부한다.',
      relationshipLabel: '남자친구',
      listenerTitle: '자기',
      targetLanguage: 'ko',
      speechStyle: { dialect: '', strength: '', register: 'banmal', markers: [], persona: '', childlike: false, energy: 'calm' },
      humanReference: '[warmly] 약 먹을 시간이에요. [encouraging] 알람 끄기 전에 지금 바로 챙겨 먹어요.',
    });
    const body = JSON.stringify(contentRequestBody());
    expect(body).toContain('VOICE ENERGY');
    expect(body).toContain('CALM');
    expect(body).toContain('HUMAN-WRITTEN REFERENCE');
    expect(body).toContain('REWRITE EVERY ENDING');
  });

  it('사전렌더: 예스러운 -셔요 는 -세요 로 고쳐 저장한다', async () => {
    queueContent(geminiText('{"text":"[warmly] 할아버지, 이제 슬슬 일어나 보셔요. [caring] 우산 꼭 챙기셔요."}'));
    const out = await generatePrerenderClipText(ENV, {
      seed: '비가 온다고 알리고 일어나 우산을 챙기라고 한다.',
      relationshipLabel: '손녀',
      listenerTitle: '할아버지',
      targetLanguage: 'ko',
    });
    expect(out.text).toContain('일어나 보세요');
    expect(out.text).toContain('챙기세요');
    expect(out.text).not.toContain('셔요');
  });

  // ⚠ **존대 `-시-` 가 붙은 줄기만 고친다**(Codex #802). 줄기가 원래 `시` 로 끝나는 낱말까지 바꾸면
  // 뜻이 깨진다 — 특히 `마셔요`→`마세요` 는 '마시다' 가 '하지 마세요' 가 된다.
  it('-셔요 현대화는 존대 줄기에만 — 눈부셔요·적셔요·마셔요·모셔요는 그대로', () => {
    expect(modernizeKoreanHonorific('할아버지, 일어나 보셔요. 우산 챙기셔요. 약 드셔요.')).toBe(
      '할아버지, 일어나 보세요. 우산 챙기세요. 약 드세요.',
    );
    expect(modernizeKoreanHonorific('잠깐 앉으셔요. 푹 주무셔요? 이제 일어나셔요!')).toBe(
      '잠깐 앉으세요. 푹 주무세요? 이제 일어나세요!',
    );
    for (const kept of ['햇살이 눈부셔요.', '비가 옷을 적셔요.', '물 한 잔 마셔요.', '부모님을 모셔요.']) {
      expect(modernizeKoreanHonorific(kept)).toBe(kept);
    }
  });

  it('관계를 모르는 목소리의 반말은 섞임으로 본다 — 등록 녹음이 반말이면 그 말투를 따른다', () => {
    expect(hasMixedKoreanRegister('미안해요, 날씨를 못 봤어요. 그래도 이제 일어나 봐요.', {})).toBe(false);
    expect(hasMixedKoreanRegister('미안해, 인터넷이 먹통이라 날씨를 못 봤어… 이제 일어나서 시작해 보자!', {})).toBe(true);
    expect(
      hasMixedKoreanRegister('날씨를 못 봤어. 이제 일어나 보자!', {
        speechStyle: { dialect: '', strength: '', register: 'banmal', markers: [], persona: '', childlike: false },
      }),
    ).toBe(false);
  });

  it('말줄임표 뒤에 겹친 마침표만 줄인다', () => {
    expect(tidyEllipsis('날씨를 못 봤어…. 창밖 한번 봐.')).toBe('날씨를 못 봤어… 창밖 한번 봐.');
    expect(tidyEllipsis('okay.... get up')).toBe('okay... get up');
    expect(tidyEllipsis('그래도… 일어나자.')).toBe('그래도… 일어나자.');
    expect(tidyEllipsis('今日は空気がよくないみたい…、マスクしてね。')).toBe('今日は空気がよくないみたい…マスクしてね。');
    expect(tidyEllipsis('Hey sweetie…, time to get up.')).toBe('Hey sweetie… time to get up.');
  });

  it('인사가 아닌 시드에서만 아침 인사를 막는다 — 시드가 아침을 말하면 허용', () => {
    const fortune = '오늘은 운이 따라주는 날이라고 가볍게 재미로 전한다.';
    expect(hasAssumedMorning('좋은 아침이에요. 오늘은 운이 좋은 날이래요.', fortune, 'ko')).toBe(true);
    expect(hasAssumedMorning('Morning, sweetie. Luck is on your side today.', fortune, 'en')).toBe(true);
    expect(hasAssumedMorning('おはよう。今日はツイてる日だよ。', fortune, 'ja')).toBe(true);
    expect(hasAssumedMorning('할머니, 오늘은 운이 따라주는 날이래요.', fortune, 'ko')).toBe(false);
    expect(hasAssumedMorning('좋은 아침이에요. 잘 잤어요?', '다정하게 아침 인사를 하며 잘 잤는지 묻는다.', 'ko')).toBe(false);
    expect(hasAssumedMorning("Let's start the morning strong.", '그래도 아침은 힘차게 시작하자고 한다.', 'en')).toBe(false);
    // 시드가 아침을 말하기만 하면 낱말은 두되, 인사·수면 안부는 여전히 막는다.
    const dust = '미세먼지가 심하다고 알리고 그래도 아침은 힘차게 시작하자고 한다.';
    expect(hasAssumedMorning('우리 손녀, 잘 잤니? 오늘 미세먼지가 심하대.', dust, 'ko')).toBe(true);
    expect(hasAssumedMorning('Morning, babe. The air is bad today.', dust, 'en')).toBe(true);
    expect(hasAssumedMorning('Hope you slept well. The air is bad today.', dust, 'en')).toBe(true);
    expect(hasAssumedMorning('よく眠れた？今日は空気がよくないみたい。', dust, 'ja')).toBe(true);
    expect(hasAssumedMorning('The air is bad, but let\'s start the morning strong.', dust, 'en')).toBe(false);
    expect(hasAssumedMorning('Take your meds this morning.', '약 먹을 시간이라고 알린다.', 'en')).toBe(true);
    // 합성 언어 전부 — 프랑스어·이탈리아어도 막는다.
    const med = '약 먹을 시간이라고 알린다.';
    expect(hasAssumedMorning("Bonjour ma chérie, c'est l'heure de ton médicament.", med, 'fr')).toBe(true);
    expect(hasAssumedMorning("Tu as bien dormi ? C'est l'heure du médicament.", med, 'fr')).toBe(true);
    expect(hasAssumedMorning("C'est l'heure de ton médicament.", med, 'fr')).toBe(false);
    expect(hasAssumedMorning('Buongiorno! È ora della medicina.', med, 'it')).toBe(true);
    expect(hasAssumedMorning('Hai dormito bene? È ora della medicina.', med, 'it')).toBe(true);
    expect(hasAssumedMorning('È ora della medicina.', med, 'it')).toBe(false);
    expect(hasAssumedMorning('Commençons la matinée en forme.', dust, 'fr')).toBe(false);
    // 일본어·한국어 '아침' 낱말도 — 시드가 아침을 말하지 않으면.
    expect(hasAssumedMorning('朝のお薬の時間ですよ。', med, 'ja')).toBe(true);
    expect(hasAssumedMorning('아침 약 드실 시간이에요.', med, 'ko')).toBe(true);
    expect(hasAssumedMorning('今日も元気に一日を始めよう。', dust, 'ja')).toBe(false);
  });

  it('축약 없는 영어는 두 번 이상일 때만 로봇 말투로 본다', () => {
    expect(isUncontractedEnglish('You do not have to get it all right away, so let us take it one step at a time.')).toBe(true);
    expect(isUncontractedEnglish("I will always be here. Let's get up.")).toBe(false);
    expect(isUncontractedEnglish("You don't have to do it all. Let's go.")).toBe(false);
    // 조동사 부정도 센다.
    expect(isUncontractedEnglish('You have not failed. You should not carry this alone.')).toBe(true);
  });

  it('사전렌더: 인사가 아닌 알람의 아침 인사는 다시 묻고, 다음 회차에 그 사유를 말한다', async () => {
    queueContent(geminiText('{"text":"[warmly] Morning, sweetie. [caring] Time for your meds, take them now."}'));
    queueContent(geminiText('{"text":"[warmly] Sweetie, time for your meds. [caring] Take them now, okay?"}'));
    const out = await generatePrerenderClipText(ENV, {
      seed: '약 먹을 시간이라고 알리고 지금 바로 챙겨 먹으라고 당부한다.',
      relationshipLabel: '엄마',
      listenerTitle: 'sweetie',
      targetLanguage: 'en',
    });
    expect(out.text).not.toMatch(/morning/i);
    const prompts = mockFetch.mock.calls
      .filter((c) => String(c[0]) !== TOKEN_URI)
      .map((c) => JSON.parse(String(c[1]?.body)).contents[0].parts[0].text as string);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('assumed it was morning');
  });

  it('사전렌더: 생성 문구의 겹친 마침표를 다듬어 저장한다', async () => {
    queueContent(geminiText('{"text":"[apologetic] 미안해요, 날씨를 못 봤어요…. [caring] 나가기 전에 창밖 한번 봐 주세요."}'));
    const out = await generatePrerenderClipText(ENV, {
      seed: '인터넷이 안 돼 오늘 날씨를 확인하지 못했다고 미안한 듯 알린다.',
      targetLanguage: 'ko',
    });
    expect(out.text).toBe('미안해요, 날씨를 못 봤어요… 나가기 전에 창밖 한번 봐 주세요.');
    expect(out.text).not.toContain('….');
  });

  it('3.x 응답(답 part 에 thoughtSignature)도 그대로 문구로 쓴다', async () => {
    queueContent(
      candidateResponse({
        finishReason: 'STOP',
        content: { parts: [{ text: '{"text":"Keep it up today"}', thoughtSignature: 'sig' }] },
      }),
    );
    const prepared = await prepareAlarmTextWithVertex(ENV, '오늘도 화이팅', {
      targetLanguage: 'en',
      sourceLanguage: 'ko',
      translate: true,
    });
    expect(prepared.text).toBe('Keep it up today');
    expect(prepared.provider).toBe('vertex');
  });
});

describe('prepareAlarmTextWithVertex', () => {
  // 2026-09-30: 같은 언어 직접 입력마다 태그를 달려고 Gemini 를 부르던 길을 없앴다 — 사용자가 친 글 그대로다.
  it('같은 언어 직접 입력은 Gemini 를 부르지 않고 친 글 그대로 합성한다 — 태그를 붙이지 않는다', async () => {
    const prepared = await prepareAlarmTextWithVertex(ENV, '  오늘도 화이팅!  ', {
      targetLanguage: 'ko',
      sourceLanguage: 'ko',
      translate: false,
    });
    expect(prepared).toEqual({ text: '오늘도 화이팅!', translated: false, tags: [], provider: 'local' });
    expect(mockFetch).not.toHaveBeenCalled();

    // 번역을 요청해도 언어가 같으면 번역이 아니다.
    const same = await prepareAlarmTextWithVertex(ENV, 'Good morning. Wake up.', {
      targetLanguage: 'en',
      sourceLanguage: 'en',
      translate: true,
    });
    expect(same.text).toBe('Good morning. Wake up.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('parses JSON even when Gemini adds a short preamble', async () => {
    queueContent(geminiText('Here is the JSON requested:\n{"text":"Hello"}'));

    const prepared = await prepareAlarmTextWithVertex(ENV, '안녕', {
      targetLanguage: 'en',
      sourceLanguage: 'ko',
      translate: true,
    });

    expect(prepared.text).toBe('Hello');
    expect(prepared.tags).toEqual([]);
  });

  it('직접 입력: 사용자가 직접 쓴 태그는 공포 태그여도 그대로 둔다', async () => {
    const prepared = await prepareAlarmTextWithVertex(ENV, '[panicked] 지각이다!! 일어나!!', {
      targetLanguage: 'ko',
      sourceLanguage: 'ko',
      translate: false,
    });
    expect(prepared.text).toBe('[panicked] 지각이다!! 일어나!!');
    expect(prepared.tags).toEqual(['panicked']);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not synthesize malformed translation output', async () => {
    queueContent(geminiText('Here Is the json requested:'));

    await expect(
      prepareAlarmTextWithVertex(ENV, '좋은 아침이에요', {
        targetLanguage: 'en',
        sourceLanguage: 'ko',
        translate: true,
      }),
    ).rejects.toBeInstanceOf(AlarmTextPreparationInvalidError);
  });

  it('Vertex 설정이 없으면 번역은 던지고, 같은 언어는 그대로 나간다', async () => {
    const noVertex = { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: '' };
    await expect(
      prepareAlarmTextWithVertex(noVertex, '좋은 아침이에요', { targetLanguage: 'en', sourceLanguage: 'ko', translate: true }),
    ).rejects.toThrow('Alarm text translation is not configured.');
    const same = await prepareAlarmTextWithVertex(noVertex, '좋은 아침이에요', {
      targetLanguage: 'ko',
      sourceLanguage: 'ko',
      translate: false,
    });
    expect(same.text).toBe('좋은 아침이에요');
  });

  it('translates without adding delivery tags', async () => {
    queueContent(geminiText('{"text":"Good morning!"}'));

    const prepared = await prepareAlarmTextWithVertex(ENV, '좋은 아침이에요', {
      targetLanguage: 'en',
      sourceLanguage: 'ko',
      translate: true,
    });

    expect(prepared.text).toBe('Good morning!');
    expect(prepared.translated).toBe(true);
    expect(prepared.tags).toEqual([]);
    expect(sentPromptText()).not.toContain('delivery tag');
  });
});

describe('generateDynamicAlarmTextWithVertex', () => {
  it('uses local preset-style fallback unless dynamic Gemini text is explicitly enabled', async () => {
    queueContent(geminiText('{"text":"Gemini should not be used","tag":"cheerfully"}'));

    const generated = await generateDynamicAlarmTextWithVertex(
      {
        ...ENV,
        GOOGLE_VERTEX_DYNAMIC_TEXT_ENABLED: undefined,
      },
      {
        mode: 'love',
        category: 'love',
        targetLanguage: 'ko',
        dateLabel: '5월 20일 수요일',
        relationshipLabel: '연인',
        listenerTitle: '자기야',
      },
    );

    expect(generated.provider).toBe('local');
    expect(generated.text).toContain('자기야');
    expect(generated.text).not.toContain('Gemini should not be used');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to readable dynamic text when Gemini returns helper text only', async () => {
    queueContent(geminiText('Here Is the json requested:'));

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '손녀',
      weatherSignal: { conditions: [{ kind: 'rain', action: 'umbrella' }] },
    });

    expect(generated.text).toContain('일어나실 시간');
    expect(generated.text).toContain('비가 올 수 있대요');
    expect(generated.text).toContain('우산 꼭 챙기세요');
    expect(generated.text).not.toContain('강수 확률 70%');
    expect(generated.text).not.toContain('손녀 목소리');
    expect(generated.text).not.toContain('5월 20일');
    expect(generated.text).not.toContain('서울');
    expect(generated.text).not.toContain('json requested');
  });

  it('falls back when Gemini guesses a listener family title from the speaker relationship', async () => {
    queueContent(
      geminiText('{"text":"할머니, 5월 20일 수요일이에요. 서울엔 비가 오니 우산 챙기세요."}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '손녀',
      weatherSignal: { conditions: [{ kind: 'rain', action: 'umbrella' }] },
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).toContain('일어나실 시간');
    expect(generated.text).toContain('비가 올 수 있대요');
    expect(generated.text).toContain('우산 꼭 챙기세요');
    expect(generated.text).not.toContain('강수 확률 70%');
    expect(generated.text).not.toContain('손녀 목소리');
    expect(generated.text).not.toContain('5월 20일');
    expect(generated.text).not.toContain('서울');
    expect(generated.text).not.toContain('할머니');
  });

  it('accepts an explicit listener title even when it is a family title', async () => {
    queueContent(
      geminiText('{"text":"할아버지, 일어나실 시간이에요. 오늘 비 올 수 있대요. 나가실 때 우산 꼭 챙기세요."}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      alarmTimeLabel: '07:30',
      relationshipLabel: '손녀',
      listenerTitle: '할아버지',
      weatherSignal: { conditions: [{ kind: 'rain', action: 'umbrella' }] },
    });

    const requestBody = contentRequestBody();
    const prompt = requestBody.contents[0].parts[0].text;
    expect(generated.provider).toBe('vertex');
    expect(generated.text).toContain('할아버지');
    expect(generated.text).toContain('오늘은 비가 올 수 있대요');
    expect(generated.text).not.toContain('오늘 비 올 수 있대요');
    expect(generated.text).toContain('우산 꼭 챙기세요');
    expect(prompt).toContain('actual grandchild speaking beside the listener');
    expect(prompt).toContain('할아버지, 일어나실 시간이에요');
    expect(prompt).toContain('avoid clipped wording like "비 올 수 있대요"');
    expect(prompt).toContain('조심히 다녀오세요');
  });

  it('polishes grandchild to grandparent wake wording into respectful verb forms', async () => {
    queueContent(
      geminiText('{"text":"할머니, 일어날 시간이에요! 오늘은 천천히 움직이면 컨디션이 좋대요."}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_fortune',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '손주',
      listenerTitle: '할머니',
      fortuneProfile: 'gender=여성, birth date=1954-01-05, birth time=05:30',
    });

    const requestBody = contentRequestBody();
    const prompt = requestBody.contents[0].parts[0].text;
    expect(generated.provider).toBe('vertex');
    expect(generated.text).toContain('할머니, 일어나실 시간이에요');
    expect(generated.text).not.toContain('할머니, 일어날 시간이에요');
    expect(prompt).toContain('Speaker is a grandchild speaking to a grandparent');
    expect(prompt).toContain('never write casual elder-address phrases like "할머니, 일어날 시간이에요"');
  });

  it('prompts romantic partner cases with warm tone and flexible weather relay wording', async () => {
    queueContent(
      geminiText('{"text":"자기야, 일어나자. 비 온대. 나가기 전에 우산 챙겨."}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      alarmTimeLabel: '07:30',
      relationshipLabel: '남편',
      listenerTitle: '자기야',
      weatherSignal: { conditions: [{ kind: 'rain', action: 'umbrella' }] },
    });

    const requestBody = contentRequestBody();
    const prompt = requestBody.contents[0].parts[0].text;
    expect(generated.provider).toBe('vertex');
    expect(prompt).toContain('Romantic partner/spouse tone');
    expect(prompt).toContain('heart-fluttering');
    expect(prompt).toContain('Avoid robotic connector phrases like "예보 보니까"');
    expect(prompt).toContain('연인·남자친구·여자친구·아내·남편·배우자');
  });

  it('uses warmer romantic fallback copy when Gemini is unavailable', async () => {
    const generated = await generateDynamicAlarmTextWithVertex(
      {
        ...ENV,
        GOOGLE_VERTEX_CREDENTIALS_JSON: undefined,
      },
      {
        mode: 'wake_weather',
        category: 'morning',
        targetLanguage: 'ko',
        dateLabel: '5월 20일 수요일',
        relationshipLabel: '여자친구',
        listenerTitle: '자기야',
        weatherSignal: { conditions: [{ kind: 'rain', action: 'umbrella' }] },
      },
    );

    expect(generated.provider).toBe('local');
    expect(generated.text).toContain('자기야');
    expect(generated.text).toContain('비 올 수 있대');
    expect(generated.text).toContain('우산 꼭 챙겨');
    expect(generated.text).toContain('오늘도 네 편이야');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps romantic weather fallback in intimate speech for spouse labels', async () => {
    const generated = await generateDynamicAlarmTextWithVertex(
      {
        ...ENV,
        GOOGLE_VERTEX_CREDENTIALS_JSON: undefined,
      },
      {
        mode: 'wake_weather',
        category: 'morning',
        targetLanguage: 'ko',
        dateLabel: '5월 20일 수요일',
        relationshipLabel: '아내',
        listenerTitle: '여보',
        weatherSignal: { conditions: [{ kind: 'nice', action: 'walk' }] },
      },
    );

    expect(generated.provider).toBe('local');
    expect(generated.text).toContain('여보');
    expect(generated.text).toContain('날씨 좋대');
    expect(generated.text).toContain('딱이야');
    expect(generated.text).not.toContain('좋대요');
    expect(generated.text).not.toContain('딱이에요');
  });

  it('falls back when romantic output uses stiff register or jealousy-triggering fortune', async () => {
    queueContent(
      geminiText('{"text":"자기야, 일어나세요. 오늘은 새로운 인연을 만날 수도 있대요."}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_fortune',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '여자친구',
      listenerTitle: '자기야',
      fortuneProfile: 'gender=남성, birth date=1994-09-12, birth time=07:30',
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).toContain('자기야');
    expect(generated.text).toContain('작은 행운');
    expect(generated.text).not.toContain('새로운 인연');
    expect(generated.text).not.toContain('일어나세요');
  });

  it('falls back when Gemini mentions the speaker relationship as the source', async () => {
    queueContent(
      geminiText('{"text":"할머니, 손녀 목소리로 전해요. 일어나실 시간이에요."}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '손녀',
      listenerTitle: '할머니',
      weatherSignal: { conditions: [{ kind: 'rain', action: 'umbrella' }] },
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).toContain('할머니');
    expect(generated.text).not.toContain('손녀 목소리');
  });

  // ⚠ **이 테스트는 2026-08-20 에 뒤집혔다 — 예전에는 이걸 거절하도록 고정하고 있었다.**
  // "민지야, … 엄마가 응원할게!" 는 엄마가 딸에게 하는 **가장 자연스러운 한국어**다.
  // 그런데 옛 가드가 `엄마`+조사를 전부 유출로 보고 떨어뜨렸고, 그 탓에 사전렌더
  // 사랑 3번 시드("늘 네 편이라고 응원한다") × 관계 '엄마' 가 **영구 실패**했다
  // (dev 실측: cron 5틱 연속 거절 → 큐 failed → 앱에 "생성에 실패했어요").
  // 화자의 3인칭 자기 지칭은 통과시키고, 화자가 그 사람이 **아님**을 드러내는 쓰임만 막는다.
  it('keeps the line when the speaker refers to themselves in the third person', async () => {
    queueContent(
      geminiText('{"text":"민지야, 실내에서 가볍게 운동하자. 엄마가 응원할게!"}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '엄마',
      listenerTitle: '민지야',
    });

    expect(generated.provider).toBe('vertex');
    expect(generated.text).toContain('엄마가 응원할게');
  });

  // ⚠ **관계 라벨로 상대 호칭을 추측하지 않는다**(Codex #701 P2). 2026-08-20 에 잠깐
  // 열었다가 되돌렸다 — 관계 '아들' 은 화자가 아들이라는 뜻일 뿐 듣는 사람이 엄마인지
  // 아빠인지는 모른다. 추측을 허용하면 **엄마를 "아빠" 라고 부르는 클립이 영구 저장**된다.
  it('rejects a guessed family title when no listener title was provided', async () => {
    queueContent(geminiText('{"text":"엄마, 일어나! 오늘도 좋은 하루 보내."}'));

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '아들',
    });

    expect(generated.provider).toBe('local');
  });

  // ⚠ 태그 문법(ASCII)에 안 맞는 대괄호는 **벗겨지지도 인식되지도 않는다** — 그대로 두면
  // 낭독되거나 화면에 뜬다(Codex #701 P2).
  it('falls back when the line carries a bracketed direction outside the tag grammar', async () => {
    queueContent(geminiText('{"text":"[다정하게] 좋은 아침이에요. 오늘도 힘내요!"}'));

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).not.toContain('[다정하게]');
  });

  // ⚠ 닫히지 않은 대괄호는 `[...]` 쌍 매칭으로 잡히지 않는다(Codex #701 P2).
  it('falls back when a bracketed direction is left unclosed', async () => {
    queueContent(geminiText('{"text":"[다정하게 좋은 아침이에요. 오늘도 힘내요!"}'));

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).not.toContain('[');
  });

  // ⚠ 태그가 **화면 문구로 새면 안 된다**(Codex #701 P2). 이제는 합성에도 싣지 않는다(2026-09-30) —
  // 모델이 태그를 내도 벗긴 글 하나를 화면·합성에 같이 쓴다.
  it('모델이 낸 태그를 벗긴 글 하나를 화면·합성에 쓴다 — tags 는 비운다', async () => {
    queueContent(geminiText('{"text":"[warmly] 좋은 아침이에요. [brightly] 오늘도 힘내요!"}'));

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
    });

    expect(generated).toEqual({ text: '좋은 아침이에요. 오늘도 힘내요!', translated: false, tags: [], provider: 'vertex' });
    expect(generated).not.toHaveProperty('synthesisText');
    // 프롬프트도 태그를 쓰게 하지 않는다.
    expect(sentPromptText()).toContain('WORDS ONLY');
    expect(sentPromptText()).not.toContain('DELIVERY TAGS');
  });

  // ⚠ 관계에서 유도한 호칭은 **호칭이 비었을 때만** 쓰는 보완책이다(Codex #701 P1).
  // 사용자가 "자기야" 라고 넣었는데 "엄마," 로 시작하는 문구가 통과하면, 프롬프트가 약속한
  // 호칭과 다른 말이 사전렌더 클립에 영구 저장된다.
  it('prefers the explicit listener title over the inferred counterpart title', async () => {
    queueContent(geminiText('{"text":"엄마, 일어나! 오늘도 좋은 하루 보내."}'));

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '아들',
      listenerTitle: '자기야',
    });

    expect(generated.provider).toBe('local');
  });

  it('still falls back when the line uses a family title the relationship does not imply', async () => {
    queueContent(geminiText('{"text":"할머니, 일어나세요! 오늘도 좋은 하루 보내세요."}'));

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '아들',
    });

    expect(generated.provider).toBe('local');
  });

  it('still falls back when the line speaks as if the relationship were someone else', async () => {
    // 전언 구문("엄마가 … 달라고 했어")은 화자가 심부름꾼이라는 뜻이다 — 자기 지칭과 반대다.
    //
    // ⚠ **어미만 보면 안 된다**(Codex #701 P2 후속). 대리 구문은 조사로도 만들어져서
    // ("엄마한테 부탁받아서 깨우러 왔어") 전언 어미 검사를 통째로 비켜 갔다 —
    // 그대로 두면 엄마 목소리가 "엄마가 시켜서 왔어" 라고 말하는 클립이 영구 저장된다.
    for (const leak of [
      '엄마처럼 챙겨 줄게',
      '오늘은 엄마 대신 깨워 줄게',
      '엄마가 깨워 달라고 했어',
      '엄마를 대신해서 깨우러 왔어',
      '엄마한테 부탁받아서 깨우러 왔어',
      '엄마 부탁으로 알려 주는 거야',
      '엄마가 시켜서 왔어',
      '엄마 심부름으로 왔어',
      '엄마가 부탁해서 깨우러 왔어',
      '엄마가 깨우래',
      '엄마가 깨워 달래',
      '엄마가 얼른 일어나래요',
      // 절 끝 부호는 마침표만이 아니다 — 쉼표·전각쉼표·말줄임도 절을 닫는다(Codex #702 P2).
      '엄마가 깨우래, 얼른 준비하자',
      '엄마가 깨우래， 서두르자',
      '엄마가 깨우래요, 서두르자',
      '엄마가 깨우래… 서두르자',
      // 연결형 `래서` 도 전언이다 — 절 끝 부호가 아예 오지 않는다(Codex #702 P2).
      '엄마가 깨우래서 왔어',
      '엄마가 일어나래서 깨우는 거야',
      '엄마가 깨워 달래서 왔어',
      // **현재형 전언**은 지금 남의 말을 옮기는 형태라 엄마가 자기 말에 쓰지 않는다.
      // 적대적 검증(754문장)에서 무더기로 새던 갈래다.
      '엄마가 일어나라고 하네',
      '엄마가 우산 챙기라잖아',
      '엄마가 이제 일어나라네',
      '엄마가 나더러 깨우라셔',
      '엄마가 너 좀 깨워 달라네',
      '엄마가 일어나라며 성화야',
      '엄마가 깨우라던데 이제 일어나자',
      '엄마가 나한테 널 깨우라고 부탁했어',
      // **대리 구문 + 화자의 행동**. 지시 낱말만으로는 안 되고 대신 하는 행동이 있어야 한다.
      '엄마가 시킨 대로 깨우러 왔어',
      '엄마가 부탁하신 대로 깨우러 왔어',
      '엄마의 말씀을 전하러 왔어',
      '엄마의 부탁 때문에 깨우러 왔어',
      '엄마한테 부탁을 하나 받아서 왔어',
      // ⚠ '다른 행위자' 검사는 **대리 행동까지가 매치**인 갈래에서는 뒤를 보지 않는다
      // (Codex #702 P2). 뒤에 이어지는 딴 이야기의 사람을 보고 대리 판정을 꺼 버리면
      // 진짜 유출이 통과한다 — 마침표든 쉼표든 마찬가지다.
      '엄마가 시켜서 깨우러 왔어. 아빠한테도 전화해야 해',
      '엄마가 시켜서 깨우러 왔어, 아빠한테도 전화해야 해',
      // 축약형 `~란다`·`~랍니다`(= `~라고 한다`)도 현재형 전언이다.
      '엄마가 얼른 일어나란다',
      '엄마가 얼른 일어나랍니다',
      // 대리 행동은 깨우기·전달만이 아니다.
      '엄마가 시켜서 전화했어',
      '엄마가 부탁해서 말해 주는 거야',
      '엄마가 얼른 일어나라네',
      '엄마께서 시키신 일이라 왔어',
      '엄마가 보내서 깨우러 왔어',
      '엄마가 보내셔서 전하러 왔어',
      // 뒤를 훑는 갈래(`엄마 대신`)도 **같은 문장까지만** 본다 — 뒷문장의 사람을 보고
      // 대리 판정을 끄면 진짜 유출이 통과한다(Codex #702 P2).
      '엄마 대신 깨우러 왔어. 아빠한테도 전화해야 해',
    ]) {
      queueContent(geminiText(`{"text":"민지야, ${leak}. 얼른 일어나자!"}`));

      const generated = await generateDynamicAlarmTextWithVertex(ENV, {
        mode: 'wake_weather',
        category: 'morning',
        targetLanguage: 'ko',
        dateLabel: '5월 20일 수요일',
        relationshipLabel: '엄마',
        listenerTitle: '민지야',
      });

      expect(generated.provider, leak).toBe('local');
    }
  });

  // ⚠ **라벨은 앱 언어와 무관하게 한국어 정규값으로 저장된다**(안드로이드 `RelationshipPreset`).
  // 그래서 en·ja 문구에는 `엄마` 라는 글자가 없고, 한국어 조사·어미만 보는 가드는 그 두
  // 언어에서 통째로 무력했다(Codex #702 P2). 프롬프트는 세 언어에 걸려 있는데 백스톱만 비어
  // 있던 것이다.
  it('rejects messenger wording in English and Japanese output', async () => {
    const cases = [
      { lang: 'en', listener: 'Minji', text: 'Minji, your mom asked me to wake you up. Time to get going!' },
      { lang: 'en', listener: 'Minji', text: "Minji, I'm here on behalf of your mom. Rise and shine!" },
      { lang: 'en', listener: 'Minji', text: "Minji, this is your mom's voice reminding you to get up." },
      { lang: 'ja', listener: 'みんじ', text: 'みんじ、お母さんに頼まれて起こしに来たよ。' },
      { lang: 'ja', listener: 'みんじ', text: 'みんじ、ママの代わりに起こしに来たよ。' },
      { lang: 'ja', listener: 'みんじ', text: 'みんじ、お母さんが早く起きなさいって言ってたよ。' },
    ];
    for (const c of cases) {
      queueContent(geminiText(JSON.stringify({ text: c.text })));

      const generated = await generateDynamicAlarmTextWithVertex(ENV, {
        mode: 'wake_weather',
        category: 'morning',
        targetLanguage: c.lang,
        dateLabel: '5월 20일 수요일',
        relationshipLabel: '엄마',
        listenerTitle: c.listener,
      });

      expect(generated.provider, c.text).toBe('local');
    }
  });

  // 자기 3인칭 지칭은 en·ja 에서도 자연스럽다 — 전달 틀이 없으면 통과해야 한다.
  it('keeps third-person self-reference in English and Japanese output', async () => {
    const cases = [
      { lang: 'en', listener: 'Minji', text: 'Minji, good morning! Mom is always on your side. Have a great day.' },
      { lang: 'en', listener: 'Minji', text: 'Minji, it might rain today. Mom wants you to take an umbrella.' },
      { lang: 'ja', listener: 'みんじ', text: 'みんじ、おはよう。ママはいつも味方だからね。' },
      { lang: 'ja', listener: 'みんじ', text: 'みんじ、ママが作った朝ごはん、ちゃんと食べてね。' },
    ];
    for (const c of cases) {
      queueContent(geminiText(JSON.stringify({ text: c.text })));

      const generated = await generateDynamicAlarmTextWithVertex(ENV, {
        mode: 'wake_weather',
        category: 'morning',
        targetLanguage: c.lang,
        dateLabel: '5월 20일 수요일',
        relationshipLabel: '엄마',
        listenerTitle: c.listener,
      });

      expect(generated.provider, c.text).toBe('vertex');
    }
  });

  // ⚠ 관계 라벨은 **자유 입력**이라 "우리 엄마" 처럼 가족 토큰을 품은 복합어일 수 있다
  // (Codex #702 P2). 잡힌 토큰(`엄마`)을 라벨 전체와 그대로 비교하면 자기 자신을 '다른
  // 행위자' 로 읽어 대리 구문 탐지가 통째로 꺼진다.
  it('still detects proxy wording when the relationship label is a compound', async () => {
    for (const label of ['우리 엄마', '사랑하는 엄마']) {
      queueContent(geminiText(`{"text":"민지야, ${label}가 시켜서 깨우러 왔어. 얼른 일어나자!"}`));

      const generated = await generateDynamicAlarmTextWithVertex(ENV, {
        mode: 'wake_weather',
        category: 'morning',
        targetLanguage: 'ko',
        dateLabel: '5월 20일 수요일',
        relationshipLabel: label,
        listenerTitle: '민지야',
      });

      expect(generated.provider, label).toBe('local');
    }
  });

  // ⚠ 대리 구문 가드가 **자기 지칭까지 삼키면 안 된다.** 한국어에는 낱말 경계가 없어서
  // `~래` 한 글자가 권유형(`입을래?`)·명사(`노래`)와 겹치고, `~대` 는 날씨 전달의 표준
  // 어미라 프롬프트 few-shot 이 직접 쓴다("비가 올 수 있대요"). 넓게 잡으면 멀쩡한 문구가
  // 떨어지고, 그게 사랑 3번 시드를 영구 실패시켰던 바로 그 사고다.
  it('keeps natural self-reference that only looks like reported speech', async () => {
    for (const line of [
      '민지야, 엄마가 사 준 옷 입을래? 오늘 좀 쌀쌀해',
      '민지야, 엄마가 데려다줄까? 아니면 같이 걸어갈래?',
      '민지야, 일어나면 엄마가 틀어 주는 노래. 그거 듣고 힘내자',
      '민지야, 속상하면 엄마가 달래 줄게. 얼른 일어나자',
      '민지야, 엄마가 보니까 오늘 비 온대. 우산 꼭 챙겨',
      // 실 Vertex 출력(2026-08-21): `~ㄹ 거래` 는 날씨 전달의 표준 어미다.
      '민지야, 엄마가 창밖 보니 오늘은 흐릴 거래. 따뜻하게 입고 나가',
      '민지야, 엄마가 부탁해서 미안한데 오늘은 좀 일찍 나가 줘',
      '민지야, 일어나면 엄마한테 전화 한 통 줘',
      // 쉼표를 절 끝으로 인정한 뒤에도 권유형·명사는 그대로 통과해야 한다.
      '민지야, 엄마가 사 준 옷 입을래, 오늘 좀 쌀쌀해',
      '민지야, 엄마가 틀어 주는 노래, 그거 듣고 힘내자',
      // ⚠ **조사가 뜻을 뒤집는다**(Codex #702 P2). `부탁받다` 는 라벨이 **주는 쪽**일 때만
      // 유출이다 — 주격이면 엄마가 부탁을 **받은** 쪽이라 자기 지칭이다.
      '민지야, 엄마가 네 부탁받아서 오늘 일찍 깨워 주는 거야',
      '민지야, 엄마가 부탁받아서 오늘은 일찍 깨워 줄게',
      // `그래서`(접속부사)를 연결형 전언 `래서` 로 읽으면 안 된다.
      '민지야, 엄마가 걱정돼서 그래서 깨우는 거야',
      '민지야, 엄마가 심부름 좀 부탁할게. 우유 사다 줄래?',
      // ── 아래는 적대적 검증(754문장)에서 나온 **실측 오탐**이다. 전부 엄마 자신의 말이다.
      // 한 음절 어미가 다른 낱말과 겹치는 것들.
      '민지야, 엄마가 걱정돼서 그랬어. 미안해',
      '민지야, 엄마가 늘 그랬듯이 오늘도 응원할게',
      '민지야, 엄마가 그랬잖아, 아침이 하루를 만든다고',
      '민지야, 엄마가 오늘 하늘 봤는데 정말 파래',
      '민지야, 엄마가 널 사랑한 지 참 오래',
      '민지야, 엄마가 이마에 손을 댔더니 열이 좀 있네',
      '민지야, 엄마가 네 행복을 늘 바라네. 오늘도 좋은 하루 보내',
      '민지야, 엄마가 보니까 키가 많이 자라네. 밥 잘 챙겨 먹어',
      // 과거형 인용은 **엄마가 자기 잔소리를 되짚는 말**과 형태가 같다.
      '민지야, 엄마가 어릴 때부터 그러라고 했잖아? 아침밥은 꼭 먹기',
      // 지시 낱말이 있어도 화자가 대신 하는 행동이 없으면 자기 서술이다.
      '민지야, 엄마가 시켜서 억지로 하지는 마. 네가 하고 싶은 대로 해',
      '민지야, 엄마가 시켜서 하는 게 아니라 네가 하고 싶어서 하는 거야',
      '민지야, 엄마의 심부름 때문에 아침이 바쁘겠다. 얼른 일어나',
      // 관형형 `부탁받은` 은 받은 쪽이 **청자**다.
      '민지야, 엄마한테 부탁받은 우산 꼭 챙겨 가',
      // 대신하는 사람이 **다른 사람**으로 적혀 있으면 화자가 대리인이 아니다.
      '민지야, 엄마를 대신해서 오늘은 아빠가 데리러 갈 거야',
      '민지야, 엄마가 부탁해서 아빠가 깨우러 갈 수도 있어',
      '민지야, 엄마를 대신할 알람은 없으니까 얼른 일어나',
      '민지야, 엄마를 대신해서, 오늘은 아빠가 데리러 갈 거야',
      // ⚠ 계사 `~이란다`/`~ㄹ 거란다` 는 전언 `~란다` 와 정반대다. 실 Vertex 출력이
      // "할머니는 늘 네 편이란다" 를 냈다(2026-08-21 실측).
      '민지야, 엄마는 늘 네 편이란다. 얼른 일어나자',
      '민지야, 엄마는 늘 네 편이랍니다. 얼른 일어나요',
      '민지야, 엄마가 보기엔 오늘도 좋은 하루가 될 거란다. 힘내',
      '민지야, 엄마가 화난 게 아니란다. 걱정 말고 일어나',
      '민지야, 엄마는 네가 행복하기를 바란다. 오늘도 힘내',
      '민지야, 엄마가 네 행복을 바랍니다',
      // 대리 행동 낱말이 화자 자신의 행동일 때는 유출이 아니다.
      '민지야, 엄마가 이따 전화할게. 얼른 일어나',
      '민지야, 엄마가 데리러 갈게. 준비하고 있어',
      // ⚠ 어간이 `라` 로 끝나는 용언은 전언이 아니다 — 바라다·자라다에 더해 `놀라다`.
      '민지야, 엄마가 네 성장에 깜짝 놀라네. 오늘도 화이팅',
      '민지야, 엄마가 놀란다. 얼른 일어나',
      // 계사 `~이라네`/`~ㄹ 거라네`/`아니라네` 도 마찬가지.
      '민지야, 엄마의 마음은 늘 사랑이라네. 힘내',
      '민지야, 엄마가 보기엔 오늘도 좋은 날이라네',
      '민지야, 엄마가 화난 게 아니라네. 걱정 마',
      // ⚠ 맨 과거형 `시켰` 은 **자기 지시를 되짚는 말**과 구별되지 않는다.
      '민지야, 엄마가 시켰잖아, 전화해 줘',
      '민지야, 엄마가 시켰지? 얼른 전화해 줘',
      // ⚠ 같은 낱말이라도 **청자에게 시키는 것**이면 화자의 대리 행동이 아니다.
      '민지야, 엄마가 부탁해서 미안해, 전화해 줘',
      '민지야, 엄마가 부탁해서 미안한데 이따 전화해 줄래?',
      '민지야, 엄마가 부탁해서 전해 줘',
      '민지야, 엄마가 보내서 온 택배 잊지 말고 받아',
    ]) {
      queueContent(geminiText(`{"text":"${line}!"}`));

      const generated = await generateDynamicAlarmTextWithVertex(ENV, {
        mode: 'wake_weather',
        category: 'morning',
        targetLanguage: 'ko',
        dateLabel: '5월 20일 수요일',
        relationshipLabel: '엄마',
        listenerTitle: '민지야',
      });

      expect(generated.provider, line).toBe('vertex');
    }
  });

  // 소괄호 지문은 낭독돼 버려 HARD 로 막는다. 대괄호 태그(저각성 포함)는 벗기고 통과시킨다(2026-09-30).
  it('falls back when Gemini includes a parenthesized stage direction; strips bracket tags instead', async () => {
    queueContent(geminiText('{"text":"(다정하게) 일어나실 시간이에요. 오늘도 화이팅!"}'));
    queueContent(geminiText('{"text":"(다정하게) 일어나실 시간이에요. 오늘도 화이팅!"}'));
    const context = {
      mode: 'wake_weather' as const,
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '손녀',
      weatherSignal: { conditions: [{ kind: 'rain' as const, action: 'umbrella' as const }] },
    };
    const fallback = await generateDynamicAlarmTextWithVertex(ENV, context);
    expect(fallback.provider).toBe('local');
    expect(fallback.tags).toEqual([]);

    queueContent(geminiText('{"text":"[quietly] 할머니, 일어나실 시간이에요. 오늘 비 온대요, 우산 챙기세요!"}'));
    const stripped = await generateDynamicAlarmTextWithVertex(ENV, { ...context, listenerTitle: '할머니' });
    expect(stripped.provider).toBe('vertex');
    expect(stripped.text).not.toContain('[');
  });

  it('falls back when Gemini mentions the internal alarm time or date', async () => {
    queueContent(
      geminiText('{"text":"7시 30분이에요. 5월 20일 수요일이라 비가 올 수 있대요."}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      alarmTimeLabel: '07:30',
      relationshipLabel: '손녀',
      weatherSignal: { conditions: [{ kind: 'rain', action: 'umbrella' }] },
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).not.toContain('7시 30분');
    expect(generated.text).not.toContain('5월 20일');
    expect(generated.text).not.toContain('수요일');
  });

  it('falls back when Gemini mentions the internal alarm time as a Korean 12-hour label', async () => {
    queueContent(
      geminiText('{"text":"할아버지, 오후 5시 30분이에요. 실내에서 가볍게 운동해요."}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      alarmTimeLabel: '17:30',
      relationshipLabel: '손녀',
      listenerTitle: '할아버지',
      weatherSignal: { conditions: [{ kind: 'dust', action: 'mask' }] },
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).not.toContain('오후 5시 30분');
  });

  it('falls back when wake_fortune repeats birth date details', async () => {
    queueContent(
      geminiText(
        '{"text":"일어나실 시간이에요. 5월 19일생이군요. 오늘은 작은 선택에 좋은 기운이 따라요."}',
      ),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_fortune',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '연예인',
      fortuneProfile: 'gender=여성, birth date=1950-05-19, birth time=07:30',
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).toContain('일어나실 시간');
    expect(generated.text).not.toContain('5월 19일');
    expect(generated.text).not.toContain('생년월일');
    expect(generated.text).not.toContain('태어난 시간');
  });
});

describe('deriveAlarmDisplayText', () => {
  it('사용자가 대괄호를 안 치면 맨 앞 자동 delivery 태그를 제거한다', () => {
    expect(deriveAlarmDisplayText('[cheerfully] 좋은 아침이에요', '좋은 아침이에요')).toBe(
      '좋은 아침이에요',
    );
  });

  it('모델이 지시를 어기고 태그를 2개 붙여도 모두 제거한다', () => {
    expect(deriveAlarmDisplayText('[happy] [excited] Good morning', 'good morning')).toBe(
      'Good morning',
    );
  });

  it('문장 중간에 낀 모델 태그도 제거한다', () => {
    expect(deriveAlarmDisplayText('Good [whispers] morning', 'good morning')).toBe('Good morning');
  });

  it('태그 제거 후 남는 이중 공백을 한 칸으로 정리한다', () => {
    expect(deriveAlarmDisplayText('take your  pills', 'take your pills')).toBe('take your pills');
  });

  it('번역 경로에서도 앞 태그만 벗기고 번역 본문은 유지한다', () => {
    expect(deriveAlarmDisplayText('[cheerfully] Good morning', '좋은 아침이에요')).toBe(
      'Good morning',
    );
  });

  it('사용자가 직접 친 대괄호는 그대로 보존한다', () => {
    expect(
      deriveAlarmDisplayText('오늘도 [after lunch] 화이팅', '오늘도 [after lunch] 화이팅'),
    ).toBe('오늘도 [after lunch] 화이팅');
  });

  it('사용자 문구가 대괄호 하나뿐이어도 비우지 않는다', () => {
    expect(deriveAlarmDisplayText('[calm]', '[calm]')).toBe('[calm]');
  });

  // Codex #830: 사용자가 대괄호를 친 번역에는 서버가 ㅋㅋ 를 바꿔 넣은 [laughs] 가 섞인다 — 화면에는 싣지 않는다.
  it('사용자가 대괄호를 친 번역문에서 서버가 넣은 웃음은 벗기고, 사용자가 친 웃음 태그는 친 수만큼 남긴다', () => {
    expect(deriveAlarmDisplayText('[excited] Wake up [laughs], it is 8.', '[excited] 일어나 ㅋㅋ 벌써 8시야')).toBe(
      '[excited] Wake up, it is 8.',
    );
    expect(deriveAlarmDisplayText('[chuckles] Wake up [laughs]', '[chuckles] 일어나 ㅋㅋ')).toBe('[chuckles] Wake up');
    // 같은 언어(친 글 그대로)는 한 글자도 안 바뀐다 — 공백까지.
    expect(deriveAlarmDisplayText('[excited]  일어나  ㅋㅋ', '[excited]  일어나  ㅋㅋ')).toBe('[excited]  일어나  ㅋㅋ');
  });

  it('사용자가 승인 태그와 겹치는 대괄호를 쳐도 삭제하지 않는다', () => {
    expect(deriveAlarmDisplayText('오늘도 [happy]', '오늘도 [happy]')).toBe('오늘도 [happy]');
  });
});

describe('generatePrerenderClipText (사전렌더 톤 적응)', () => {
  it('영문 문구의 정확한 비영문 호칭은 언어 불일치에서 제외한다', async () => {
    queueContent(
      geminiText(JSON.stringify({ text: '할아버지, it is time for your medicine. Please take care.' })),
    );

    const out = await generatePrerenderClipText(ENV, {
      seed: 'Remind the listener to take medicine.',
      relationshipLabel: 'grandchild',
      listenerTitle: '할아버지',
      targetLanguage: 'en',
    });

    expect(out.text).toContain('할아버지');
  });

  it('seed·관계·호칭으로 톤 적응 문구를 만든다 — 돌려주는 것은 글 하나다', async () => {
    queueContent(geminiText(JSON.stringify({ text: '규원아, 약 먹을 시간이야. 물이랑 같이 꼭 챙겨 먹어.' })));
    const out = await generatePrerenderClipText(ENV, {
      seed: '약 먹을 시간이라고 다정하게 알린다.',
      relationshipLabel: '할머니',
      listenerTitle: '규원아',
      targetLanguage: 'ko',
    });
    expect(out).toEqual({ text: '규원아, 약 먹을 시간이야. 물이랑 같이 꼭 챙겨 먹어.' });
    // 프롬프트에 seed 와 호칭이 실린다.
    const body = JSON.stringify(contentRequestBody());
    expect(body).toContain('약 먹을 시간이라고');
    expect(body).toContain('규원아');
  });

  // 대괄호 태그는 벗긴다. 막는 것은 **낭독돼 버리는 소괄호 지문**이다 — `（다정하게）` 는 ElevenLabs 가
  // 태그로 안 읽고 글자로 읽는다.
  it('문구 안에 소괄호 지문이 새면 throw 해서 나쁜 클립을 저장하지 않는다', async () => {
    // ⚠ **세 회차 모두 답을 줘야 한다**(2026-09-21). 이 함수는 3회 재시도한다 — 한 개만
    //   큐에 넣으면 2·3회차는 목이 "큐가 비었다" 로 **던져서**, 마지막 실패가 내용 위반이
    //   아니라 전송 실패가 된다. 예전에는 마지막에 무조건 `AlarmTextPreparationInvalidError`
    //   로 덮어써서 그 어긋남이 가려졌다(ALARMTALK-BACKEND-9 — 이제 원본을 그대로 올린다).
    //   즉 이 테스트는 내내 **엉뚱한 실패**를 검사하고 있었다.
    for (let i = 0; i < 3; i += 1) {
      queueContent(geminiText(JSON.stringify({ text: '(다정하게) 일어나!' })));
    }
    await expect(
      generatePrerenderClipText(ENV, { seed: '깨운다', targetLanguage: 'ko' }),
    ).rejects.toBeInstanceOf(AlarmTextPreparationInvalidError);
  });
});

function sentPromptText(): string {
  return contentRequestBody().contents[0]!.parts[0]!.text;
}

// 직접 입력의 글자 웃음(ㅋㅋ·haha·www)은 합성 글자에서만 `[laughs]` 로 바뀐다(스펙 §9). v4 도 'ㅋㅋㅋ' 를 '크크크' 로
// 읽는다. 우리는 태그를 붙이지 않으므로(2026-09-30) 같은 언어는 Gemini 를 부르지 않고, 웃음은 번역에서만 센다.
describe('직접 입력의 글자 웃음 → [laughs] (§9)', () => {
  const LAUGH_OPTIONS = {
    targetLanguage: 'ko',
    sourceLanguage: 'ko',
    translate: false,
    speakTypedLaughter: true,
  } as const;
  const TO_EN = { ...LAUGH_OPTIONS, targetLanguage: 'en', translate: true } as const;

  it('같은 언어: ㅋㅋ 를 [laughs] 로 바꾸고 Gemini 를 부르지 않는다 — 톤 태그를 붙이지 않는다', async () => {
    const prepared = await prepareAlarmTextWithVertex(ENV, '일어나 ㅋㅋㅋ 벌써 8시야', LAUGH_OPTIONS);
    expect(prepared.text).toBe('일어나 [laughs] 벌써 8시야');
    expect(prepared.tags).toEqual(['laughs']);
    expect(prepared.provider).toBe('local');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('사용자가 대괄호로 친 태그는 그대로 두고 웃음만 바꾼다', async () => {
    expect((await prepareAlarmTextWithVertex(ENV, '[chuckles] 일어나 ㅋㅋ', LAUGH_OPTIONS)).text).toBe(
      '[chuckles] 일어나 [laughs]',
    );
    expect((await prepareAlarmTextWithVertex(ENV, '[excited] 일어나 ㅋㅋㅋ', LAUGH_OPTIONS)).text).toBe(
      '[excited] 일어나 [laughs]',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('Vertex 설정이 없어도 웃음은 소리로 바뀐다', async () => {
    const prepared = await prepareAlarmTextWithVertex(
      { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: '' },
      'おはよう www もう8時だよ',
      { ...LAUGH_OPTIONS, targetLanguage: 'ja', sourceLanguage: 'ja' },
    );
    expect(prepared.text).toBe('おはよう [laughs] もう8時だよ');
  });

  it('웃음만 있는 문구는 바꾸지 않는다 — 태그뿐인 합성 요청이 된다', async () => {
    const prepared = await prepareAlarmTextWithVertex(ENV, 'ㅋㅋㅋ', LAUGH_OPTIONS);
    expect(prepared.text).toBe('ㅋㅋㅋ');
  });

  // Codex #830: 문장부호만 남는 것도 '낭독할 말이 없다' 다.
  it('웃음과 문장부호뿐인 문구도 바꾸지 않는다', () => {
    expect(speakTypedLaughter('ㅋㅋㅋ!')).toBe('ㅋㅋㅋ!');
    expect(speakTypedLaughter('haha…')).toBe('haha…');
    expect(speakTypedLaughter('ㅋㅋ 8시!')).toBe('[laughs] 8시!');
  });

  it('옵션을 켜지 않으면(스톡 문구) 글자를 그대로 둔다', async () => {
    const prepared = await prepareAlarmTextWithVertex(ENV, '[brightly] 하하, 일어나요 ㅋㅋ', {
      targetLanguage: 'ko',
      sourceLanguage: 'ko',
      translate: false,
    });
    expect(prepared.text).toBe('[brightly] 하하, 일어나요 ㅋㅋ');
  });

  it('번역: 모델에게 [laughs] 를 지키라고 하고, 옮겨 쓴 글자 웃음도 소리로 바꾼다', async () => {
    queueContent(geminiText(`{"text":"Wake up haha, it's already 8."}`));
    const prepared = await prepareAlarmTextWithVertex(ENV, '일어나 ㅋㅋ 벌써 8시야', TO_EN);
    const prompt = sentPromptText();
    expect(prompt).toContain('일어나 [laughs] 벌써 8시야');
    expect(prompt).not.toContain('일어나 ㅋㅋ');
    expect(prompt).toContain("every [laughs] already in the message is the user's own laughter");
    expect(prompt).toContain('where it belongs in the translation');
    expect(prepared.translated).toBe(true);
    expect(prepared.text).toBe("Wake up [laughs], it's already 8.");
  });

  it('번역: 사용자가 웃지 않았으면 모델이 넣은 웃음은 지운다 — 우리는 웃음을 더하지 않는다', async () => {
    queueContent(geminiText('{"text":"Wake up, [laughs] you are late haha."}'));
    const prepared = await prepareAlarmTextWithVertex(ENV, '일어나, 늦었어', TO_EN);
    expect(prepared.text).toBe('Wake up, you are late.');
    expect(sentPromptText()).not.toContain("user's own laughter");
  });

  it('번역: 사용자가 여러 번 웃었으면 그 수만큼 남기고 넘치는 웃음은 지운다', async () => {
    queueContent(geminiText('{"text":"Wake up [laughs], it is 8. You are late [laughs]. Hurry [chuckles]!"}'));
    const prepared = await prepareAlarmTextWithVertex(ENV, '일어나 ㅋㅋ 벌써 8시야. 늦었어 ㅎㅎ 서둘러!', TO_EN);
    expect(prepared.text).toBe('Wake up [laughs], it is 8. You are late [laughs]. Hurry!');
  });

  // Codex #830: 번역은 원문 자리를 맞춰 볼 수 없다 — 빠뜨리면 '웃었다' 는 것만이라도 되살린다.
  it('번역이 사용자의 웃음을 빠뜨리면 앞에 한 번 되살린다', async () => {
    queueContent(geminiText('{"text":"Wake up, it is already 8."}'));
    const prepared = await prepareAlarmTextWithVertex(ENV, '일어나 ㅋㅋ 벌써 8시야', TO_EN);
    expect(prepared.text).toBe('[laughs] Wake up, it is already 8.');
  });

  // Codex #830: 모델이 사용자의 웃음 태그를 바꿀 수 있다.
  it('번역: 모델이 바꾼 웃음 태그는 [laughs] 로 맞추고, 사용자가 친 태그는 그대로다', async () => {
    queueContent(geminiText('{"text":"[excited] Wake up [chuckles], it is already 8."}'));
    const prepared = await prepareAlarmTextWithVertex(ENV, '[excited] 일어나 ㅋㅋ 벌써 8시야', TO_EN);
    expect(prepared.text).toBe('[excited] Wake up [laughs], it is already 8.');

    queueContent(geminiText('{"text":"[chuckles] Wake up, it is already 8."}'));
    const own = await prepareAlarmTextWithVertex(ENV, '[chuckles] 일어나 벌써 8시야', TO_EN);
    expect(own.text).toBe('[chuckles] Wake up, it is already 8.');
  });

  // Codex #830: 사용자가 대괄호로 친 웃음 태그는 그대로다 — 되살릴 때도 그 철자로.
  it('번역이 사용자가 대괄호로 친 웃음 태그를 빠뜨리면 그 태그를 그대로 되살린다', async () => {
    queueContent(geminiText('{"text":"Wake up, it is already 8."}'));
    const prepared = await prepareAlarmTextWithVertex(ENV, '[chuckles] 일어나 벌써 8시야', TO_EN);
    expect(prepared.text).toBe('[chuckles] Wake up, it is already 8.');
  });

  // Codex #830: 수만 맞추면 사용자가 친 [chuckles] 가 모델의 [laughs] 로 조용히 바뀐다.
  it('번역이 사용자가 친 웃음 태그를 다른 철자로 바꾸면 그 철자로 되돌린다', async () => {
    queueContent(geminiText('{"text":"[laughs] Wake up, it is already 8."}'));
    const prepared = await prepareAlarmTextWithVertex(ENV, '[chuckles] 일어나 벌써 8시야', TO_EN);
    expect(prepared.text).toBe('[chuckles] Wake up, it is already 8.');
  });

  // Codex #830: 웃음뿐인 번역은 글자로 남아('haha') 그걸 읽는 클립이 '번역 성공' 이 됐다.
  it('원문에 말이 있는데 번역이 웃음뿐이면 empty_spoken 으로 거절한다 — 원문도 웃음뿐이면 그대로 둔다', async () => {
    queueContent(geminiText('{"text":"[cheerfully] haha!"}'));
    await expect(prepareAlarmTextWithVertex(ENV, '일어나 벌써 8시야', TO_EN)).rejects.toMatchObject({
      reason: 'empty_spoken',
    });

    queueContent(geminiText('{"text":"[cheerfully] haha!"}'));
    await expect(prepareAlarmTextWithVertex(ENV, '일어나 ㅋㅋ', TO_EN)).rejects.toMatchObject({
      reason: 'empty_spoken',
    });

    // 원문이 웃음뿐이면 글자 그대로 둔다(태그뿐인 합성 요청을 만들지 않는다). 모델이 붙인 톤은 벗긴다.
    queueContent(geminiText('{"text":"[cheerfully] haha"}'));
    const laughOnly = await prepareAlarmTextWithVertex(ENV, 'ㅋㅋㅋ', TO_EN);
    expect(laughOnly.text).toBe('haha');
  });

  // Codex #830: 사용자의 태그 이름을 통째로 빼 주면 모델이 같은 이름으로 더한 웃음도 빠져 두 번 웃는다.
  it('사용자가 친 웃음 태그는 친 수만큼만 사용자 것이다 — 모델이 같은 이름으로 더한 웃음은 지운다', async () => {
    queueContent(geminiText('{"text":"[chuckles] Wake up, it is already 8 [chuckles]."}'));
    const extra = await prepareAlarmTextWithVertex(ENV, '[chuckles] 일어나 벌써 8시야', TO_EN);
    expect(extra.text).toBe('[chuckles] Wake up, it is already 8.');

    // 사용자가 두 번 쳤으면 두 번까지는 사용자 것이다.
    queueContent(geminiText('{"text":"[chuckles] Wake up. [chuckles] It is already 8 [chuckles]."}'));
    const twice = await prepareAlarmTextWithVertex(ENV, '[chuckles] 일어나. [chuckles] 벌써 8시야', TO_EN);
    expect(twice.text).toBe('[chuckles] Wake up. [chuckles] It is already 8.');
  });

  // Codex #830: 지운 웃음 자리에 공백을 남기면 'Wake up .'·'Hello , now' 가 합성·저장된다.
  it('넘치는 웃음을 지운 자리에는 문장부호 앞 공백을 남기지 않는다', async () => {
    queueContent(geminiText('{"text":"Wake up [laughs], it is already 8 [chuckles]."}'));
    const prepared = await prepareAlarmTextWithVertex(ENV, '일어나 ㅋㅋ 벌써 8시야', TO_EN);
    expect(prepared.text).toBe('Wake up [laughs], it is already 8.');

    queueContent(geminiText('{"text":"Hello [laughs], now go [chuckles]!"}'));
    const own = await prepareAlarmTextWithVertex(ENV, '안녕 이제 가자', TO_EN);
    expect(own.text).toBe('Hello, now go!');
  });
});

// 사전렌더(클론 클립·등록 미리듣기)는 태그 없는 글을 합성한다(2026-09-30). 모델이 태그나 글자 웃음을 내도 벗긴다 —
// 웃음도 태그도 우리가 넣지 않는다. 결은 문장 모양으로만 전한다(스펙 §4-2·§10).
describe('사전렌더 — 태그·웃음 없이 문장만 (§9·§10)', () => {
  const style = { dialect: '', strength: '' as const, register: 'banmal', markers: [], persona: '', childlike: false };
  const fortune = {
    seed: '오늘 운세가 좋다고 가볍게 알리고 일어나자고 한다.',
    relationshipLabel: '남자친구',
    listenerTitle: '자기',
    targetLanguage: 'ko',
  };

  it('모델이 낸 태그·웃음 태그를 전부 벗긴다 — 문장부호 앞에 공백을 남기지 않는다', async () => {
    queueContent(geminiText('{"text":"[playfully] 자기야 [laughs], 오늘 운세 좋대. [cheerfully] 얼른 일어나 보자 [chuckles]!"}'));
    const out = await generatePrerenderClipText(ENV, { ...fortune, speechStyle: { ...style, energy: 'lively' } });
    expect(out).toEqual({ text: '자기야, 오늘 운세 좋대. 얼른 일어나 보자!' });

    // 대괄호에 넣은 글자 웃음·꾸밈말이 붙은 웃음도 태그다.
    queueContent(geminiText('{"text":"[haha loudly] 자기야, [lol] 오늘 운세 좋대. 얼른 일어나 보자."}'));
    const bracketed = await generatePrerenderClipText(ENV, fortune);
    expect(bracketed.text).toBe('자기야, 오늘 운세 좋대. 얼른 일어나 보자.');
  });

  it('모델이 웃음을 글자로 쓰면(ㅋㅋ·haha) 지운다 — TTS 가 글자로 읽는다', async () => {
    queueContent(geminiText('{"text":"자기야 ㅋㅋ 오늘 운세 좋대. 얼른 일어나 보자 haha."}'));
    const out = await generatePrerenderClipText(ENV, fortune);
    expect(out.text).toBe('자기야 오늘 운세 좋대. 얼른 일어나 보자.');
  });

  // Codex #830: 웃음만 남는 줄은 낭독할 말이 없으니 다시 묻는다.
  it('웃음만 있는 줄([playfully] haha!)은 낭독할 말이 없어 거절한다', async () => {
    for (let i = 0; i < 3; i += 1) {
      queueContent(geminiText('{"text":"[playfully] haha!"}'));
    }
    await expect(
      generatePrerenderClipText(ENV, { seed: '가볍게 웃으며 깨운다.', targetLanguage: 'en' }),
    ).rejects.toMatchObject({ reason: 'empty_spoken' });
  });

  it('프롬프트는 태그·웃음을 쓰게 하지 않고, 결은 문장 모양으로 말한다', async () => {
    queueContent(geminiText('{"text":"자기야, 오늘 운세 좋대. 얼른 일어나 보자!"}'));
    await generatePrerenderClipText(ENV, { ...fortune, speechStyle: { ...style, energy: 'lively' } });
    const lively = sentPromptText();
    expect(lively).toContain('WORDS ONLY');
    expect(lively).toContain('short upbeat sentences');
    expect(lively).not.toContain('LAUGHTER:');
    expect(lively).not.toContain('DELIVERY TAGS');
    expect(lively).not.toMatch(/\[(cheerfully|playfully|laughs|warmly|excited)\]/);

    mockFetch.mockClear();
    queueContent(geminiText('{"text":"자기야, 약 먹을 시간이야. 지금 바로 챙겨 먹자."}'));
    await generatePrerenderClipText(ENV, {
      seed: '약 먹을 시간이라고 알리고 지금 바로 챙겨 먹으라고 당부한다.',
      relationshipLabel: '남자친구',
      listenerTitle: '자기',
      targetLanguage: 'ko',
      speechStyle: { ...style, energy: 'calm' },
    });
    const calm = sentPromptText();
    expect(calm).toContain('CALM');
    expect(calm).toContain('few or no exclamation marks');
    expect(calm).toContain('clear, firm nudge');
    expect(calm).not.toMatch(/\[(cheerfully|playfully|laughs|warmly|sincerely|excited)\]/);
    // 시스템 지시도 태그를 요구하지 않는다.
    const system = JSON.stringify((JSON.parse(String(mockFetch.mock.calls.find((c) => String(c[0]) !== TOKEN_URI)?.[1]?.body)) as { systemInstruction?: unknown }).systemInstruction ?? '');
    expect(system).toContain('Write NO');
    expect(system).not.toContain('DELIVERY TAG (ElevenLabs v3)');
  });
});

describe('stripAllTags — 모델이 쓴 글의 태그를 벗긴다', () => {
  it('쉼표가 든 태그·여러 개·문장 가운데 태그를 모두 벗긴다', () => {
    expect(stripAllTags('[measured, deliberate] I am ready.')).toBe('I am ready.');
    expect(stripAllTags('[shouting] 일어나! [laughs] 오늘도 힘내자.')).toBe('일어나! 오늘도 힘내자.');
    expect(stripAllTags('[happy] [excited] Good morning')).toBe('Good morning');
  });

  it('지운 자리에 낱말이 붙거나 문장부호 앞에 공백이 남지 않는다 — 일본어는 붙인다', () => {
    expect(stripAllTags('[warmly] Good[softly]morning')).toBe('Good morning');
    expect(stripAllTags('할머니 [softly]일어나세요')).toBe('할머니 일어나세요');
    expect(stripAllTags('할머니,[softly]일어나세요')).toBe('할머니, 일어나세요');
    expect(stripAllTags('おばあちゃん、[softly]起きて')).toBe('おばあちゃん、起きて');
    expect(stripAllTags('おばあちゃん[softly]起きて')).toBe('おばあちゃん起きて');
    expect(stripAllTags('Wake up[softly]!')).toBe('Wake up!');
    expect(stripAllTags('좋아 [laughs].')).toBe('좋아.');
    expect(stripAllTags('Hello [laughs], now')).toBe('Hello, now');
  });

  it('태그 모양이 아닌 대괄호(한글 지문)는 벗기지 않는다 — 검사가 거절한다', () => {
    expect(stripAllTags('[다정하게] 일어나')).toBe('[다정하게] 일어나');
    expect(stripAllTags('태그 없는 글  그대로')).toBe('태그 없는 글  그대로');
  });
});
