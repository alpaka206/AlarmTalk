import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB } from './helpers';
import {
  EVENT_MESSAGES,
  EVENT_VOICES,
  renderMessage,
  sanitizeEventName,
  slotAt,
  stripEmotionTags,
  vocative,
} from '../src/lib/event-voices';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import eventRoutes, { resetEventCaches } from '../src/routes/event';

const WINTER_KO = EVENT_VOICES['1']!.winter!.ko!;
// 보이지 않는 글자는 코드포인트로 적는다 — 소스에 그대로 실리면 편집기·리뷰 도구에서 안 보인다.
const ZERO_WIDTH = String.fromCodePoint(0x200b);
const BELL = String.fromCodePoint(0x07);

/** Perso 저장소가 주는 mp3 흉내 — 프레임 동기(0xFFFB)로 시작하는 8KB. */
const MP3_BYTES = (() => {
  const b = new Uint8Array(8192);
  b[0] = 0xff;
  b[1] = 0xfb;
  for (let i = 2; i < b.length; i++) b[i] = i & 0xff;
  return b;
})();

/** 윈터 ko 프로젝트의 문장(슬롯) 흉내 — 홍보용 셋(reserved)을 포함해 여덟. */
const KO_SENTENCES = [11135210, 11135211, 11135212, 11135213, 11135214, 11135215, 11135216, 11135217];

