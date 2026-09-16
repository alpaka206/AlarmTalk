import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { getDB } from '../lib/db';
import {
  EVENT_VOICES,
  isEventLocale,
  isEventMessageKind,
  renderMessage,
  sanitizeEventName,
  slotAt,
  type EventLocale,
  type EventMessageKind,
  type VoiceProject,
} from '../lib/event-voices';
import {
  fetchPersoMedia,
  generateSentenceAudio,
  listSentenceSeqs,
  looksLikeMp3,
  MIN_CLIP_BYTES,
  PersoSlotRace,
} from '../lib/perso';
import { jsonError } from '../lib/api-error';

// 랜딩 이벤트 페이지(alarm-talk.com/event/<id>/)의 공개 라우트. 인증 없음.
//
//   GET  /api/event/:eventId/likes                       → { likes: { <subjectId>: count, ... } }
//   POST /api/event/:eventId/likes/:subjectId            → { count }   (누른 횟수만큼 1 씩 더한다)
//   POST /api/event/:eventId/clips  { celebrity, name, locale, kind }
//                                                        → { clip: { path, text, spoken, cached } }
//   GET  /api/event/:eventId/clips/:celebrity/:locale/:kind/:file[?download=<이름>]  → audio/mpeg
//
// 좋아요 행은 마이그레이션이 시드한다(#119). POST 는 있는 행만 UPDATE 하므로 모르는 id 는 404 이고
// 스팸이 행을 만들어 내지 못한다. 남용 방어는 IP 버킷(index.ts 의 eventLikeRateLimitMiddleware,
// 클립 생성은 더 좁은 eventClipRateLimitMiddleware). id 는 짧은 슬러그만 받는다 — 값은
// 예외 없이 `?` 바인딩.

const event = new Hono<AppEnv>();

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

event.get('/:eventId/likes', async (c) => {
  const eventId = c.req.param('eventId');
  if (!ID_RE.test(eventId)) {
    return jsonError(c, 400, 'INVALID_ID', 'invalid event id');
  }
  const db = getDB(c.env);
  const r = await db.execute({
    sql: 'SELECT subject_id, count FROM event_likes WHERE event_id = ? ORDER BY subject_id',
    args: [eventId],
  });
  const likes: Record<string, number> = {};
  for (const row of r.rows) likes[String(row.subject_id)] = Number(row.count);
  return c.json({ likes });
});

event.post('/:eventId/likes/:subjectId', async (c) => {
  const eventId = c.req.param('eventId');
  const subjectId = c.req.param('subjectId');
  if (!ID_RE.test(eventId) || !ID_RE.test(subjectId)) {
    return jsonError(c, 400, 'INVALID_ID', 'invalid id');
  }
  const db = getDB(c.env);
  const r = await db.execute({
    sql: `UPDATE event_likes SET count = count + 1, updated_at = datetime('now')
          WHERE event_id = ? AND subject_id = ? RETURNING count`,
    args: [eventId, subjectId],
  });
  if (r.rows.length === 0) {
    return jsonError(c, 404, 'NOT_FOUND', 'unknown subject');
  }
  return c.json({ count: Number(r.rows[0]!.count) });
});

// ── 메시지 클립 ────────────────────────────────────────────────────────────────
//
// 이름이 들어간 문장 **전체**를 인물 목소리로 만든다(2026-09-16 결정 — 이름만 따로 만들어 붙이면
// 문맥이 없어 어색했다). 문장은 서버의 `lib/event-voices.ts` 가 정하고 클라는 {인물, 이름, 언어,
// 종류}만 보낸다 — 임의 문장을 인물 목소리로 읽히는 길을 두지 않는다.
//
// 소리 파일은 우리 쪽에 두지 않는다(2026-09-16 지시). Perso 가 만든 파일은 그쪽 저장소에 새 이름으로
// 남으므로, (이벤트, 인물, 언어, 종류, 문장)의 해시 → 그 경로만 DB 행으로 적어 두고 재생·다운로드
// 때 거기서 흘려보낸다. 같은 이름은 한 번만 만든다. 문구를 바꾸면 해시가 바뀌어 옛 소리가 섞이지
// 않는다. 생성은 10~30초 걸리므로 클라는 종류마다 따로 부른다.
//
// 슬롯: 프로젝트의 문장 전부를 DB 카운터로 돌려 쓴다(요청마다 다음 문장). 그래도 두 요청이 같은
// 문장을 쓰면 남의 글자가 읽힐 수 있다 — `lib/perso.ts` 가 `PersoSlotRace` 로 알리고, 여기서
// 다음 문장으로 다시 시도한다. 로컬(wrangler dev)에는 DB 가 없어 행 대신 isolate 메모리에 적고
// 순번은 무작위다 — 같은 워커가 살아 있는 동안은 같은 흐름이 돈다.

