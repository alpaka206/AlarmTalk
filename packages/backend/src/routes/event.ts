import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { getDB } from '../lib/db';
import { eventVoiceIds } from '@alarmtalk/shared';
import {
  isEventLocale,
  isEventMessageKind,
  renderMessage,
  sanitizeEventName,
  slotAt,
  voiceProjectFor,
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
//   POST /api/event/:eventId/clips  { celebrity, name, locale, kind }  → audio/mpeg (그 자리에서 만든 소리)
//
// 좋아요 대상은 `packages/shared/src/event-voices.json` 의 목소리 id 뿐이다 — 목록에 없는 id 는
// 404 라 스팸이 행을 만들어 내지 못하고, 목록에 있으면 첫 좋아요 때 행이 생긴다(시드 마이그레이션
// 없이 목소리를 더할 수 있게). 남용 방어는 IP 버킷(index.ts 의 eventLikeRateLimitMiddleware,
// 클립 생성은 더 좁은 eventClipRateLimitMiddleware). id 는 짧은 슬러그만 받는다 — 값은
// 예외 없이 `?` 바인딩.

const event = new Hono<AppEnv>();

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

event.get('/:eventId/likes', async (c) => {
  const eventId = c.req.param('eventId');
  if (!ID_RE.test(eventId)) {
    return jsonError(c, 400, 'INVALID_ID', 'invalid event id');
  }
  const ids = eventVoiceIds(eventId);
  if (ids.length === 0) return jsonError(c, 404, 'NOT_FOUND', 'unknown event');
  const db = getDB(c.env);
  const r = await db.execute({
    sql: 'SELECT subject_id, count FROM event_likes WHERE event_id = ? ORDER BY subject_id',
    args: [eventId],
  });
  // 아직 아무도 안 누른 목소리는 0 — 화면이 숫자를 지어내지 않고도 0 을 보여 줄 수 있게.
  const likes: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const row of r.rows) {
    const id = String(row.subject_id);
    if (id in likes) likes[id] = Number(row.count);
  }
  return c.json({ likes });
});

event.post('/:eventId/likes/:subjectId', async (c) => {
  const eventId = c.req.param('eventId');
  const subjectId = c.req.param('subjectId');
  if (!ID_RE.test(eventId) || !ID_RE.test(subjectId)) {
    return jsonError(c, 400, 'INVALID_ID', 'invalid id');
  }
  if (!eventVoiceIds(eventId).includes(subjectId)) {
    return jsonError(c, 404, 'NOT_FOUND', 'unknown subject');
  }
  const db = getDB(c.env);
  const r = await db.execute({
    sql: `INSERT INTO event_likes (event_id, subject_id, count) VALUES (?, ?, 1)
          ON CONFLICT(event_id, subject_id)
          DO UPDATE SET count = count + 1, updated_at = datetime('now') RETURNING count`,
    args: [eventId, subjectId],
  });
  return c.json({ count: Number(r.rows[0]?.count ?? 1) });
});

// ── 메시지 클립 ────────────────────────────────────────────────────────────────
//
// 이름이 들어간 문장 **전체**를 인물 목소리로 만든다(2026-09-16 결정 — 이름만 따로 만들어 붙이면
// 문맥이 없어 어색했다). 문장은 서버의 `lib/event-voices.ts` 가 정하고 클라는 {인물, 이름, 언어,
// 종류}만 보낸다 — 임의 문장을 인물 목소리로 읽히는 길을 두지 않는다.
//
// 만든 소리는 **그 응답으로** 바로 돌려주고 어디에도 두지 않는다(2026-09-16 지시: 서버에 남기지
// 않고 받는 사람 기기에만, 나가면 사라진다). 그래서 캐시도 없다 — 같은 이름을 두 번 만들면 두 번
// 만든다(Perso 쿼터는 차감되지 않았다). 생성은 10~30초 걸리므로 클라는 종류마다 따로 부른다.
//
// 슬롯: 프로젝트의 문장 전부를 DB 카운터로 돌려 쓴다(요청마다 다음 문장) — 같은 문장을 두 요청이
// 동시에 쓰면 서로 글자를 덮어쓰기 때문이다. 그래도 겹치면 `lib/perso.ts` 가 `PersoSlotRace` 로
// 알리고 여기서 다음 문장으로 다시 시도한다. 로컬(wrangler dev)에는 DB 가 없어 순번은 무작위다.

const MAX_SLOT_ATTEMPTS = 3;
/** 문장 목록을 isolate 안에서 들고 있는 시간. 문장을 새로 더하면 이만큼 뒤에 보인다. */
const SENTENCES_TTL_MS = 10 * 60_000;

const sentenceCache = new Map<number, { seqs: number[]; at: number }>();

/** 테스트용 — isolate 에 든 문장 목록을 비운다. */
export function resetEventCaches(): void {
  sentenceCache.clear();
}

async function sentencesFor(apiKey: string, voice: VoiceProject): Promise<number[]> {
  const hit = sentenceCache.get(voice.project);
  if (hit && Date.now() - hit.at < SENTENCES_TTL_MS) return hit.seqs;
  const seqs = await listSentenceSeqs(apiKey, voice.project, voice.spaceSeq);
  sentenceCache.set(voice.project, { seqs, at: Date.now() });
  return seqs;
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

  const voice = voiceProjectFor(eventId, celebrity, locale);
  if (voice === null) return jsonError(c, 404, 'NOT_FOUND', 'unknown voice');
  if (voice === undefined) {
    return jsonError(c, 503, 'VOICE_NOT_AVAILABLE', 'voice not available in this language');
  }
  const apiKey = c.env.PERSO_API_KEY;
  if (!apiKey) return jsonError(c, 503, 'PERSO_NOT_CONFIGURED', 'not configured');

  const message = renderMessage(kind, locale, name);

  let bytes: Uint8Array;
  try {
    const sentences = await sentencesFor(apiKey, voice);
    let persoPath: string | undefined;
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
    bytes = new Uint8Array(await (await fetchPersoMedia(persoPath)).arrayBuffer());
    // 빈 몸통이나 오류 페이지를 mp3 라고 내려보내지 않는다.
    if (bytes.byteLength < MIN_CLIP_BYTES || !looksLikeMp3(bytes)) {
      throw new Error(`Perso media is not an mp3 (${bytes.byteLength} bytes)`);
    }
  } catch (err) {
    console.error('[event] clip synthesis failed', err);
    return jsonError(c, 502, 'PERSO_FAILED', 'synthesis failed');
  }

  return new Response(bytes, {
    headers: {
      'content-type': 'audio/mpeg',
      'content-length': String(bytes.byteLength),
      'cache-control': 'no-store',
    },
  });
});

export default event;