function buildApp(env: Record<string, unknown> = { PERSO_API_KEY: 'k' }) {
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
 * Perso 흉내. script 는 문장 목록을 두 쪽으로 준다(커서). match-rewrite 가 슬롯의 글자를 저장하고
 * generate-audio 가 저장된 글자를 읽는다(2026-09-16 실측과 같은 순서). 파일 경로는 실제처럼
 * 생성마다 새 이름이고, 저장소는 Range 를 알아듣는다. `overwriteOnGenerate` 를 주면 생성 직전에
 * 남이 슬롯을 덮어쓴 상황을, `media` 를 주면 저장소가 돌려주는 몸통을 바꾼다.
 */
function fakePerso(opts: { overwriteOnGenerate?: Set<number>; media?: Uint8Array } = {}) {
  const stored = new Map<string, string>();
  const calls: string[] = [];
  let generation = 0;
  const media = opts.media ?? MP3_BYTES;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const script = url.match(/\/projects\/(\d+)\/spaces\/(\d+)\/script\?(.*)$/);
    if (script) {
      calls.push(`GET script ${script[1]} ${script[3]}`);
      const cursor = new URLSearchParams(script[3]).get('cursorId');
      const half = Math.ceil(KO_SENTENCES.length / 2);
      const page = cursor === null ? KO_SENTENCES.slice(0, half) : KO_SENTENCES.slice(half);
      return Response.json({
        hasNext: cursor === null,
        nextCursorId: cursor === null ? page[page.length - 1] : null,
        sentences: page.map((seq) => ({ seq, translatedText: `문장 ${seq}` })),
      });
    }
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
      const path = decodeURI(url.slice('https://portal-media.perso.ai'.length));
      const range = new Headers(init?.headers).get('range');
      calls.push(`GET media ${path}${range ? ` [${range}]` : ''}`);
      const r = /^bytes=(\d+)-(\d*)$/.exec(range ?? '');
      if (r) {
        const start = Number(r[1]);
        const end = r[2] ? Math.min(Number(r[2]), media.byteLength - 1) : media.byteLength - 1;
        return new Response(media.subarray(start, end + 1), {
          status: 206,
          headers: {
            'content-type': 'application/octet-stream',
            'content-range': `bytes ${start}-${end}/${media.byteLength}`,
            'content-length': String(end - start + 1),
          },
        });
      }
      return new Response(media, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(media.byteLength),
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return { stored, calls, fetchSpy };
}

/** DB 카운터 흉내 — 순번을 차례로 준다. */
function cursorPositions(...positions: number[]) {
  for (const p of positions) mockDB.pushResultFor('event_slot_cursor', [{ position: p }], 1);
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

  it('slotAt: 순번대로 돌고, 홍보용 문장은 건너뛴다', () => {
    const usable = KO_SENTENCES.filter((s) => !WINTER_KO.reserved!.includes(s));
    expect(usable).toHaveLength(5);
    expect(slotAt(WINTER_KO, KO_SENTENCES, 0).sentence).toBe(usable[0]);
    expect(slotAt(WINTER_KO, KO_SENTENCES, 4).sentence).toBe(usable[4]);
    expect(slotAt(WINTER_KO, KO_SENTENCES, 5).sentence).toBe(usable[0]);
    expect(slotAt(WINTER_KO, KO_SENTENCES, 123456).sentence).toBe(usable[123456 % 5]);
    for (const seq of KO_SENTENCES) {
      for (let p = 0; p < 20; p++) {
        if (WINTER_KO.reserved!.includes(seq)) expect(slotAt(WINTER_KO, KO_SENTENCES, p).sentence).not.toBe(seq);
      }
    }
    expect(() => slotAt(WINTER_KO, [11135215], 0)).toThrow();
  });
});

describe('POST /event/:id/clips — 메시지 클립 생성', () => {
  beforeEach(() => {
    mockDB.reset();
    vi.restoreAllMocks();
    resetEventCaches();
  });
  afterAll(() => vi.restoreAllMocks());

  const ok = { celebrity: 'winter', name: '지민', locale: 'ko', kind: 'birthday' };

  it('Perso 키가 없으면 503 — 외부 호출 없이 닫힌다', async () => {
    const { fetchSpy } = fakePerso();
    const res = await buildApp({})('/event/1/clips', post(ok));
    expect(res.status).toBe(503);
    expect((await res.json()).error_code).toBe('PERSO_NOT_CONFIGURED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('모르는 인물·이벤트는 404', async () => {
    fakePerso();
    const req = buildApp();
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
    const res = await buildApp()('/event/1/clips', post(body));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('처음 보는 문장: 문장 목록 → 순번 슬롯에 match-rewrite → generate-audio → mp3 확인 → DB 행 → 경로', async () => {
    const { calls, stored } = fakePerso();
    cursorPositions(7);
    const res = await buildApp()('/event/1/clips', post({ ...ok, name: ' 지민 ' }));
    expect(res.status).toBe(200);
    const { clip } = (await res.json()) as { clip: Record<string, unknown> };
    expect(clip.cached).toBe(false);
    expect(clip.spoken).toBe('지민아');
    expect(clip.text).toMatch(/^지민아, 생일 너무너무 축하해!/);
    expect(clip.path).toMatch(/^\/api\/event\/1\/clips\/winter\/ko\/birthday\/[0-9a-f]{64}\.mp3$/);

    // 순번 7 → 쓸 수 있는 다섯 중 7 % 5 = 2번째. 순서가 곧 계약이다: 저장(match-rewrite) 없이
    // generate-audio 를 부르면 옛 글자가 읽힌다. 마지막으로 앞 4KB 만 받아 mp3 인지 본다.
    const slot = slotAt(WINTER_KO, KO_SENTENCES, 7);
    expect(calls).toEqual([
      'GET script 413673 size=10000',
      'GET script 413673 size=10000&cursorId=11135213',
      `POST ${slot.project}/${slot.sentence} match-rewrite`,
      `PATCH ${slot.project}/${slot.sentence} generate-audio`,
      `GET media /perso-storage/p-${slot.project}/윈터 클립_${slot.sentence}_1.mp3 [bytes=0-4095]`,
    ]);
    // 보낸 글자는 태그가 붙은 전체 문장이고 이름은 부르는 꼴이다.
    expect(stored.get(`${slot.project}/${slot.sentence}`)).toContain('[warm, relaxed] 지민아,');

    // DB 에는 경로만 — 소리는 우리 쪽에 남지 않는다. 값은 전부 바인딩.
    const insert = mockDB.calls.find((q) => q.sql.includes('INSERT INTO event_clips'));
    expect(insert).toBeDefined();
    expect(insert!.args).toEqual([
      (clip.path as string).match(/([0-9a-f]{64})\.mp3$/)![1],
      '1',
      'winter',
      'ko',
      'birthday',
      `/perso-storage/p-${slot.project}/윈터 클립_${slot.sentence}_1.mp3`,
    ]);
    expect(insert!.sql).not.toContain('지민');
  });

  it('DB 가 알고 있는 문장은 Perso 를 부르지 않는다', async () => {
    const { fetchSpy } = fakePerso();
    mockDB.pushResultFor('FROM event_clips', [{ perso_path: '/perso-storage/p-413673/이미.mp3' }]);
    const res = await buildApp()('/event/1/clips', post(ok));
    const { clip } = (await res.json()) as { clip: { cached: boolean } };
    expect(clip.cached).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('같은 요청을 두 번 하면 두 번째는 만들지 않는다(이 워커가 기억한다)', async () => {
    const { fetchSpy } = fakePerso();
    const req = buildApp();
    const first = (await (await req('/event/1/clips', post(ok))).json()) as { clip: { path: string } };
    const persoCalls = fetchSpy.mock.calls.length;
    const { clip } = (await (await req('/event/1/clips', post(ok))).json()) as {
      clip: { path: string; cached: boolean };
    };
    expect(clip.cached).toBe(true);
    expect(clip.path).toBe(first.clip.path);
    expect(fetchSpy.mock.calls.length).toBe(persoCalls);
  });

  it('요청마다 다음 문장으로 돌아간다 — 문장 목록은 한 번만 읽는다', async () => {
    const { calls } = fakePerso();
    cursorPositions(0, 1);
    const req = buildApp();
    await req('/event/1/clips', post(ok));
    await req('/event/1/clips', post({ ...ok, kind: 'comfort' }));
    const a = slotAt(WINTER_KO, KO_SENTENCES, 0);
    const b = slotAt(WINTER_KO, KO_SENTENCES, 1);
    expect(a.sentence).not.toBe(b.sentence);
    expect(calls.filter((c) => c.startsWith('GET script'))).toHaveLength(2);
    expect(calls.filter((c) => c.includes('generate-audio'))).toEqual([
      `PATCH ${a.project}/${a.sentence} generate-audio`,
      `PATCH ${b.project}/${b.sentence} generate-audio`,
    ]);
  });

  it('이름이 다르면 다른 경로 — 다른 사람 소리를 주지 않는다', async () => {
    fakePerso();
    const req = buildApp();
    const a = (await (await req('/event/1/clips', post(ok))).json()) as { clip: { path: string } };
    const b = (await (await req('/event/1/clips', post({ ...ok, name: '민정' }))).json()) as {
      clip: { path: string };
    };
    expect(a.clip.path).not.toBe(b.clip.path);
  });

  it('슬롯이 겹쳐 남의 글자가 읽히면 다음 문장으로 다시 만든다', async () => {
    const first = slotAt(WINTER_KO, KO_SENTENCES, 0);
    const { calls } = fakePerso({ overwriteOnGenerate: new Set([first.sentence]) });
    cursorPositions(0, 1);
    const res = await buildApp()('/event/1/clips', post(ok));
    expect(res.status).toBe(200);
    const second = slotAt(WINTER_KO, KO_SENTENCES, 1);
    expect(calls.filter((c) => c.includes('generate-audio'))).toEqual([
      `PATCH ${first.project}/${first.sentence} generate-audio`,
      `PATCH ${second.project}/${second.sentence} generate-audio`,
    ]);
    expect(mockDB.calls.filter((q) => q.sql.includes('INSERT INTO event_clips'))).toHaveLength(1);
  });

  it('저장소가 mp3 가 아닌 것을 주면 502 — 경로를 적어 두지 않는다', async () => {
    fakePerso({ media: new TextEncoder().encode('<html>Service Unavailable</html>'.repeat(200)) });
    const res = await buildApp()('/event/1/clips', post(ok));
    expect(res.status).toBe(502);
    expect(mockDB.calls.some((q) => q.sql.includes('INSERT INTO event_clips'))).toBe(false);
  });

  it('Perso 가 실패하면 502', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const res = await buildApp()('/event/1/clips', post(ok));
    expect(res.status).toBe(502);
    expect((await res.json()).error_code).toBe('PERSO_FAILED');
    expect(mockDB.calls.some((q) => q.sql.includes('INSERT INTO event_clips'))).toBe(false);
  });
});

describe('GET /event/:id/clips/… — Perso 저장소에서 흘려보내기', () => {
  beforeEach(() => {
    mockDB.reset();
    vi.restoreAllMocks();
    resetEventCaches();
  });

  const make = async (req: ReturnType<typeof buildApp>) => {
    const { clip } = (await (
      await req(
        '/event/1/clips',
        post({ celebrity: 'winter', name: '지민', locale: 'ko', kind: 'birthday' }),
      )
    ).json()) as { clip: { path: string } };
    return clip.path.replace(/^\/api/, '');
  };

  it('전체는 200 + immutable 캐시, download= 는 첨부 파일명, Range 는 저장소 206 그대로', async () => {
    const { calls } = fakePerso();
    const req = buildApp();
    const path = await make(req);

    const res = await req(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe(String(MP3_BYTES.byteLength));
    expect(res.headers.get('content-disposition')).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP3_BYTES);
    expect(calls.at(-1)).toMatch(/^GET media \/perso-storage\/p-413673\/윈터 클립_\d+_1\.mp3$/);

    const dl = await req(`${path}?download=${encodeURIComponent('알람톡 윈터 생일 축하 지민')}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toBe(
      `attachment; filename="alarmtalk-winter-birthday.mp3"; filename*=UTF-8''${encodeURIComponent('알람톡 윈터 생일 축하 지민.mp3')}`,
    );
    // 라틴 이름은 옛 브라우저용 filename 에도 그대로.
    const dlAscii = await req(`${path}?download=${encodeURIComponent('AlarmTalk Winter Emily')}`);
    expect(dlAscii.headers.get('content-disposition')).toContain('filename="AlarmTalk Winter Emily.mp3"');

    const part = await req(path, { headers: { range: 'bytes=100-199' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 100-199/${MP3_BYTES.byteLength}`);
    expect(part.headers.get('content-length')).toBe('100');
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    expect(calls.at(-1)).toContain('[bytes=100-199]');
  });

  it('DB 에 있는 경로로도 준다(다른 워커가 만든 것)', async () => {
    fakePerso();
    mockDB.pushResultFor('FROM event_clips', [{ perso_path: '/perso-storage/p-413673/어제 만든.mp3' }]);
    const res = await buildApp()(`/event/1/clips/winter/ko/birthday/${'a'.repeat(64)}.mp3`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('없는 클립은 404, 해시 꼴이 아닌 경로는 400 — 저장소에 가지 않는다', async () => {
    const { fetchSpy } = fakePerso();
    const req = buildApp();
    expect((await req(`/event/1/clips/winter/ko/birthday/${'a'.repeat(64)}.mp3`)).status).toBe(404);
    // `..` 은 URL 단계에서 접혀 라우트에 닿지 않는다(404). 해시 꼴이 아니면 400.
    expect((await req('/event/1/clips/winter/ko/birthday/../secret.mp3')).status).toBe(404);
    expect((await req('/event/1/clips/winter/ko/birthday/x.mp3')).status).toBe(400);
    expect((await req('/event/1/clips/winter/ko/birthday/%2e%2e.mp3')).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('저장소가 죽으면 502', async () => {
    fakePerso();
    const req = buildApp();
    const path = await make(req);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('gone', { status: 503 }));
    const res = await req(path);
    expect(res.status).toBe(502);
  });
});
