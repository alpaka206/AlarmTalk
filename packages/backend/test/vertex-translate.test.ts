import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types';
import {
  AlarmTextPreparationInvalidError,
  deriveAlarmDisplayText,
  generateDynamicAlarmTextWithVertex,
  prepareAlarmTextWithVertex,
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

describe('prepareAlarmTextWithVertex', () => {
  it('falls back to local tagging when Gemini returns only JSON helper text', async () => {
    queueContent(geminiText('Here Is the json requested:'));

    const prepared = await prepareAlarmTextWithVertex(ENV, 'Good morning. Wake up.', {
      targetLanguage: 'en',
      sourceLanguage: 'en',
      translate: false,
      autoTag: true,
    });

    expect(prepared.text).toContain('Good morning. Wake up.');
    expect(prepared.text).not.toContain('json requested');
    // 신 allowlist 기준 로컬 기본 태그(구 [warmly] 폐기).
    expect(prepared.tags).toEqual(['cheerfully']);
  });

  it('parses JSON even when Gemini adds a short preamble', async () => {
    queueContent(
      geminiText('Here is the JSON requested:\n{"text":"[cheerfully] Hello","tags":["cheerfully"]}'),
    );

    const prepared = await prepareAlarmTextWithVertex(ENV, 'Hello', {
      targetLanguage: 'en',
      sourceLanguage: 'en',
      translate: false,
      autoTag: true,
    });

    // 큐레이트 세트에 있는 태그는 그대로 선두에 유지된다.
    expect(prepared.text).toBe('[cheerfully] Hello');
    expect(prepared.tags).toEqual(['cheerfully']);
  });

  it('keeps same-language auto-tagging to one leading tag without changing the text', async () => {
    const text = 'Today is your stage. Wake up with confidence.';
    queueContent(
      geminiText(
        '{"text":"[cheerfully] Today is your stage. [excited] Wake up with confidence.","tags":["cheerfully","excited"]}',
      ),
    );

    const prepared = await prepareAlarmTextWithVertex(ENV, text, {
      targetLanguage: 'en',
      sourceLanguage: 'en',
      translate: false,
      autoTag: true,
    });

    // 승인 태그가 여러 개여도 첫 번째만 선두에 남긴다(텍스트는 불변).
    expect(prepared.text).toBe(`[cheerfully] ${text}`);
    expect(prepared.tags).toEqual(['cheerfully']);
  });

  it('falls back to local tagging when same-language auto-tagging rewrites the text', async () => {
    const text = 'Today is your stage. Wake up with confidence.';
    queueContent(
      geminiText(
        '{"text":"[brightly] Today is your stage. Fans are waiting, so hurry out.","tags":["brightly"]}',
      ),
    );

    const prepared = await prepareAlarmTextWithVertex(ENV, text, {
      targetLanguage: 'en',
      sourceLanguage: 'en',
      translate: false,
      autoTag: true,
    });

    // 텍스트가 변형돼 로컬 폴백 → 신 기본 태그 cheerfully.
    expect(prepared.text).toBe(`[cheerfully] ${text}`);
    expect(prepared.tags).toEqual(['cheerfully']);
  });

  it('does not synthesize malformed translation output', async () => {
    queueContent(geminiText('Here Is the json requested:'));

    await expect(
      prepareAlarmTextWithVertex(ENV, '좋은 아침이에요', {
        targetLanguage: 'en',
        sourceLanguage: 'ko',
        translate: true,
        autoTag: true,
      }),
    ).rejects.toBeInstanceOf(AlarmTextPreparationInvalidError);
  });

  it('tags plain user-typed Korean text when autoTag is true', async () => {
    queueContent(
      geminiText('{"text":"[cheerfully] 오늘도 화이팅","tags":["cheerfully"]}'),
    );

    const prepared = await prepareAlarmTextWithVertex(ENV, '오늘도 화이팅', {
      targetLanguage: 'ko',
      sourceLanguage: 'ko',
      translate: false,
      autoTag: true,
    });

    expect(prepared.text).toBe('[cheerfully] 오늘도 화이팅');
    expect(prepared.tags).toEqual(['cheerfully']);
    expect(prepared.provider).not.toBe('local');
  });

  it('skips Gemini when user already typed a delivery tag', async () => {
    const prepared = await prepareAlarmTextWithVertex(ENV, '[warmly] 좋은 아침', {
      targetLanguage: 'ko',
      sourceLanguage: 'ko',
      translate: false,
      autoTag: true,
    });

    expect(prepared.text).toBe('[warmly] 좋은 아침');
    expect(prepared.tags).toEqual(['warmly']);
    expect(prepared.provider).toBe('local');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('tags translated output when both translate and autoTag are true', async () => {
    queueContent(
      geminiText('{"text":"[brightly] Good morning!","tags":["brightly"]}'),
    );

    const prepared = await prepareAlarmTextWithVertex(ENV, '좋은 아침이에요', {
      targetLanguage: 'en',
      sourceLanguage: 'ko',
      translate: true,
      autoTag: true,
    });

    expect(prepared.text).toBe('[brightly] Good morning!');
    expect(prepared.translated).toBe(true);
    expect(prepared.tags).toEqual(['brightly']);
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

  it('keeps sibling bedtime messages in natural banmal', async () => {
    queueContent(
      geminiText('{"text":"누나, 벌써 잘 시간이에요. 휴대폰은 내려놓고 편안하게 쉬어요."}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'sleep',
      category: 'sleep',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      alarmTimeLabel: '23:00',
      relationshipLabel: '형제·자매',
      listenerTitle: '누나',
    });

    const requestBody = contentRequestBody();
    const prompt = requestBody.contents[0].parts[0].text;
    expect(generated.provider).toBe('vertex');
    expect(generated.text).toBe('누나, 잘 시간이야. 휴대폰 내려놓고 얼른 자.');
    expect(prompt).toContain('Create a sibling-style bedtime message in natural 반말');
    expect(prompt).toContain('누나, 잘 시간이야. 휴대폰 내려놓고 얼른 자.');
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

  it('falls back when Gemini writes as the speaker relationship', async () => {
    queueContent(
      geminiText('{"text":"민지야, 실내에서 가볍게 운동하자. 엄마가 응원할게!"}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'exercise',
      category: 'exercise',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '엄마',
      listenerTitle: '민지야',
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).toContain('민지야');
    expect(generated.text).not.toContain('엄마가');
  });

  it('falls back when Gemini includes delivery tags or stage directions', async () => {
    queueContent(
      geminiText('{"text":"[warmly] 일어나실 시간이에요. 오늘도 화이팅!"}'),
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
    expect(generated.text).not.toContain('[warmly]');
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
      mode: 'exercise',
      category: 'exercise',
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

  it('사용자가 승인 태그와 겹치는 대괄호를 쳐도 삭제하지 않는다', () => {
    expect(deriveAlarmDisplayText('오늘도 [happy]', '오늘도 [happy]')).toBe('오늘도 [happy]');
  });
});