const MAX_SLOT_ATTEMPTS = 3;
const HASH_FILE_RE = /^[0-9a-f]{64}\.mp3$/;
/** 문장 목록을 isolate 안에서 들고 있는 시간. 문장을 새로 더하면 이만큼 뒤에 보인다. */
const SENTENCES_TTL_MS = 10 * 60_000;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function clipPath(
  eventId: string,
  celebrity: string,
  locale: EventLocale,
  kind: EventMessageKind,
  hash: string,
): string {
  return `/api/event/${eventId}/clips/${celebrity}/${locale}/${kind}/${hash}.mp3`;
}

const sentenceCache = new Map<number, { seqs: number[]; at: number }>();

/** 테스트용 — isolate 에 든 문장 목록·경로 기억을 비운다. */
export function resetEventCaches(): void {
  sentenceCache.clear();
  memoryClips.clear();
}

async function sentencesFor(apiKey: string, voice: VoiceProject): Promise<number[]> {
  const hit = sentenceCache.get(voice.project);
  if (hit && Date.now() - hit.at < SENTENCES_TTL_MS) return hit.seqs;
  const seqs = await listSentenceSeqs(apiKey, voice.project, voice.spaceSeq);
  sentenceCache.set(voice.project, { seqs, at: Date.now() });
  return seqs;
}

/** 해시 → Perso 경로. DB 가 없거나 죽었으면 isolate 메모리만 본다(로컬 개발). */
const memoryClips = new Map<string, string>();

async function findClipPath(env: Env, key: string): Promise<string | null> {
  const local = memoryClips.get(key);
  if (local) return local;
  try {
    const r = await getDB(env).execute({
      sql: 'SELECT perso_path FROM event_clips WHERE clip_key = ?',
      args: [key],
    });
    const path = r.rows[0]?.perso_path;
    return typeof path === 'string' ? path : null;
  } catch (err) {
    console.warn('[event] clip lookup without DB', String(err).slice(0, 120));
    return null;
  }
}

async function saveClipPath(
  env: Env,
  key: string,
  meta: { eventId: string; celebrity: string; locale: EventLocale; kind: EventMessageKind },
  persoPath: string,
): Promise<void> {
  memoryClips.set(key, persoPath);
  try {
    await getDB(env).execute({
      sql: `INSERT INTO event_clips (clip_key, event_id, celebrity, locale, kind, perso_path)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(clip_key) DO NOTHING`,
      args: [key, meta.eventId, meta.celebrity, meta.locale, meta.kind, persoPath],
    });
  } catch (err) {
    console.warn('[event] clip saved in memory only', String(err).slice(0, 120));
  }
}

/** 프로젝트의 다음 순번. DB 가 없으면 무작위 — 순번이 안 겹칠 뿐 흐름은 같다. */
async function nextSlotPosition(env: Env, project: number): Promise<number> {
  try {
    const r = await getDB(env).execute({
      sql: `INSERT INTO event_slot_cursor (project, position) VALUES (?, 1)
            ON CONFLICT(project) DO UPDATE SET position = position + 1 RETURNING position`,
      args: [project],
    });
    const position = Number(r.rows[0]?.position);
    if (Number.isFinite(position)) return position;
  } catch (err) {
    console.warn('[event] slot cursor without DB', String(err).slice(0, 120));
  }
  return Math.floor(Math.random() * 1_000_000);
}

/**
 * 만든 파일이 정말 mp3 인지 앞 4KB 만 받아 본다 — 해시 키에 잘못된 경로를 영구히 적어 두지 않으려고.
 * 문장 하나는 아무리 짧아도 MIN_CLIP_BYTES 보다 크다.
 */
async function verifyMp3(persoPath: string): Promise<void> {
  const res = await fetchPersoMedia(persoPath, 'bytes=0-4095');
  const head = new Uint8Array(await res.arrayBuffer());
  const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? head.byteLength);
  if (!looksLikeMp3(head) || total < MIN_CLIP_BYTES) {
    throw new Error(`Perso media is not an mp3 (${total} bytes)`);
  }
}

