import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import eventRoutes, { vocative } from '../src/routes/event';

const PERSO_ENV = {
  PERSO_API_KEY: 'k',
  PERSO_TTS_URL: 'https://perso.example/tts',
  PERSO_VOICE_IDS: JSON.stringify({ winter: 'voice-w' }),
};

/** 최소 R2 흉내 — get/put 만. */
function fakeBucket() {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    store,
    bucket: {
      get: vi.fn(async (key: string) => {
        const hit = store.get(key);
        if (!hit) return null;
        return { body: hit.bytes, httpMetadata: { contentType: hit.contentType } };
      }),
      put: vi.fn(async (key: string, bytes: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
        store.set(key, { bytes, contentType: opts?.httpMetadata?.contentType });
      }),
    },
  };
}

function buildApp(env: Record<string, unknown>) {
  const app = new Hono<AppEnv>();
  app.route('/event', eventRoutes);
  const waited: Promise<unknown>[] = [];
  const request = (path: string, init?: RequestInit) =>
    app.request(path, init, env, {
      waitUntil: (p: Promise<unknown>) => waited.push(p),
      passThroughOnException: () => {},
    } as never);
  return { request, waited };
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('vocative — 부르는 꼴', () => {
  it('한국어: 받침 있으면 아, 없으면 야', () => {
    expect(vocative('지민', 'ko')).toBe('지민아');
    expect(vocative('하나', 'ko')).toBe('하나야');
    expect(vocative('하늘', 'ko')).toBe('하늘아');
  });
  it('마지막 글자가 한글이 아니면 조사를 붙이지 않는다', () => {
    expect(vocative('Emily', 'ko')).toBe('Emily');
    expect(vocative('지민2', 'ko')).toBe('지민2');
  });
  it('영어·일본어는 이름 그대로', () => {
    expect(vocative('지민', 'en')).toBe('지민');
    expect(vocative('さくら', 'ja')).toBe('さくら');
  });
});

describe('랜딩 이벤트 이름 클립 (POST /event/:id/name-clip)', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  beforeEach(() => {
    mockDB.reset();
    fetchSpy.mockReset();
  });
  afterEach(() => {
    fetchSpy.mockReset();
  });

  it('Perso 설정이 없으면 503 — 외부 호출 없이 닫힌다', async () => {
    const { request } = buildApp({});
    const res = await request('/event/1/name-clip', post({ celebrity: 'winter', name: '지민', locale: 'ko' }));
    expect(res.status).toBe(503);
    expect((await res.json()).error_code).toBe('PERSO_NOT_CONFIGURED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('목소리 id 가 없는 인물도 503', async () => {
    const { request } = buildApp(PERSO_ENV);
    const res = await request('/event/1/name-clip', post({ celebrity: 'nanami', name: '지민', locale: 'ko' }));
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['이름 없음', { celebrity: 'winter', name: '', locale: 'ko' }],
    ['제어문자만', { celebrity: 'winter', name: '​', locale: 'ko' }],
    ['너무 긴 이름', { celebrity: 'winter', name: '가'.repeat(21), locale: 'ko' }],
    ['모르는 언어', { celebrity: 'winter', name: '지민', locale: 'fr' }],
    ['슬러그 아닌 인물', { celebrity: 'Win ter', name: '지민', locale: 'ko' }],
  ])('잘못된 입력은 400 — %s', async (_label, body) => {
    const { request } = buildApp(PERSO_ENV);
    const res = await request('/event/1/name-clip', post(body));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('처음 보는 이름은 Perso 에 부르는 꼴로 요청하고, 오디오를 돌려주며, R2 에 넣어 둔다', async () => {
    const audio = new Uint8Array([1, 2, 3, 4]);
    fetchSpy.mockResolvedValueOnce(
      new Response(audio, { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    );
    const r2 = fakeBucket();
    const { request, waited } = buildApp({ ...PERSO_ENV, VOICE_BUCKET: r2.bucket });
    const res = await request('/event/1/name-clip', post({ celebrity: 'winter', name: ' 지민 ', locale: 'ko' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('x-name-clip-cache')).toBe('miss');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(audio);

    // Perso 에는 조사가 붙은 글자와 그 인물의 목소리 id 가 간다.
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(PERSO_ENV.PERSO_TTS_URL);
    expect(JSON.parse(String(init!.body))).toEqual({ text: '지민아', voice_id: 'voice-w', language: 'ko' });
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer k');

    await Promise.all(waited);
    expect(r2.bucket.put).toHaveBeenCalledTimes(1);
    const key = r2.bucket.put.mock.calls[0]![0] as string;
    // 키에 이름 원문이 들어가지 않는다(해시).
    expect(key).toMatch(/^event\/1\/name-clips\/winter\/ko\/[0-9a-f]{64}\.mp3$/);
    expect(key).not.toContain('지민');
  });

  it('같은 (인물, 언어, 이름)은 R2 에서 주고 Perso 를 부르지 않는다', async () => {
    const r2 = fakeBucket();
    const { request } = buildApp({ ...PERSO_ENV, VOICE_BUCKET: r2.bucket });
    // 앞 테스트와 같은 키를 직접 만들지 않고, 한 번 miss 로 채운 뒤 두 번째 요청으로 확인한다.
    fetchSpy.mockResolvedValueOnce(
      new Response(new Uint8Array([9]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    );
    const first = buildApp({ ...PERSO_ENV, VOICE_BUCKET: r2.bucket });
    await first.request('/event/1/name-clip', post({ celebrity: 'winter', name: '지민', locale: 'ko' }));
    await Promise.all(first.waited);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const res = await request('/event/1/name-clip', post({ celebrity: 'winter', name: '지민', locale: 'ko' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-name-clip-cache')).toBe('hit');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9]));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('Perso 가 실패하면 502 — 빈 파일을 캐시하지 않는다', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const r2 = fakeBucket();
    const { request } = buildApp({ ...PERSO_ENV, VOICE_BUCKET: r2.bucket });
    const res = await request('/event/1/name-clip', post({ celebrity: 'winter', name: '지민', locale: 'ko' }));
    expect(res.status).toBe(502);
    expect((await res.json()).error_code).toBe('PERSO_FAILED');
    expect(r2.bucket.put).not.toHaveBeenCalled();
  });

  it('버킷이 없으면 캐시 없이 매번 만든다', async () => {
    fetchSpy.mockResolvedValue(
      new Response(new Uint8Array([5]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    );
    const { request } = buildApp(PERSO_ENV);
    const res = await request('/event/1/name-clip', post({ celebrity: 'winter', name: 'Emily', locale: 'en' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-name-clip-cache')).toBe('none');
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body)).text).toBe('Emily');
  });
});
