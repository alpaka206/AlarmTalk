import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB } from './helpers';
import {
  EVENT_MESSAGES,
  EVENT_VOICES,
  pickSlot,
  renderMessage,
  sanitizeEventName,
  stripEmotionTags,
  vocative,
} from '../src/lib/event-voices';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import eventRoutes from '../src/routes/event';

const WINTER_KO = EVENT_VOICES['1']!.winter!.ko!;
// 보이지 않는 글자는 코드포인트로 적는다 — 소스에 그대로 실리면 편집기·리뷰 도구에서 안 보인다.
const ZERO_WIDTH = String.fromCodePoint(0x200b);
const BELL = String.fromCodePoint(0x07);

/** Perso 저장소가 주는 mp3 흉내 — 프레임 동기(0xFFFB)로 시작하는 4KB. */
const MP3_BYTES = (() => {
  const b = new Uint8Array(4096);
  b[0] = 0xff;
  b[1] = 0xfb;
  for (let i = 2; i < b.length; i++) b[i] = i & 0xff;
  return b;
})();

/** 최소 R2 흉내 — head/get/put. get 은 `{offset,length}` range 만 흉내 내고 범위 밖이면 R2 처럼 던진다. */
function fakeBucket() {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket = {
    head: vi.fn(async (key: string) =>
      store.has(key) ? { key, size: store.get(key)!.bytes.byteLength } : null,
    ),
    get: vi.fn(async (key: string, opts?: { range?: { offset: number; length?: number } }) => {
      const hit = store.get(key);
      if (!hit) return null;
      const size = hit.bytes.byteLength;
      let body = hit.bytes;
      let range: { offset: number; length: number } | undefined;
      if (opts?.range) {
        const { offset } = opts.range;
        if (offset >= size) throw new Error('Range not satisfiable');
        const length = Math.min(opts.range.length ?? size - offset, size - offset);
        body = hit.bytes.subarray(offset, offset + length);
        range = { offset, length };
      }
      return {
        key,
        size,
        httpEtag: '"etag"',
        range,
        body,
        writeHttpMetadata: (h: Headers) => {
          if (hit.contentType) h.set('content-type', hit.contentType);
        },
      };
    }),
    put: vi.fn(
      async (key: string, bytes: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
        store.set(key, { bytes, contentType: opts?.httpMetadata?.contentType });
      },
    ),
  };
  return { store, bucket };
}

