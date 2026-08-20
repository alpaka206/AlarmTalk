import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types';
import {
  AlarmTextPreparationInvalidError,
  deriveAlarmDisplayText,
  generateDynamicAlarmTextWithVertex,
  generatePrerenderClipText,
  dropLowArousalTags,
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

    // 문장마다 태그를 다시 앞세운다(끝까지 톤 유지) — 태그 제거 시 원문과 동일해야 한다.
    expect(prepared.text).toContain('[cheerfully] Good morning. [cheerfully] Wake up.');
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

    // ⚠ **모델이 넣은 태그를 그대로 둔다**(2026-08-13 — C안).
    // 예전에는 첫 태그 하나만 채택해 원문을 재조립했다 — 그래서 프롬프트를 아무리 고쳐도
    // 결과는 언제나 '원문 앞에 태그 하나' 였다. 여러 개·중간 배치가 요점이다.
    expect(prepared.text).toBe('[cheerfully] Today is your stage. [excited] Wake up with confidence.');
    expect(prepared.tags).toEqual(['cheerfully', 'excited']);
  });

  // ⚠ **C안(2026-08-13) 회귀 방지.** 오디오 태그는 여러 개·문장 중간·자유 어휘를 쓴다.
  // 예전에는 (1) 프롬프트가 "정확히 하나, 맨 앞에" 로 못 박고 (2) 허용 목록이 감정 형용사
  // 10개뿐이라 목록 밖 태그가 조용히 무태그로 강등되고 (3) 최종 문자열이 '원문 + 태그 하나'
  // 로 재조립돼, 셋 중 하나만 고쳐도 변화가 관측되지 않았다.
  it('허용 목록에 없던 어휘(비언어 소리·발성 방식·태도)도 태그로 살아남는다', async () => {
    const text = '일어나! 오늘도 힘내자.';
    queueContent(
      geminiText(
        '{"text":"[shouting] 일어나! [laughs] 오늘도 힘내자.","tags":["shouting","laughs"]}',
      ),
    );

    const prepared = await prepareAlarmTextWithVertex(ENV, text, {
      targetLanguage: 'ko',
      sourceLanguage: 'ko',
      translate: false,
      autoTag: true,
    });

    expect(prepared.text).toBe('[shouting] 일어나! [laughs] 오늘도 힘내자.');
    expect(prepared.tags).toEqual(['shouting', 'laughs']);
  });

  // 쉼표가 든 두 마디 지시는 정규식에서 **태그로 인식조차 되지 않아** 통째로 폐기됐다.
  it('쉼표가 든 태그도 인식한다', async () => {
    const text = 'I am ready.';
    queueContent(
      geminiText('{"text":"[measured, deliberate] I am ready.","tags":["measured, deliberate"]}'),
    );

    const prepared = await prepareAlarmTextWithVertex(ENV, text, {
      targetLanguage: 'en',
      sourceLanguage: 'en',
      translate: false,
      autoTag: true,
    });

    expect(prepared.text).toContain('[measured, deliberate]');
  });

  // ⚠ **저각성 차단은 유지한다**(C안의 단서). 천천히 말하는 것과 졸리게 말하는 것은 다르다.
  it('속도 지시는 허용하고 저각성 지시는 깨우는 경로에서 막는다', async () => {
    expect(dropLowArousalTags('[measured, deliberate] 일어나!')).toBe(
      '[measured, deliberate] 일어나!',
    );
    expect(dropLowArousalTags('[quietly] 일어나!')).toBe('일어나!');
    expect(dropLowArousalTags('[shouting] 일어나! [whispers] 지금.')).toBe(
      '[shouting] 일어나! 지금.',
    );
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

  // ⚠ 호칭(listener_title)은 **선택 입력**이라 비어 있는 경우가 흔하다. 그때 가족 호칭을
  // 전부 막으면 아이 목소리가 부모를 부를 수가 없다 — 실제로 관계 '아들' 로 생성한 6번 중
  // 4번이 "엄마," 를 썼다는 이유로 거절됐다(2026-08-20 실측). 목소리가 아들/딸이면 듣는
  // 사람은 부모이므로 엄마·아빠는 정답이다.
  it('lets the voice address the listener by the relationship counterpart title', async () => {
    queueContent(geminiText('{"text":"엄마, 일어나! 오늘도 좋은 하루 보내."}'));

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '아들',
    });

    expect(generated.provider).toBe('vertex');
    expect(generated.text).toContain('엄마');
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
    for (const leak of ['엄마처럼 챙겨 줄게', '오늘은 엄마 대신 깨워 줄게']) {
      queueContent(geminiText(`{"text":"민지야, ${leak}. 얼른 일어나자!"}`));

      const generated = await generateDynamicAlarmTextWithVertex(ENV, {
        mode: 'wake_weather',
        category: 'morning',
        targetLanguage: 'ko',
        dateLabel: '5월 20일 수요일',
        relationshipLabel: '엄마',
        listenerTitle: '민지야',
      });

      expect(generated.provider).toBe('local');
    }
  });

  // ⚠ **대괄호 태그는 이제 정상이다**(2026-08-13 — C안). 막는 것은 소괄호·전각괄호 지문과
  // 저각성 지시뿐이다. 여기서는 저각성(`[quietly]`)으로 실패를 확인한다.
  it('falls back when Gemini includes stage directions or low-arousal tags', async () => {
    queueContent(
      geminiText('{"text":"[quietly] 일어나실 시간이에요. 오늘도 화이팅!"}'),
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

  it('사용자가 승인 태그와 겹치는 대괄호를 쳐도 삭제하지 않는다', () => {
    expect(deriveAlarmDisplayText('오늘도 [happy]', '오늘도 [happy]')).toBe('오늘도 [happy]');
  });
});

describe('generatePrerenderClipText (사전렌더 톤 적응)', () => {
  it('영문 문구의 정확한 비영문 호칭은 언어 불일치에서 제외한다', async () => {
    queueContent(
      geminiText(
        JSON.stringify({ text: '할아버지, it is time for your medicine. Please take care.', tag: 'cheerfully' }),
      ),
    );

    const out = await generatePrerenderClipText(ENV, {
      seed: 'Remind the listener to take medicine.',
      relationshipLabel: 'grandchild',
      listenerTitle: '할아버지',
      targetLanguage: 'en',
      defaultTag: 'cheerfully',
    });

    expect(out.text).toContain('할아버지');
  });

  it('seed·관계·호칭으로 톤 적응 문구를 만들고 승인 태그를 돌려준다', async () => {
    queueContent(
      geminiText(
        JSON.stringify({ text: '규원아, 약 먹을 시간이야. 물이랑 같이 꼭 챙겨 먹어.', tag: 'cheerfully' }),
      ),
    );
    const out = await generatePrerenderClipText(ENV, {
      seed: '약 먹을 시간이라고 다정하게 알린다.',
      relationshipLabel: '할머니',
      listenerTitle: '규원아',
      targetLanguage: 'ko',
      defaultTag: 'cheerfully',
    });
    expect(out.text).toContain('약 먹을 시간');
    expect(out.tag).toBe('cheerfully');
    // 프롬프트에 seed 와 호칭이 실린다.
    const body = JSON.stringify(contentRequestBody());
    expect(body).toContain('약 먹을 시간이라고');
    expect(body).toContain('규원아');
  });

  it('모델이 태그를 비우면 카테고리 기본 태그로 채운다', async () => {
    queueContent(geminiText(JSON.stringify({ text: '오늘 비 온대. 나갈 때 우산 꼭 챙겨.', tag: '' })));
    const out = await generatePrerenderClipText(ENV, {
      seed: '비 온다고 알리고 우산 챙기라고.',
      targetLanguage: 'ko',
      defaultTag: 'cheerfully',
    });
    expect(out.tag).toBe('cheerfully');
  });

  // ⚠ 대괄호 태그는 이제 정상이다(C안). 막는 것은 **낭독돼 버리는 소괄호 지문**과
  // 저각성 지시뿐이다 — `（다정하게）` 는 ElevenLabs 가 태그로 안 읽고 글자로 읽는다.
  it('문구 안에 소괄호 지문이나 저각성 지시가 새면 throw 해서 나쁜 클립을 저장하지 않는다', async () => {
    queueContent(geminiText(JSON.stringify({ text: '(다정하게) 일어나!', tag: '' })));
    await expect(
      generatePrerenderClipText(ENV, { seed: '깨운다', targetLanguage: 'ko' }),
    ).rejects.toBeInstanceOf(AlarmTextPreparationInvalidError);
  });
});
