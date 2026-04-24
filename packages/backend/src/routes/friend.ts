import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { UUID_RE } from '../lib/validate';
import { logRouteError } from '../lib/logger';

const friend = new Hono<AppEnv>();

/** 이메일로 친구 요청 */
friend.post('/', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const body = await c.req.json<{ email: string }>();

    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return c.json({ error: '유효한 이메일 주소를 입력해주세요.' }, 400);
    }

    const target = await db.execute({
      sql: 'SELECT google_id, email, name FROM users WHERE email = ?',
      args: [body.email],
    });

    if (target.rows.length === 0) {
      return c.json({ error: '해당 이메일의 사용자를 찾을 수 없습니다.' }, 404);
    }

    const targetUserId = target.rows[0].google_id as string;

    if (targetUserId === userId) {
      return c.json({ error: '자기 자신에게는 친구 요청을 보낼 수 없습니다.' }, 400);
    }

    const existing = await db.execute({
      sql: `SELECT id, status FROM friendships
            WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)`,
      args: [userId, targetUserId, targetUserId, userId],
    });

    if (existing.rows.length > 0) {
      const status = existing.rows[0].status;
      if (status === 'accepted') {
        return c.json({ error: '이미 친구입니다.' }, 409);
      }
      if (status === 'pending') {
        return c.json({ error: '이미 친구 요청이 대기 중입니다.' }, 409);
      }
    }

    const id = crypto.randomUUID();
    await db.execute({
      sql: 'INSERT INTO friendships (id, user_a, user_b, status) VALUES (?, ?, ?, ?)',
      args: [id, userId, targetUserId, 'pending'],
    });

    return c.json(
      {
        friendship: {
          id,
          user_a: userId,
          user_b: targetUserId,
          target_email: target.rows[0].email,
          target_name: target.rows[0].name,
          status: 'pending',
        },
      },
      201,
    );
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to send friend request' }, 500);
  }
});

/** 친구 목록 (수락된 친구만) */
friend.get('/list', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
    const q = (c.req.query('q') || '').trim();

    let searchClause = '';
    const baseArgs: (string | number)[] = [userId, userId, userId];
    const searchArgs: (string | number)[] = [];

    if (q) {
      searchClause = ' AND (u.name LIKE ? OR u.email LIKE ?)';
      const pattern = `%${q}%`;
      searchArgs.push(pattern, pattern);
    }

    const [countRes, result] = await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) as total FROM friendships f
              JOIN users u ON u.google_id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
              WHERE (f.user_a = ? OR f.user_b = ?) AND f.status = 'accepted'${searchClause}`,
        args: [...baseArgs, ...searchArgs],
      }),
      db.execute({
        sql: `SELECT f.id, f.user_a, f.user_b, f.created_at,
                u.email as friend_email, u.name as friend_name, u.picture as friend_picture,
                u.last_active_at as friend_last_active_at
              FROM friendships f
              JOIN users u ON u.google_id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
              WHERE (f.user_a = ? OR f.user_b = ?) AND f.status = 'accepted'${searchClause}
              ORDER BY f.created_at DESC
              LIMIT ? OFFSET ?`,
        args: [...baseArgs, ...searchArgs, limit, offset],
      }),
    ]);

    const total = Number(countRes.rows[0]?.total ?? 0);
    return c.json({ friends: result.rows, total, limit, offset });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to fetch friends' }, 500);
  }
});

/** 대기 중인 친구 요청 (내가 받은 것) */
friend.get('/pending', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);

    const [countRes, result] = await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) as total FROM friendships
              WHERE user_b = ? AND status = 'pending'`,
        args: [userId],
      }),
      db.execute({
        sql: `SELECT f.id, f.user_a, f.created_at,
                u.email as requester_email, u.name as requester_name, u.picture as requester_picture
              FROM friendships f
              JOIN users u ON u.google_id = f.user_a
              WHERE f.user_b = ? AND f.status = 'pending'
              ORDER BY f.created_at DESC
              LIMIT ? OFFSET ?`,
        args: [userId, limit, offset],
      }),
    ]);

    const total = Number(countRes.rows[0]?.total ?? 0);
    return c.json({ pending: result.rows, total, limit, offset });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to fetch pending requests' }, 500);
  }
});

/** 친구 요청 수락 */
friend.patch('/:id/accept', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid friendship ID format' }, 400);
  }

  try {
    const existing = await db.execute({
      sql: "SELECT id FROM friendships WHERE id = ? AND user_b = ? AND status = 'pending'",
      args: [id, userId],
    });

    if (existing.rows.length === 0) {
      return c.json({ error: 'Pending friend request not found' }, 404);
    }

    await db.execute({
      sql: "UPDATE friendships SET status = 'accepted' WHERE id = ?",
      args: [id],
    });

    const updated = await db.execute({
      sql: `SELECT f.id, f.user_a, f.user_b, f.status, f.created_at,
                   u.name, u.email, u.picture
            FROM friendships f
            JOIN users u ON u.google_id = f.user_a
            WHERE f.id = ?`,
      args: [id],
    });

    return c.json({ success: true, friendship: updated.rows[0] });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to accept friend request' }, 500);
  }
});

/** 친구 삭제 / 요청 거절 */
friend.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid friendship ID format' }, 400);
  }

  try {
    const result = await db.execute({
      sql: 'DELETE FROM friendships WHERE id = ? AND (user_a = ? OR user_b = ?)',
      args: [id, userId, userId],
    });

    if (result.rowsAffected === 0) {
      return c.json({ error: 'Friendship not found' }, 404);
    }

    return c.json({ success: true });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to delete friendship' }, 500);
  }
});

export default friend;
