import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { sendNotePush } from '../lib/fcm';

const notes = new Hono<AppEnv>();

async function resolveUserPk(
  db: ReturnType<typeof getDB>,
  googleId: string,
): Promise<string | null> {
  const res = await db.execute({
    sql: 'SELECT id FROM users WHERE google_id = ?',
    args: [googleId],
  });
  return res.rows.length > 0 ? String(res.rows[0].id) : null;
}

notes.post('/', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const senderPk = await resolveUserPk(db, userId);
  if (!senderPk) return c.json({ error: '사용자를 찾을 수 없습니다' }, 404);

  const body = await c.req
    .json<{ receiver_id?: unknown; text?: unknown }>()
    .catch(() => ({ receiver_id: undefined, text: undefined }));

  const receiverId = typeof body.receiver_id === 'string' ? body.receiver_id.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!receiverId) return c.json({ error: 'receiver_id 는 필수입니다' }, 400);
  if (!text) return c.json({ error: 'text 는 필수입니다' }, 400);
  if (text.length > 500) return c.json({ error: 'text 는 최대 500자입니다' }, 400);
  if (receiverId === senderPk) return c.json({ error: '자기 자신에게는 보낼 수 없습니다' }, 400);

  const receiverRes = await db.execute({
    sql: 'SELECT id FROM users WHERE id = ?',
    args: [receiverId],
  });
  if (receiverRes.rows.length === 0) {
    return c.json({ error: '수신자를 찾을 수 없습니다' }, 404);
  }

  const memberCheck = await db.execute({
    sql: `SELECT pgm1.plan_group_id
          FROM plan_group_members pgm1
          JOIN plan_group_members pgm2
            ON pgm1.plan_group_id = pgm2.plan_group_id
          WHERE pgm1.user_id = ? AND pgm2.user_id = ?
          LIMIT 1`,
    args: [senderPk, receiverId],
  });
  if (memberCheck.rows.length === 0) {
    return c.json({ error: '같은 가족 그룹 멤버에게만 쪽지를 보낼 수 있습니다' }, 403);
  }

  const noteId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO notes (id, sender_id, receiver_id, text)
          VALUES (?, ?, ?, ?)`,
    args: [noteId, senderPk, receiverId, text],
  });

  const senderRow = await db.execute({
    sql: 'SELECT name, email FROM users WHERE id = ?',
    args: [senderPk],
  });
  const senderName =
    (senderRow.rows[0]?.name as string | null) ??
    (senderRow.rows[0]?.email as string | null) ??
    'Someone';
  const pushPromise = sendNotePush(db, receiverId, noteId, senderName);
  try {
    c.executionCtx.waitUntil(pushPromise);
  } catch {
    void pushPromise;
  }

  return c.json({
    success: true,
    note: {
      id: noteId,
      sender_id: senderPk,
      receiver_id: receiverId,
      text,
      audio_url: null,
      read_at: null,
      created_at: new Date().toISOString(),
    },
  }, 201);
});

notes.get('/received', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ notes: [] });

  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');
  const limit = Math.min(Math.max(Number(limitRaw) || 20, 1), 100);
  const offset = Math.max(Number(offsetRaw) || 0, 0);

  const result = await db.execute({
    sql: `SELECT n.id, n.sender_id, n.text, n.audio_url, n.read_at, n.created_at,
                 u.name AS sender_name, u.email AS sender_email, u.picture AS sender_picture
          FROM notes n
          JOIN users u ON u.id = n.sender_id
          WHERE n.receiver_id = ?
          ORDER BY n.created_at DESC
          LIMIT ? OFFSET ?`,
    args: [userPk, limit, offset],
  });

  return c.json({
    notes: result.rows.map((r) => ({
      id: String(r.id),
      sender_id: String(r.sender_id),
      sender_name: (r.sender_name as string | null) ?? null,
      sender_email: String(r.sender_email),
      sender_picture: (r.sender_picture as string | null) ?? null,
      text: String(r.text),
      audio_url: (r.audio_url as string | null) ?? null,
      read_at: (r.read_at as string | null) ?? null,
      created_at: String(r.created_at),
    })),
  });
});

notes.get('/sent', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ notes: [] });

  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');
  const limit = Math.min(Math.max(Number(limitRaw) || 20, 1), 100);
  const offset = Math.max(Number(offsetRaw) || 0, 0);

  const result = await db.execute({
    sql: `SELECT n.id, n.receiver_id, n.text, n.audio_url, n.read_at, n.created_at,
                 u.name AS receiver_name, u.email AS receiver_email
          FROM notes n
          JOIN users u ON u.id = n.receiver_id
          WHERE n.sender_id = ?
          ORDER BY n.created_at DESC
          LIMIT ? OFFSET ?`,
    args: [userPk, limit, offset],
  });

  return c.json({
    notes: result.rows.map((r) => ({
      id: String(r.id),
      receiver_id: String(r.receiver_id),
      receiver_name: (r.receiver_name as string | null) ?? null,
      receiver_email: String(r.receiver_email),
      text: String(r.text),
      audio_url: (r.audio_url as string | null) ?? null,
      read_at: (r.read_at as string | null) ?? null,
      created_at: String(r.created_at),
    })),
  });
});

notes.patch('/:id/read', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const noteId = c.req.param('id');

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ error: '사용자를 찾을 수 없습니다' }, 404);

  const noteRes = await db.execute({
    sql: 'SELECT id, receiver_id, read_at FROM notes WHERE id = ?',
    args: [noteId],
  });
  if (noteRes.rows.length === 0) {
    return c.json({ error: '쪽지를 찾을 수 없습니다' }, 404);
  }
  if (String(noteRes.rows[0].receiver_id) !== userPk) {
    return c.json({ error: '권한이 없습니다' }, 403);
  }
  if (noteRes.rows[0].read_at) {
    return c.json({ success: true, already_read: true });
  }

  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE notes SET read_at = ? WHERE id = ?`,
    args: [now, noteId],
  });

  return c.json({ success: true, read_at: now });
});

export default notes;
