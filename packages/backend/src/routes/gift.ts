import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { UUID_RE } from '../lib/validate';
import { logRouteError } from '../lib/logger';

const gift = new Hono<AppEnv>();

async function areFriends(
  db: import('@libsql/client/web').Client,
  userA: string,
  userB: string,
): Promise<boolean> {
  const result = await db.execute({
    sql: `SELECT id FROM friendships
          WHERE ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))
            AND status = 'accepted'`,
    args: [userA, userB, userB, userA],
  });
  return result.rows.length > 0;
}

/** 선물 보내기 */
gift.post('/', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const body = await c.req.json<{
      recipient_email: string;
      message_id: string;
      note?: string;
    }>();

    if (!body.recipient_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.recipient_email)) {
      return c.json({ error: '유효한 이메일 주소를 입력해주세요.' }, 400);
    }
    if (!body.message_id || !UUID_RE.test(body.message_id)) {
      return c.json({ error: 'Invalid or missing message_id' }, 400);
    }
    if (body.note && body.note.length > 200) {
      return c.json({ error: '메모는 200자 이내로 작성해주세요.' }, 400);
    }

    const recipient = await db.execute({
      sql: 'SELECT google_id FROM users WHERE email = ?',
      args: [body.recipient_email],
    });

    if (recipient.rows.length === 0) {
      return c.json({ error: '받는 사람을 찾을 수 없습니다.' }, 404);
    }

    const recipientId = recipient.rows[0].google_id as string;

    if (recipientId === userId) {
      return c.json({ error: '자기 자신에게는 선물할 수 없습니다.' }, 400);
    }

    if (!(await areFriends(db, userId, recipientId))) {
      return c.json({ error: '친구 관계인 사용자에게만 선물할 수 있습니다.' }, 403);
    }

    const msg = await db.execute({
      sql: 'SELECT id FROM messages WHERE id = ? AND user_id = ?',
      args: [body.message_id, userId],
    });
    if (msg.rows.length === 0) {
      return c.json({ error: 'Message not found' }, 404);
    }

    const id = crypto.randomUUID();
    await db.execute({
      sql: 'INSERT INTO gifts (id, sender_id, recipient_id, message_id, status, note) VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, userId, recipientId, body.message_id, 'pending', body.note ?? null],
    });

    return c.json({ gift: { id, message_id: body.message_id, status: 'pending' } }, 201);
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to send gift' }, 500);
  }
});

/** 받은 선물 목록 */
gift.get('/received', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
    const q = c.req.query('q')?.trim().toLowerCase();

    let searchClause = '';
    const searchArgs: string[] = [];
    if (q) {
      searchClause = ' AND (LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(m.text) LIKE ?)';
      const pattern = `%${q}%`;
      searchArgs.push(pattern, pattern, pattern);
    }

    const [countRes, result] = await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) as total FROM gifts g
              JOIN messages m ON g.message_id = m.id
              JOIN users u ON u.google_id = g.sender_id
              WHERE g.recipient_id = ?${searchClause}`,
        args: [userId, ...searchArgs],
      }),
      db.execute({
        sql: `SELECT g.*, m.text as message_text, m.audio_url, m.category,
                u.email as sender_email, u.name as sender_name, u.picture as sender_picture
              FROM gifts g
              JOIN messages m ON g.message_id = m.id
              JOIN users u ON u.google_id = g.sender_id
              WHERE g.recipient_id = ?${searchClause}
              ORDER BY g.created_at DESC
              LIMIT ? OFFSET ?`,
        args: [userId, ...searchArgs, limit, offset],
      }),
    ]);

    const total = Number(countRes.rows[0]?.total ?? 0);
    return c.json({ gifts: result.rows, total, limit, offset });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to fetch received gifts' }, 500);
  }
});

/** 보낸 선물 목록 */
gift.get('/sent', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
    const q = c.req.query('q')?.trim().toLowerCase();

    let searchClause = '';
    const searchArgs: string[] = [];
    if (q) {
      searchClause = ' AND (LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(m.text) LIKE ?)';
      const pattern = `%${q}%`;
      searchArgs.push(pattern, pattern, pattern);
    }

    const [countRes, result] = await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) as total FROM gifts g
              JOIN messages m ON g.message_id = m.id
              JOIN users u ON u.google_id = g.recipient_id
              WHERE g.sender_id = ?${searchClause}`,
        args: [userId, ...searchArgs],
      }),
      db.execute({
        sql: `SELECT g.*, m.text as message_text, m.category,
                u.email as recipient_email, u.name as recipient_name
              FROM gifts g
              JOIN messages m ON g.message_id = m.id
              JOIN users u ON u.google_id = g.recipient_id
              WHERE g.sender_id = ?${searchClause}
              ORDER BY g.created_at DESC
              LIMIT ? OFFSET ?`,
        args: [userId, ...searchArgs, limit, offset],
      }),
    ]);

    const total = Number(countRes.rows[0]?.total ?? 0);
    return c.json({ gifts: result.rows, total, limit, offset });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to fetch sent gifts' }, 500);
  }
});

/** 선물 수락 */
gift.patch('/:id/accept', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid gift ID format' }, 400);
  }

  try {
    const existing = await db.execute({
      sql: "SELECT id, message_id FROM gifts WHERE id = ? AND recipient_id = ? AND status = 'pending'",
      args: [id, userId],
    });

    if (existing.rows.length === 0) {
      return c.json({ error: 'Pending gift not found' }, 404);
    }

    await db.execute({
      sql: "UPDATE gifts SET status = 'accepted' WHERE id = ?",
      args: [id],
    });

    const libId = crypto.randomUUID();
    await db.execute({
      sql: 'INSERT INTO message_library (id, user_id, message_id) VALUES (?, ?, ?)',
      args: [libId, userId, existing.rows[0].message_id],
    });

    const updated = await db.execute({
      sql: `SELECT id, sender_id, recipient_id, message_id, status, note, created_at
            FROM gifts WHERE id = ?`,
      args: [id],
    });

    return c.json({ success: true, gift: updated.rows[0] });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to accept gift' }, 500);
  }
});

/** 선물 거절 */
gift.patch('/:id/reject', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid gift ID format' }, 400);
  }

  try {
    const existing = await db.execute({
      sql: "SELECT id FROM gifts WHERE id = ? AND recipient_id = ? AND status = 'pending'",
      args: [id, userId],
    });

    if (existing.rows.length === 0) {
      return c.json({ error: 'Pending gift not found' }, 404);
    }

    await db.execute({
      sql: "UPDATE gifts SET status = 'rejected' WHERE id = ?",
      args: [id],
    });

    const updated = await db.execute({
      sql: `SELECT id, sender_id, recipient_id, message_id, status, note, created_at
            FROM gifts WHERE id = ?`,
      args: [id],
    });

    return c.json({ success: true, gift: updated.rows[0] });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to reject gift' }, 500);
  }
});

export default gift;
