import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import {
  EVENT_VOICES,
  isEventLocale,
  isEventMessageKind,
  pickSlot,
  renderMessage,
  sanitizeEventName,
  type EventLocale,
  type EventMessageKind,
} from '../lib/event-voices';
import { generateSentenceAudio, PersoSlotRace } from '../lib/perso';
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
// 같은 (인물, 언어, 종류, 문장)은 한 번만 만든다: R2(VOICE_BUCKET)에 문장의 sha256 을 키로 두고
// 다음부터는 그 파일을 준다. 문장에 이름이 들어 있으니 같은 이름은 같은 키이고, 문구를 바꾸면
// 키가 바뀌어 옛 소리가 섞이지 않는다. 생성은 10~30초 걸리므로 클라는 종류마다 따로 부른다.
//
// 슬롯 겹침: 두 요청이 같은 Perso 문장을 동시에 쓰면 남의 글자가 읽힐 수 있다 — `lib/perso.ts` 가
// 그걸 `PersoSlotRace` 로 알리고, 여기서 다른 슬롯으로 다시 시도한다.

// 슬롯이 하나뿐인 언어(2026-09-16 현재 ja)는 옆 슬롯이 없어 같은 슬롯을 조금 기다렸다 다시 쓴다.
const MAX_SLOT_ATTEMPTS = 3;
const HASH_FILE_RE = /^[0-9a-f]{64}\.mp3$/;

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

/** R2 키. 요청 경로와 1:1 이라 GET 이 그대로 되짚는다. */
function objectKey(
  eventId: string,
  celebrity: string,
  locale: EventLocale,
  kind: EventMessageKind,
  file: string,
): string {
  return `event/${eventId}/clips/${celebrity}/${locale}/${kind}/${file}`;
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
  if (!ID_RE.test(celebrity) || !isEventLocale(b.locale) || !isEventMessageKind(b.kind) || name === null) {
    return jsonError(c, 400, 'INVALID_BODY', 'invalid body');
  }
  const locale = b.locale;
  const kind = b.kind;

  const voice = EVENT_VOICES[eventId]?.[celebrity];
  if (!voice) return jsonError(c, 404, 'NOT_FOUND', 'unknown celebrity');
  const slots = voice[locale];
  if (!slots || slots.sentences.length === 0) {
    return jsonError(c, 503, 'VOICE_NOT_AVAILABLE', 'voice not available in this language');
  }
  const apiKey = c.env.PERSO_API_KEY;
  if (!apiKey) return jsonError(c, 503, 'PERSO_NOT_CONFIGURED', 'not configured');
  const bucket = c.env.VOICE_BUCKET;
  if (!bucket) return jsonError(c, 503, 'STORAGE_NOT_CONFIGURED', 'not configured');

  const message = renderMessage(kind, locale, name);
  const hash = await sha256Hex(message.tts);
  const file = `${hash}.mp3`;
  const key = objectKey(eventId, celebrity, locale, kind, file);
  const clip = {
    kind,
    locale,
    path: clipPath(eventId, celebrity, locale, kind, hash),
    text: message.display,
    spoken: message.spoken,
  };

  if (await bucket.head(key)) return c.json({ clip: { ...clip, cached: true } });

  let generated;
  for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt++) {
    const slot = pickSlot(slots, kind, name, attempt);
    try {
      generated = await generateSentenceAudio(apiKey, slot, message.tts);
      break;
    } catch (err) {
      if (err instanceof PersoSlotRace && attempt + 1 < MAX_SLOT_ATTEMPTS) {
        // 둘이 동시에 다시 시도하면 또 겹친다 — 조금씩 다르게 기다렸다가 옆 슬롯으로.
        console.warn('[event] slot race, retrying on another slot', slot);
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 2500));
        continue;
      }
      console.error('[event] clip synthesis failed', err);
      return jsonError(c, 502, 'PERSO_FAILED', 'synthesis failed');
    }
  }
  if (!generated) return jsonError(c, 502, 'PERSO_FAILED', 'synthesis failed');

  // 클라가 응답 직후 GET 으로 받아 가므로 저장을 기다린다(waitUntil 이면 404 가 날 수 있다).
  await bucket.put(key, generated.bytes, {
    httpMetadata: { contentType: generated.mimeType },
    customMetadata: { celebrity, locale, kind, createdAt: new Date().toISOString() },
  });
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
  const bucket = c.env.VOICE_BUCKET;
  if (!bucket) return jsonError(c, 503, 'STORAGE_NOT_CONFIGURED', 'not configured');

  const key = objectKey(eventId, celebrity, locale, kind, file);
  // Range 는 `bytes=시작-[끝]` 한 구간만 받는다. 꼬리(`bytes=-N`)·여러 구간은 전체(200)로 답한다 —
  // R2 가 잘라 준 몸통에 전체 길이를 달아 보내는 사고를 막는다. 범위 밖이면 R2 가 던진다 → 416.
  const rangeMatch = /^bytes=(\d+)-(\d*)$/.exec(c.req.header('range') ?? '');
  const range = rangeMatch
    ? {
        offset: Number(rangeMatch[1]),
        ...(rangeMatch[2] ? { length: Number(rangeMatch[2]) - Number(rangeMatch[1]) + 1 } : {}),
      }
    : undefined;
  let obj: R2Object | R2ObjectBody | null;
  try {
    obj = await bucket.get(key, { range, onlyIf: c.req.raw.headers });
  } catch (err) {
    if (!range) throw err;
    const head = await bucket.head(key);
    if (!head) return jsonError(c, 404, 'NOT_FOUND', 'unknown clip');
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${head.size}` } });
  }
  if (!obj) return jsonError(c, 404, 'NOT_FOUND', 'unknown clip');

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('content-type', 'audio/mpeg');
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  // 키가 내용의 해시라 바뀌지 않는다 — 브라우저·CDN 이 마음껏 들고 있어도 된다.
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  const download = c.req.query('download');
  if (download !== undefined) {
    headers.set('content-disposition', contentDisposition(download, `alarmtalk-${celebrity}-${kind}`));
  }
  if (!('body' in obj)) return new Response(null, { status: 304, headers });

  // 우리가 보낸 Range 일 때만 206 — R2 는 Range 없이도 `range` 를 채워 주기도 한다(로컬 실측).
  if (range && obj.range && 'offset' in obj.range) {
    const start = obj.range.offset ?? 0;
    const length = obj.range.length ?? obj.size - start;
    headers.set('content-range', `bytes ${start}-${start + length - 1}/${obj.size}`);
    headers.set('content-length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
});

export default event;
