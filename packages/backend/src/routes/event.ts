import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { readPersoConfig, synthesizeName } from '../lib/perso';

// 랜딩 이벤트 페이지(alarm-talk.com/event/<id>/)의 공개 라우트. 인증 없음.
//
//   GET  /api/event/:eventId/likes              → { likes: { <subjectId>: count, ... } }
//   POST /api/event/:eventId/likes/:subjectId   → { count }   (누른 횟수만큼 1 씩 더한다)
//   POST /api/event/:eventId/name-clip          { celebrity, name, locale } → audio/* (이름 한 마디)
//
// 좋아요 행은 마이그레이션이 시드한다(#119). POST 는 있는 행만 UPDATE 하므로 모르는 id 는 404 이고
// 스팸이 행을 만들어 내지 못한다. 남용 방어는 IP 버킷(index.ts 의 eventLikeRateLimitMiddleware,
// 이름 클립은 더 좁은 eventNameClipRateLimitMiddleware). id 는 짧은 슬러그만 받는다 — 값은
// 예외 없이 `?` 바인딩.

const event = new Hono<AppEnv>();

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

event.get('/:eventId/likes', async (c) => {
  const eventId = c.req.param('eventId');
  if (!ID_RE.test(eventId)) {
    return c.json({ error: 'invalid event id', error_code: 'INVALID_ID' }, 400);
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
    return c.json({ error: 'invalid id', error_code: 'INVALID_ID' }, 400);
  }
  const db = getDB(c.env);
  const r = await db.execute({
    sql: `UPDATE event_likes SET count = count + 1, updated_at = datetime('now')
          WHERE event_id = ? AND subject_id = ? RETURNING count`,
    args: [eventId, subjectId],
  });
  if (r.rows.length === 0) {
    return c.json({ error: 'unknown subject', error_code: 'NOT_FOUND' }, 404);
  }
  return c.json({ count: Number(r.rows[0]!.count) });
});

// ── 이름 클립 ──────────────────────────────────────────────────────────────────
//
// 이벤트는 문장 전체를 만들지 않는다(2026-09-15 결정: 이름만 더빙). 본문은 랜딩의 정적 파일이고
// 여기서는 인물 목소리로 **부르는 이름**("지민아") 한 마디만 만든다. 브라우저가 둘을 붙인다
// (`apps/landing/components/event/audio-splice.ts`).
//
// 같은 (인물, 언어, 이름)은 한 번만 만든다 — R2(VOICE_BUCKET)에 두고 다음부터는 그 파일을 준다.
// 이름은 겹침이 많아 Perso 호출은 유니크 이름 수에 묶인다. 버킷이 없으면 캐시 없이 매번 만든다.
// Perso 가 설정돼 있지 않으면 503 — 랜딩은 그때 브라우저 합성 음성으로 물러난다.

const NAME_CLIP_LOCALES = new Set(['ko', 'en', 'ja']);
/** 랜딩 `EVENT_NAME_MAX_LENGTH` 와 같다. 길면 이름이 아니라 문장을 인물 목소리로 읽히려는 것이다. */
const NAME_MAX_LENGTH = 20;

/**
 * 랜딩 `sanitizeEventName` 과 같은 규칙(제어문자·제로폭·양방향 제어 제거, 공백 정리).
 * 정리한 뒤 비거나 길면 거절한다 — 랜딩이 이미 거른 값이 오지만 서버가 최종 문지기다.
 */
function sanitizeName(raw: string): string | null {
  const chars: string[] = [];
  for (const ch of raw.replace(/[\r\n\t]+/g, ' ')) {
    const cp = ch.codePointAt(0) ?? 0;
    const control = cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
    const zeroWidth = (cp >= 0x200b && cp <= 0x200f) || cp === 0x2060 || cp === 0xfeff;
    const bidi = (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
    if (control || zeroWidth || bidi) continue;
    chars.push(ch);
  }
  const cleaned = chars.join('').replace(/ {2,}/g, ' ').trim();
  if (!cleaned || Array.from(cleaned).length > NAME_MAX_LENGTH) return null;
  return cleaned;
}

/**
 * 부르는 꼴. 한국어는 받침이 있으면 「아」, 없으면 「야」; 마지막 글자가 한글이 아니면 조사 없음.
 * 영어·일본어는 이름만. 랜딩 `event-catalog.ts` 의 `vocative` 와 **같은 규칙**이어야 한다 —
 * 화면 글자와 소리가 어긋나면 안 된다.
 */
export function vocative(name: string, locale: string): string {
  if (locale !== 'ko' || !name) return name;
  const lastCp = Array.from(name).at(-1)!.codePointAt(0)!;
  if (lastCp < 0xac00 || lastCp > 0xd7a3) return name;
  const hasFinal = (lastCp - 0xac00) % 28 !== 0;
  return name + (hasFinal ? '아' : '야');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const audioHeaders = (mimeType: string, cache: 'hit' | 'miss' | 'none') => ({
  'content-type': mimeType,
  'x-name-clip-cache': cache,
});

event.post('/:eventId/name-clip', async (c) => {
  const eventId = c.req.param('eventId');
  if (!ID_RE.test(eventId)) {
    return c.json({ error: 'invalid event id', error_code: 'INVALID_ID' }, 400);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json', error_code: 'INVALID_BODY' }, 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const celebrity = typeof b.celebrity === 'string' ? b.celebrity : '';
  const locale = typeof b.locale === 'string' ? b.locale : '';
  const name = typeof b.name === 'string' ? sanitizeName(b.name) : null;
  if (!ID_RE.test(celebrity) || !NAME_CLIP_LOCALES.has(locale) || name === null) {
    return c.json({ error: 'invalid body', error_code: 'INVALID_BODY' }, 400);
  }

  const perso = readPersoConfig(c.env);
  const voiceId = perso?.voiceIds[celebrity];
  if (!perso || !voiceId) {
    return c.json({ error: 'name clip not available', error_code: 'PERSO_NOT_CONFIGURED' }, 503);
  }

  const spoken = vocative(name, locale);
  // 키에 이름을 그대로 넣지 않는다(경로 조작·이상한 글자 차단, R2 키 길이 고정).
  const objectKey = `event/${eventId}/name-clips/${celebrity}/${locale}/${await sha256Hex(spoken)}.mp3`;
  const bucket = c.env.VOICE_BUCKET;

  if (bucket) {
    const hit = await bucket.get(objectKey);
    if (hit) {
      return new Response(hit.body, {
        headers: audioHeaders(hit.httpMetadata?.contentType ?? 'audio/mpeg', 'hit'),
      });
    }
  }

  let clip;
  try {
    clip = await synthesizeName(perso, { voiceId, text: spoken, locale });
  } catch (err) {
    console.error('[event] name clip synthesis failed', err);
    return c.json({ error: 'synthesis failed', error_code: 'PERSO_FAILED' }, 502);
  }

  if (bucket) {
    // 저장 실패는 응답을 막지 않는다 — 다음 요청이 다시 만들 뿐이다.
    c.executionCtx.waitUntil(
      bucket
        .put(objectKey, clip.bytes, {
          httpMetadata: { contentType: clip.mimeType },
          customMetadata: { celebrity, locale, createdAt: new Date().toISOString() },
        })
        .catch((err) => console.error('[event] name clip cache put failed', err)),
    );
  }
  return new Response(clip.bytes, {
    headers: audioHeaders(clip.mimeType, bucket ? 'miss' : 'none'),
  });
});

export default event;
