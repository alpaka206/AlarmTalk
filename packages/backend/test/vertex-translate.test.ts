import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types';
import {
  AlarmTextPreparationInvalidError,
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
});
