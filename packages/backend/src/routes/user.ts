import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { logRouteError } from '../lib/logger';

const user = new Hono<AppEnv>();

user.get('/me', async (c) => {
  const userId = c.get('userId');
  const email = c.get('userEmail') || '';
  const name = c.get('userName') || '';
  const picture = c.get('userPicture') || '';
  const db = getDB(c.env);

  try {
    let result = await db.execute({
      sql: 'SELECT * FROM users WHERE google_id = ?',
      args: [userId],
    });

    if (result.rows.length === 0) {
      const id = crypto.randomUUID();
      const today = new Date().toISOString().split('T')[0]!;
      await db.execute({
        sql: `INSERT INTO users (id, google_id, firebase_uid, email, name, picture, daily_tts_reset_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [id, userId, userId, email, name, picture, today],
      });
      result = await db.execute({
        sql: 'SELECT * FROM users WHERE id = ?',
        args: [id],
      });
    }

    const u = result.rows[0]!;
    const [profileCount, alarmCount] = await Promise.all([
      db.execute({
        sql: 'SELECT COUNT(*) as count FROM voice_profiles WHERE user_id = ?',
        args: [userId],
      }),
      db.execute({
        sql: 'SELECT COUNT(*) as count FROM alarms WHERE user_id = ?',
        args: [userId],
      }),
      db.execute({
        sql: "UPDATE users SET last_active_at = datetime('now') WHERE google_id = ?",
        args: [userId],
      }),
    ]);

    return c.json({
      user: {
        ...u,
        allow_family_alarms: Number(u.allow_family_alarms ?? 0) === 1,
      },
      stats: {
        voice_profiles: Number(profileCount.rows[0]?.count ?? 0),
        alarms: Number(alarmCount.rows[0]?.count ?? 0),
      },
    });
  } catch (err) {
    logRouteError(c, err);
    const detail = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'Failed to fetch user info', error_code: 'FETCH_USER_FAILED', detail }, 500);
  }
});

function toBoolFlag(raw: unknown): 0 | 1 | null {
  if (raw === true || raw === 1 || raw === '1' || raw === 'true') return 1;
  if (raw === false || raw === 0 || raw === '0' || raw === 'false') return 0;
  return null;
}

/**
 * PATCH /user/me { allow_family_alarms }
 * 본인 프로필 토글 필드 업데이트. 현재는 allow_family_alarms 만 지원.
 */
user.patch('/me', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const body = await c.req
    .json<{ allow_family_alarms?: unknown }>()
    .catch(() => ({ allow_family_alarms: undefined }));

  if (!('allow_family_alarms' in body) || body.allow_family_alarms === undefined) {
    return c.json({ error: '변경할 필드가 없습니다', error_code: 'NO_FIELDS_TO_UPDATE' }, 400);
  }
  const flag = toBoolFlag(body.allow_family_alarms);
  if (flag === null) {
    return c.json({ error: 'allow_family_alarms 는 boolean 이어야 합니다', error_code: 'INVALID_BOOLEAN' }, 400);
  }

  const result = await db.execute({
    sql: `UPDATE users SET allow_family_alarms = ?, updated_at = datetime('now')
          WHERE google_id = ?`,
    args: [flag, userId],
  });
  if (result.rowsAffected === 0) {
    return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  }

  return c.json({ success: true, allow_family_alarms: flag === 1 });
});

user.patch('/plan', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const body = await c.req.json<{ plan: 'free' | 'plus' | 'family' }>();

    if (!['free', 'plus', 'family'].includes(body.plan)) {
      return c.json({ error: 'Invalid plan', error_code: 'INVALID_PLAN' }, 400);
    }

    const result = await db.execute({
      sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE google_id = ?`,
      args: [body.plan, userId],
    });

    if (result.rowsAffected === 0) {
      return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
    }

    return c.json({ success: true, plan: body.plan });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to update plan', error_code: 'UPDATE_PLAN_FAILED' }, 500);
  }
});

user.delete('/me', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const tables = [
      'DELETE FROM alarms WHERE user_id = ?',
      'DELETE FROM message_library WHERE user_id = ?',
      'DELETE FROM messages WHERE user_id = ?',
      'DELETE FROM voice_profiles WHERE user_id = ?',
      "DELETE FROM friendships WHERE user_a = ? OR user_b = ?",
      "DELETE FROM gifts WHERE sender_id = ? OR recipient_id = ?",
      'DELETE FROM users WHERE google_id = ?',
    ];

    for (const sql of tables) {
      const needsTwoArgs = sql.includes('OR');
      await db.execute({ sql, args: needsTwoArgs ? [userId, userId] : [userId] });
    }

    return c.json({ success: true });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to delete account', error_code: 'DELETE_ACCOUNT_FAILED' }, 500);
  }
});

user.get('/search', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const q = (c.req.query('q') || '').trim();

  if (q.length < 2) {
    return c.json({ users: [] });
  }

  try {
    const result = await db.execute({
      sql: `SELECT google_id, email, name, picture FROM users
            WHERE google_id != ? AND email LIKE ?
            LIMIT 10`,
      args: [userId, `%${q}%`],
    });

    return c.json({
      users: result.rows.map((r) => ({
        id: r.google_id,
        email: r.email,
        name: r.name,
        picture: r.picture,
      })),
    });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Search failed', error_code: 'SEARCH_FAILED' }, 500);
  }
});

export default user;
