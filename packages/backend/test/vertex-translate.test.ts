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
    expect(generated.text).toContain('강수 확률 70%');
    expect(generated.text).toContain('오늘도 화이팅');
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
    expect(generated.text).toContain('강수 확률 70%');
    expect(generated.text).not.toContain('손녀 목소리');
    expect(generated.text).not.toContain('5월 20일');
    expect(generated.text).not.toContain('서울');
    expect(generated.text).not.toContain('할머니');
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