event.post('/:eventId/clips', async (c) => {
  const eventId = c.req.param('eventId');
  if (!ID_RE.test(eventId)) {
    return jsonError(c, 400, 'INVALID_ID', 'invalid event id');
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, 'INVALID_BODY', 'invalid json');
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const celebrity = typeof b.celebrity === 'string' ? b.celebrity : '';
  const name = typeof b.name === 'string' ? sanitizeEventName(b.name) : null;
  if (
    !ID_RE.test(celebrity) ||
    !isEventLocale(b.locale) ||
    !isEventMessageKind(b.kind) ||
    name === null
  ) {
    return jsonError(c, 400, 'INVALID_BODY', 'invalid body');
  }
  const locale = b.locale;
  const kind = b.kind;

  const celebrityVoices = EVENT_VOICES[eventId]?.[celebrity];
  if (!celebrityVoices) return jsonError(c, 404, 'NOT_FOUND', 'unknown celebrity');
  const voice = celebrityVoices[locale];
  if (!voice) {
    return jsonError(c, 503, 'VOICE_NOT_AVAILABLE', 'voice not available in this language');
  }
  const apiKey = c.env.PERSO_API_KEY;
  if (!apiKey) return jsonError(c, 503, 'PERSO_NOT_CONFIGURED', 'not configured');

  const message = renderMessage(kind, locale, name);
  const hash = await sha256Hex([eventId, celebrity, locale, kind, message.tts].join('\n'));
  const clip = {
    kind,
    locale,
    path: clipPath(eventId, celebrity, locale, kind, hash),
    text: message.display,
    spoken: message.spoken,
  };

  if (await findClipPath(c.env, hash)) return c.json({ clip: { ...clip, cached: true } });

  let persoPath: string | undefined;
  try {
    const sentences = await sentencesFor(apiKey, voice);
    for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt++) {
      const slot = slotAt(voice, sentences, await nextSlotPosition(c.env, voice.project));
      try {
        persoPath = (await generateSentenceAudio(apiKey, slot, message.tts)).path;
        break;
      } catch (err) {
        if (!(err instanceof PersoSlotRace) || attempt + 1 >= MAX_SLOT_ATTEMPTS) throw err;
        // 둘이 동시에 다시 시도하면 또 겹친다 — 조금씩 다르게 기다렸다가 다음 문장으로.
        console.warn('[event] slot race, retrying on the next sentence', slot);
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 2500));
      }
    }
    if (!persoPath) throw new Error('no slot succeeded');
    await verifyMp3(persoPath);
  } catch (err) {
    console.error('[event] clip synthesis failed', err);
    return jsonError(c, 502, 'PERSO_FAILED', 'synthesis failed');
  }

  await saveClipPath(c.env, hash, { eventId, celebrity, locale, kind }, persoPath);
  return c.json({ clip: { ...clip, cached: false } });
});

/**
 * 다운로드 파일명 헤더. 클라가 준 이름에서 글자·숫자·공백·-_ 만 남기고 60자로 자른다.
 * `filename*` 에 그 이름을 UTF-8 로 싣고, 옛 브라우저용 `filename` 에는 ASCII 만 — 한글 이름이면
 * 밑줄만 남아 무의미하므로 그때는 고정 이름(alarmtalk-<인물>-<종류>)을 쓴다.
 */
function contentDisposition(raw: string | undefined, fallback: string): string {
  const cleaned = (raw ?? '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const base = Array.from(cleaned).slice(0, 60).join('') || fallback;
  const ascii = base.replace(/[^\x20-\x7e]/g, '').replace(/"/g, '').trim();
  const asciiBase = /[A-Za-z0-9]/.test(ascii) ? ascii : fallback;
  return `attachment; filename="${asciiBase}.mp3"; filename*=UTF-8''${encodeURIComponent(`${base}.mp3`)}`;
}

/** 엣지 캐시(있으면). 테스트(node)에는 없다. */
function edgeCache(): Cache | null {
  return typeof caches === 'undefined' ? null : caches.default;
}

// 재생·다운로드. Perso 저장소에서 흘려보내며, 한 번 흘린 파일은 엣지 캐시가 들고 있다(내용 해시가
// 키라 immutable). Range 는 저장소가 그대로 알아듣는다(206·Content-Range 를 되돌려 준다).
event.get('/:eventId/clips/:celebrity/:locale/:kind/:file', async (c) => {
  const { eventId, celebrity, locale, kind, file } = c.req.param();
  if (
    !ID_RE.test(eventId) ||
    !ID_RE.test(celebrity) ||
    !isEventLocale(locale) ||
    !isEventMessageKind(kind) ||
    !HASH_FILE_RE.test(file)
  ) {
    return jsonError(c, 400, 'INVALID_ID', 'invalid clip');
  }
  const hash = file.slice(0, -'.mp3'.length);
  const persoPath = await findClipPath(c.env, hash);
  if (!persoPath) return jsonError(c, 404, 'NOT_FOUND', 'unknown clip');

  const range = c.req.header('range');
  const download = c.req.query('download');
  const decorate = (res: Response): Response => {
    const headers = new Headers(res.headers);
    if (download !== undefined) {
      headers.set('content-disposition', contentDisposition(download, `alarmtalk-${celebrity}-${kind}`));
    }
    return new Response(res.body, { status: res.status, headers });
  };

  // 캐시 키는 쿼리(download=)를 뺀 주소 — 재생과 다운로드가 같은 파일을 나눠 쓴다.
  const cache = edgeCache();
  const cacheKey = new Request(new URL(c.req.url).origin + new URL(c.req.url).pathname, {
    headers: range ? { range } : undefined,
  });
  const cached = await cache?.match(cacheKey);
  if (cached) return decorate(cached);

  let upstream: Response;
  try {
    upstream = await fetchPersoMedia(persoPath, range);
  } catch (err) {
    console.error('[event] clip media fetch failed', err);
    return jsonError(c, 502, 'PERSO_FAILED', 'media unavailable');
  }
  const headers = new Headers();
  headers.set('content-type', 'audio/mpeg');
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  for (const h of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  const res = new Response(upstream.body, { status: upstream.status, headers });
  // 전체를 받은 응답만 캐시에 둔다(Range 조각은 캐시가 스스로 잘라 준다).
  if (cache && !range && res.status === 200) {
    c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  return decorate(res);
});

export default event;
