import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types';
import {
  AlarmTextPreparationInvalidError,
  generateDynamicAlarmTextWithVertex,
  prepareAlarmTextWithVertex,
} from '../src/lib/vertex-translate';

const mockFetch = vi.fn();

const ENV: Env = {
  PERSO_API_KEY: 'x',
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  GOOGLE_VERTEX_API_KEY: 'gemini-key',
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

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

describe('prepareAlarmTextWithVertex', () => {
  it('falls back to local tagging when Gemini returns only JSON helper text', async () => {
    mockFetch.mockResolvedValueOnce(geminiText('Here Is the json requested:'));

    const prepared = await prepareAlarmTextWithVertex(ENV, 'Good morning. Wake up.', {
      targetLanguage: 'en',
      sourceLanguage: 'en',
      translate: false,
      autoTag: true,
    });

    expect(prepared.text).toContain('Good morning. Wake up.');
    expect(prepared.text).not.toContain('json requested');
    expect(prepared.tags).toEqual(['warmly']);
  });

  it('parses JSON even when Gemini adds a short preamble', async () => {
    mockFetch.mockResolvedValueOnce(
      geminiText('Here is the JSON requested:\n{"text":"[warmly] Hello","tags":["warmly"]}'),
    );

    const prepared = await prepareAlarmTextWithVertex(ENV, 'Hello', {
      targetLanguage: 'en',
      sourceLanguage: 'en',
      translate: false,
      autoTag: true,
    });

    expect(prepared.text).toBe('[warmly] Hello');
    expect(prepared.tags).toEqual(['warmly']);
  });

  it('keeps same-language auto-tagging to one leading tag without changing the text', async () => {
    const text = 'Today is your stage. Wake up with confidence.';
    mockFetch.mockResolvedValueOnce(
      geminiText(
        '{"text":"[warmly] Today is your stage. [brightly] Wake up with confidence.","tags":["warmly","brightly"]}',
      ),
    );

    const prepared = await prepareAlarmTextWithVertex(ENV, text, {
      targetLanguage: 'en',
      sourceLanguage: 'en',
      translate: false,
      autoTag: true,
    });

    expect(prepared.text).toBe(`[warmly] ${text}`);
    expect(prepared.tags).toEqual(['warmly']);
  });

  it('falls back to local tagging when same-language auto-tagging rewrites the text', async () => {
    const text = 'Today is your stage. Wake up with confidence.';
    mockFetch.mockResolvedValueOnce(
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

    expect(prepared.text).toBe(`[warmly] ${text}`);
    expect(prepared.tags).toEqual(['warmly']);
  });

  it('does not synthesize malformed translation output', async () => {
    mockFetch.mockResolvedValueOnce(geminiText('Here Is the json requested:'));

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
    mockFetch.mockResolvedValueOnce(
      geminiText('{"text":"[gentle] 오늘도 화이팅","tags":["gentle"]}'),
    );

    const prepared = await prepareAlarmTextWithVertex(ENV, '오늘도 화이팅', {
      targetLanguage: 'ko',
      sourceLanguage: 'ko',
      translate: false,
      autoTag: true,
    });

    expect(prepared.text).toBe('[gentle] 오늘도 화이팅');
    expect(prepared.tags).toEqual(['gentle']);
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
    mockFetch.mockResolvedValueOnce(
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
  it('falls back to readable dynamic text when Gemini returns helper text only', async () => {
    mockFetch.mockResolvedValueOnce(geminiText('Here Is the json requested:'));

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '손녀',
      weatherSummary: '최저 12도, 최고 19도, 강수 확률 70%, 우산을 챙기면 좋아요',
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
    mockFetch.mockResolvedValueOnce(
      geminiText('{"text":"할머니, 5월 20일 수요일이에요. 서울엔 비가 오니 우산 챙기세요."}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '손녀',
      weatherSummary: '최저 12도, 최고 19도, 강수 확률 70%, 우산을 챙기면 좋아요',
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
    mockFetch.mockResolvedValueOnce(
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
      weatherSummary: '비가 올 수 있어요. 우산 꼭 챙기세요',
    });

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    const prompt = requestBody.contents[0].parts[0].text;
    expect(generated.provider).toBe('gemini-api-key');
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
    mockFetch.mockResolvedValueOnce(
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

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    const prompt = requestBody.contents[0].parts[0].text;
    expect(generated.provider).toBe('gemini-api-key');
    expect(generated.text).toContain('할머니, 일어나실 시간이에요');
    expect(generated.text).not.toContain('할머니, 일어날 시간이에요');
    expect(prompt).toContain('Speaker is a grandchild speaking to a grandparent');
    expect(prompt).toContain('never write casual elder-address phrases like "할머니, 일어날 시간이에요"');
  });

  it('keeps sibling bedtime messages in natural banmal', async () => {
    mockFetch.mockResolvedValueOnce(
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

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    const prompt = requestBody.contents[0].parts[0].text;
    expect(generated.provider).toBe('gemini-api-key');
    expect(generated.text).toBe('누나, 잘 시간이야. 휴대폰 내려놓고 얼른 자.');
    expect(prompt).toContain('Create a sibling-style bedtime message in natural 반말');
    expect(prompt).toContain('누나, 잘 시간이야. 휴대폰 내려놓고 얼른 자.');
  });

  it('prompts romantic partner cases with warm tone and flexible weather relay wording', async () => {
    mockFetch.mockResolvedValueOnce(
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
      weatherSummary: '비가 올 수 있어요. 우산 꼭 챙기세요',
    });

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    const prompt = requestBody.contents[0].parts[0].text;
    expect(generated.provider).toBe('gemini-api-key');
    expect(prompt).toContain('Romantic partner/spouse tone');
    expect(prompt).toContain('heart-fluttering');
    expect(prompt).toContain('Avoid robotic connector phrases like "예보 보니까"');
    expect(prompt).toContain('연인·남자친구·여자친구·아내·남편·배우자');
  });

  it('uses warmer romantic fallback copy when Gemini is unavailable', async () => {
    const generated = await generateDynamicAlarmTextWithVertex(
      {
        ...ENV,
        GOOGLE_VERTEX_API_KEY: undefined,
        GOOGLE_VERTEX_CREDENTIALS_JSON: undefined,
      },
      {
        mode: 'wake_weather',
        category: 'morning',
        targetLanguage: 'ko',
        dateLabel: '5월 20일 수요일',
        relationshipLabel: '여자친구',
        listenerTitle: '자기야',
        weatherSummary: '비가 올 수 있어요. 우산 꼭 챙기세요',
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
        GOOGLE_VERTEX_API_KEY: undefined,
        GOOGLE_VERTEX_CREDENTIALS_JSON: undefined,
      },
      {
        mode: 'wake_weather',
        category: 'morning',
        targetLanguage: 'ko',
        dateLabel: '5월 20일 수요일',
        relationshipLabel: '아내',
        listenerTitle: '여보',
        weatherSummary: '날씨가 좋아요. 잠깐 산책 가기에도 딱이에요',
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
    mockFetch.mockResolvedValueOnce(
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
    mockFetch.mockResolvedValueOnce(
      geminiText('{"text":"할머니, 손녀 목소리로 전해요. 일어나실 시간이에요."}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '손녀',
      listenerTitle: '할머니',
      weatherSummary: '비가 올 수 있어요. 우산 꼭 챙기세요',
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).toContain('할머니');
    expect(generated.text).not.toContain('손녀 목소리');
  });

  it('falls back when Gemini writes as the speaker relationship', async () => {
    mockFetch.mockResolvedValueOnce(
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
    mockFetch.mockResolvedValueOnce(
      geminiText('{"text":"[warmly] 일어나실 시간이에요. 오늘도 화이팅!"}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      relationshipLabel: '손녀',
      weatherSummary: '비가 올 수 있어요. 우산 꼭 챙기세요',
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).not.toContain('[warmly]');
  });

  it('falls back when Gemini mentions the internal alarm time or date', async () => {
    mockFetch.mockResolvedValueOnce(
      geminiText('{"text":"7시 30분이에요. 5월 20일 수요일이라 비가 올 수 있대요."}'),
    );

    const generated = await generateDynamicAlarmTextWithVertex(ENV, {
      mode: 'wake_weather',
      category: 'morning',
      targetLanguage: 'ko',
      dateLabel: '5월 20일 수요일',
      alarmTimeLabel: '07:30',
      relationshipLabel: '손녀',
      weatherSummary: '비가 올 수 있어요. 우산 꼭 챙기세요',
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).not.toContain('7시 30분');
    expect(generated.text).not.toContain('5월 20일');
    expect(generated.text).not.toContain('수요일');
  });

  it('falls back when Gemini mentions the internal alarm time as a Korean 12-hour label', async () => {
    mockFetch.mockResolvedValueOnce(
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
      weatherSummary: '미세먼지가 많아요. 외출할 땐 마스크 챙기세요',
    });

    expect(generated.provider).toBe('local');
    expect(generated.text).not.toContain('오후 5시 30분');
  });

  it('falls back when wake_fortune repeats birth date details', async () => {
    mockFetch.mockResolvedValueOnce(
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
