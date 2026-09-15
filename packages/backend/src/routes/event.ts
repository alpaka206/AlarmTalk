import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';

// 랜딩 이벤트 페이지(alarm-talk.com/event/<id>/)의 공개 좋아요 카운터. 인증 없음.
//
//   GET  /api/event/:eventId/likes              → { likes: { <subjectId>: count, ... } }
//   POST /api/event/:eventId/likes/:subjectId   → { count }   (누른 횟수만큼 1 씩 더한다)
//
// 행은 마이그레이션이 시드한다(#119). POST 는 있는 행만 UPDATE 하므로 모르는 id 는 404 이고
// 스팸이 행을 만들어 내지 못한다. 남용 방어는 IP 버킷(index.ts 의 eventLikeRateLimitMiddleware).
// id 는 짧은 슬러그만 받는다 — 값은 예외 없이 `?` 바인딩.

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

export default event;