function buildApp(env: Record<string, unknown>) {
  const app = new Hono<AppEnv>();
  app.route('/event', eventRoutes);
  return (path: string, init?: RequestInit) =>
    app.request(path, init, env, { waitUntil: () => {}, passThroughOnException: () => {} } as never);
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Perso 흉내: match-rewrite 가 슬롯의 글자를 저장하고 generate-audio 가 저장된 글자를 읽는다
 * (2026-09-16 실측과 같은 순서). 파일 경로는 실제처럼 생성마다 새 이름이다. `overwriteOnGenerate` 를
 * 주면 생성 직전에 남이 슬롯을 덮어쓴 상황을, `media` 를 주면 저장소가 돌려주는 몸통을 바꾼다.
 */
function fakePerso(opts: { overwriteOnGenerate?: Set<number>; media?: Uint8Array } = {}) {
  const stored = new Map<string, string>();
  const calls: string[] = [];
  let generation = 0;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const m = url.match(
      /\/project\/(\d+)\/audio-sentence\/(\d+)(?:\/(match-rewrite|generate-audio))?$/,
    );
    if (m) {
      const slot = `${m[1]}/${m[2]}`;
      const action = m[3] ?? 'translate';
      calls.push(`${init?.method} ${slot} ${action}`);
      const body = JSON.parse(String(init?.body)) as { targetText: string };
      if (action === 'match-rewrite') {
        stored.set(slot, body.targetText);
        return Response.json({
          result: { matchingRate: { level: 1, levelType: 'Low' }, rewrite: null },
        });
      }
      if (action === 'generate-audio') {
        if (opts.overwriteOnGenerate?.has(Number(m[2]))) stored.set(slot, '남의 글자');
        return Response.json({
          result: {
            scriptSeq: Number(m[2]),
            translatedText: stored.get(slot),
            generateAudioFilePath: `/perso-storage/p-${m[1]}/윈터 클립_${m[2]}_${++generation}.mp3`,
          },
        });
      }
    }
    if (url.startsWith('https://portal-media.perso.ai/')) {
      calls.push(`GET media ${decodeURI(url.slice('https://portal-media.perso.ai'.length))}`);
      return new Response(opts.media ?? MP3_BYTES, {
        headers: { 'content-type': 'application/octet-stream' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return { stored, calls, fetchSpy };
}

describe('event-voices — 문장·부르는 꼴·슬롯', () => {
  it('vocative: 한국어는 받침에 따라 아/야, 한글이 아니면 그대로, 영어·일본어는 그대로', () => {
    expect(vocative('지민', 'ko')).toBe('지민아');
    expect(vocative('하나', 'ko')).toBe('하나야');
    expect(vocative('Emily', 'ko')).toBe('Emily');
    expect(vocative('지민', 'en')).toBe('지민');
    expect(vocative('さくら', 'ja')).toBe('さくら');
  });

  it('renderMessage: 이름이 들어가고, 화면 글자에는 감정 태그가 없다', () => {
    const m = renderMessage('birthday', 'ko', '지민');
    expect(m.spoken).toBe('지민아');
    expect(m.tts).toContain('[warm, relaxed] 지민아, [gently cheerful] 생일');
    expect(m.display.startsWith('지민아, 생일 너무너무 축하해!')).toBe(true);
    expect(m.display).not.toMatch(/\[/);
    expect(m.display.split('\n').length).toBe(4);
    expect(renderMessage('birthday', 'en', '지민').display).toContain('Hey, 지민. Happy birthday!');
  });

  it('renderMessage: 이름의 $ 패턴을 치환 문법으로 읽지 않는다', () => {
    const m = renderMessage('birthday', 'ko', "$'$&");
    expect(m.tts).toContain("[warm, relaxed] $'$&, [gently cheerful]");
    expect(m.tts.length).toBeLessThanOrEqual(EVENT_MESSAGES.birthday.ko.length + m.spoken.length);
  });

  it('stripEmotionTags: 문단 사이 빈 줄은 하나로', () => {
    expect(stripEmotionTags('[a] x\n\n[b] y\n[c] z')).toBe('x\ny\nz');
  });

  it('sanitizeEventName: 글자·숫자·공백·-·아포스트로피만 남기고, 빈 값·긴 값은 null', () => {
    expect(sanitizeEventName(' 지 민 ')).toBe('지 민');
    expect(sanitizeEventName(`지${ZERO_WIDTH}민${BELL}`)).toBe('지민');
    expect(sanitizeEventName("O'Brien Jean-Luc")).toBe("O'Brien Jean-Luc");
    // 인물 목소리로 읽힐 글자라 태그·치환 패턴·기호는 이름이 아니다.
    expect(sanitizeEventName('[angry] 지민')).toBe('angry 지민');
    expect(sanitizeEventName("지민$'$&")).toBe("지민'");
    expect(sanitizeEventName('지민!!, 🎂')).toBe('지민');
    expect(sanitizeEventName(ZERO_WIDTH)).toBeNull();
    expect(sanitizeEventName('가'.repeat(21))).toBeNull();
    // 원문이 길면 걷지도 않고 거절한다(25MiB 바디로 CPU 를 태우지 않는다).
    expect(sanitizeEventName('a'.repeat(200))).toBeNull();
  });

  it('pickSlot: 같은 사람의 두 메시지는 다른 슬롯, 다시 시도하면 옆 슬롯', () => {
    const a = pickSlot(WINTER_KO, 'birthday', '지민', 0);
    const b = pickSlot(WINTER_KO, 'comfort', '지민', 0);
    expect(a.sentence).not.toBe(b.sentence);
    expect(pickSlot(WINTER_KO, 'birthday', '지민', 1).sentence).toBe(b.sentence);
    expect(a.project).toBe(WINTER_KO.project);
  });
});

describe('POST /event/:id/clips — 메시지 클립 생성', () => {
  beforeEach(() => {
    mockDB.reset();
    vi.restoreAllMocks();
  });
  afterAll(() => vi.restoreAllMocks());

  const ok = { celebrity: 'winter', name: '지민', locale: 'ko', kind: 'birthday' };

  it('Perso 키가 없으면 503 — 외부 호출 없이 닫힌다', async () => {
    const { fetchSpy } = fakePerso();
    const req = buildApp({ VOICE_BUCKET: fakeBucket().bucket });
    const res = await req('/event/1/clips', post(ok));
    expect(res.status).toBe(503);
    expect((await res.json()).error_code).toBe('PERSO_NOT_CONFIGURED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('버킷이 없으면 503 — 만든 소리를 둘 곳이 없다', async () => {
    fakePerso();
    const res = await buildApp({ PERSO_API_KEY: 'k' })('/event/1/clips', post(ok));
    expect(res.status).toBe(503);
    expect((await res.json()).error_code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('모르는 인물·이벤트는 404', async () => {
    fakePerso();
    const req = buildApp({ PERSO_API_KEY: 'k', VOICE_BUCKET: fakeBucket().bucket });
    expect((await req('/event/1/clips', post({ ...ok, celebrity: 'nanami' }))).status).toBe(404);
    expect((await req('/event/2/clips', post(ok))).status).toBe(404);
  });

  it.each([
    ['이름 없음', { ...ok, name: '' }],
    ['제어문자만', { ...ok, name: `${ZERO_WIDTH}${BELL}` }],
    ['기호만', { ...ok, name: '[!!]' }],
    ['너무 긴 이름', { ...ok, name: '가'.repeat(21) }],
    ['모르는 언어', { ...ok, locale: 'fr' }],
    ['모르는 종류', { ...ok, kind: 'wedding' }],
    ['슬러그 아닌 인물', { ...ok, celebrity: 'Win ter' }],
  ])('잘못된 입력은 400 — %s', async (_label, body) => {
    const { fetchSpy } = fakePerso();
    const res = await buildApp({ PERSO_API_KEY: 'k', VOICE_BUCKET: fakeBucket().bucket })(
      '/event/1/clips',
      post(body),
    );
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('처음 보는 문장: match-rewrite 로 저장 → generate-audio → 파일 받기 → R2 저장 → 경로 응답', async () => {
    const { calls, stored } = fakePerso();
    const r2 = fakeBucket();
    const res = await buildApp({ PERSO_API_KEY: 'k', VOICE_BUCKET: r2.bucket })(
      '/event/1/clips',
      post({ ...ok, name: ' 지민 ' }),
    );
    expect(res.status).toBe(200);
    const { clip } = (await res.json()) as { clip: Record<string, unknown> };
    expect(clip.cached).toBe(false);
    expect(clip.spoken).toBe('지민아');
    expect(clip.text).toMatch(/^지민아, 생일 너무너무 축하해!/);
    expect(clip.path).toMatch(/^\/api\/event\/1\/clips\/winter\/ko\/birthday\/[0-9a-f]{64}\.mp3$/);

    // 순서가 곧 계약이다: 저장(match-rewrite) 없이 generate-audio 를 부르면 옛 글자가 읽힌다.
    const slot = pickSlot(WINTER_KO, 'birthday', '지민', 0);
    expect(calls).toEqual([
      `POST ${slot.project}/${slot.sentence} match-rewrite`,
      `PATCH ${slot.project}/${slot.sentence} generate-audio`,
      `GET media /perso-storage/p-${slot.project}/윈터 클립_${slot.sentence}_1.mp3`,
    ]);
    // 보낸 글자는 태그가 붙은 전체 문장이고 이름은 부르는 꼴이다.
    expect(stored.get(`${slot.project}/${slot.sentence}`)).toContain('[warm, relaxed] 지민아,');

    expect(r2.bucket.put).toHaveBeenCalledTimes(1);
    const key = r2.bucket.put.mock.calls[0]![0] as string;
    expect(`/api/${key}`).toBe(clip.path);
    expect(key).not.toContain('지민');
  });

  it('같은 (인물, 언어, 종류, 이름)은 R2 에서 답하고 Perso 를 부르지 않는다', async () => {
    const { fetchSpy } = fakePerso();
    const r2 = fakeBucket();
    const req = buildApp({ PERSO_API_KEY: 'k', VOICE_BUCKET: r2.bucket });
    const first = (await (await req('/event/1/clips', post(ok))).json()) as {
      clip: { path: string };
    };
    const persoCalls = fetchSpy.mock.calls.length;
    const res = await req('/event/1/clips', post(ok));
    const { clip } = (await res.json()) as { clip: { path: string; cached: boolean } };
    expect(clip.cached).toBe(true);
    expect(clip.path).toBe(first.clip.path);
    expect(fetchSpy.mock.calls.length).toBe(persoCalls);
  });

  it('이름이 다르면 다른 키 — 다른 사람 소리를 주지 않는다', async () => {
    fakePerso();
    const req = buildApp({ PERSO_API_KEY: 'k', VOICE_BUCKET: fakeBucket().bucket });
    const a = (await (await req('/event/1/clips', post(ok))).json()) as { clip: { path: string } };
    const b = (await (await req('/event/1/clips', post({ ...ok, name: '민정' }))).json()) as {
      clip: { path: string };
    };
    expect(a.clip.path).not.toBe(b.clip.path);
  });

  it('슬롯이 겹쳐 남의 글자가 읽히면 다른 슬롯으로 다시 만든다', async () => {
    const first = pickSlot(WINTER_KO, 'birthday', '지민', 0);
    const { calls } = fakePerso({ overwriteOnGenerate: new Set([first.sentence]) });
    const r2 = fakeBucket();
    const res = await buildApp({ PERSO_API_KEY: 'k', VOICE_BUCKET: r2.bucket })(
      '/event/1/clips',
      post(ok),
    );
    expect(res.status).toBe(200);
    const second = pickSlot(WINTER_KO, 'birthday', '지민', 1);
    expect(second.sentence).not.toBe(first.sentence);
    expect(calls.filter((c) => c.includes('generate-audio'))).toEqual([
      `PATCH ${first.project}/${first.sentence} generate-audio`,
      `PATCH ${second.project}/${second.sentence} generate-audio`,
    ]);
    expect(r2.bucket.put).toHaveBeenCalledTimes(1);
  });

  it('저장소가 mp3 가 아닌 것을 주면 502 — 영구 캐시에 깨진 파일을 박지 않는다', async () => {
    fakePerso({ media: new TextEncoder().encode('<html>Service Unavailable</html>'.repeat(200)) });
    const r2 = fakeBucket();
    const res = await buildApp({ PERSO_API_KEY: 'k', VOICE_BUCKET: r2.bucket })(
      '/event/1/clips',
      post(ok),
    );
    expect(res.status).toBe(502);
    expect(r2.bucket.put).not.toHaveBeenCalled();
  });

  it('Perso 가 실패하면 502 — 빈 파일을 캐시하지 않는다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const r2 = fakeBucket();
    const res = await buildApp({ PERSO_API_KEY: 'k', VOICE_BUCKET: r2.bucket })(
      '/event/1/clips',
      post(ok),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error_code).toBe('PERSO_FAILED');
    expect(r2.bucket.put).not.toHaveBeenCalled();
  });
});

describe('GET /event/:id/clips/… — 만든 소리 내려주기', () => {
  beforeEach(() => vi.restoreAllMocks());

  const make = async (req: ReturnType<typeof buildApp>) => {
    const { clip } = (await (
      await req(
        '/event/1/clips',
        post({ celebrity: 'winter', name: '지민', locale: 'ko', kind: 'birthday' }),
      )
    ).json()) as { clip: { path: string } };
    return clip.path.replace(/^\/api/, '');
  };

  it('만든 클립을 immutable 캐시 헤더와 함께 준다; download= 를 주면 첨부 파일명', async () => {
    fakePerso();
    const req = buildApp({ PERSO_API_KEY: 'k', VOICE_BUCKET: fakeBucket().bucket });
    const path = await make(req);

    const res = await req(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('content-disposition')).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP3_BYTES);

    const dl = await req(`${path}?download=${encodeURIComponent('알람톡 윈터 생일 축하 지민')}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toBe(
      `attachment; filename="alarmtalk-winter-birthday.mp3"; filename*=UTF-8''${encodeURIComponent('알람톡 윈터 생일 축하 지민.mp3')}`,
    );
    // 라틴 이름은 옛 브라우저용 filename 에도 그대로.
    const dlAscii = await req(`${path}?download=${encodeURIComponent('AlarmTalk Winter Emily')}`);
    expect(dlAscii.headers.get('content-disposition')).toContain('filename="AlarmTalk Winter Emily.mp3"');
  });

  it('Range: 한 구간은 206, 꼬리 구간은 전체 200, 범위 밖은 416', async () => {
    fakePerso();
    const req = buildApp({ PERSO_API_KEY: 'k', VOICE_BUCKET: fakeBucket().bucket });
    const path = await make(req);

    const part = await req(path, { headers: { range: 'bytes=100-199' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 100-199/${MP3_BYTES.byteLength}`);
    expect(part.headers.get('content-length')).toBe('100');
    expect((await part.arrayBuffer()).byteLength).toBe(100);

    const open = await req(path, { headers: { range: 'bytes=4000-' } });
    expect(open.status).toBe(206);
    expect(open.headers.get('content-range')).toBe(`bytes 4000-4095/${MP3_BYTES.byteLength}`);

    // 꼬리 구간은 흉내 내지 않고 전체를 준다 — 잘린 몸통에 전체 길이를 달지 않는다.
    const suffix = await req(path, { headers: { range: 'bytes=-100' } });
    expect(suffix.status).toBe(200);
    expect(suffix.headers.get('content-length')).toBe(String(MP3_BYTES.byteLength));
    expect((await suffix.arrayBuffer()).byteLength).toBe(MP3_BYTES.byteLength);

    const beyond = await req(path, { headers: { range: 'bytes=999999-' } });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe(`bytes */${MP3_BYTES.byteLength}`);
  });

  it('없는 클립은 404, 해시 꼴이 아닌 경로는 400 — 버킷을 뒤지지 않는다', async () => {
    const r2 = fakeBucket();
    const req = buildApp({ VOICE_BUCKET: r2.bucket });
    expect((await req(`/event/1/clips/winter/ko/birthday/${'a'.repeat(64)}.mp3`)).status).toBe(404);
    // `..` 은 URL 단계에서 접혀 라우트에 닿지 않는다(404). 해시 꼴이 아니면 400.
    expect((await req('/event/1/clips/winter/ko/birthday/../secret.mp3')).status).toBe(404);
    expect((await req('/event/1/clips/winter/ko/birthday/x.mp3')).status).toBe(400);
    expect((await req('/event/1/clips/winter/ko/birthday/%2e%2e.mp3')).status).toBe(400);
    expect(r2.bucket.get).toHaveBeenCalledTimes(1);
  });
});
