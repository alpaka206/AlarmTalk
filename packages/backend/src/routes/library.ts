import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { UUID_RE } from '../lib/validate';
import { logRouteError } from '../lib/logger';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const library = new Hono<AppEnv>();

/** 라이브러리 목록 조회 */
library.get('/', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const filter = c.req.query('filter');
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);

    let whereClause = `WHERE ml.user_id = ?
      AND vp.deleted_at IS NULL
      AND COALESCE(vp.is_draft, 0) = 0`;
    const filterArgs: (string | number)[] = [userId];

    if (filter === 'favorite') {
      whereClause += ' AND ml.is_favorite = 1';
    } else if (filter?.startsWith('voice:')) {
      const voiceId = filter.slice(6);
      if (!UUID_RE.test(voiceId)) {
        return c.json(
          { error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' },
          400,
        );
      }
      whereClause += ' AND m.voice_profile_id = ?';
      filterArgs.push(voiceId);
    } else if (filter?.startsWith('date:')) {
      const dateStr = filter.slice(5);
      if (!DATE_RE.test(dateStr)) {
        return c.json(
          { error: 'Invalid date format. Use YYYY-MM-DD', error_code: 'INVALID_DATE_FORMAT' },
          400,
        );
      }
      whereClause += ' AND date(ml.received_at) = ?';
      filterArgs.push(dateStr);
    }

    const [countRes, result] = await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) as total
              FROM message_library ml
              JOIN messages m ON ml.message_id = m.id
              JOIN voice_profiles vp ON m.voice_profile_id = vp.id
              ${whereClause}`,
        args: filterArgs,
      }),
      db.execute({
        sql: `SELECT ml.*, m.text, m.category, m.created_at as message_created_at,
               vp.name as voice_name, vp.avatar_url
               FROM message_library ml
               JOIN messages m ON ml.message_id = m.id
               JOIN voice_profiles vp ON m.voice_profile_id = vp.id
               ${whereClause}
               ORDER BY ml.received_at DESC
               LIMIT ? OFFSET ?`,
        args: [...filterArgs, limit, offset],
      }),
    ]);

    const total = Number(countRes.rows[0]?.total ?? 0);
    return c.json({ items: result.rows, total, limit, offset });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to fetch library', error_code: 'FETCH_LIBRARY_FAILED' }, 500);
  }
});

/** 즐겨찾기 토글 */
library.patch('/:id/favorite', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json(
      { error: 'Invalid library item ID format', error_code: 'INVALID_LIBRARY_ITEM_ID' },
      400,
    );
  }

  try {
    const result = await db.execute({
      sql: 'SELECT is_favorite FROM message_library WHERE id = ? AND user_id = ?',
      args: [id, userId],
    });

    if (result.rows.length === 0) {
      return c.json({ error: 'Library item not found', error_code: 'LIBRARY_ITEM_NOT_FOUND' }, 404);
    }

    const newValue = Number(result.rows[0]!.is_favorite) === 1 ? 0 : 1;
    await db.execute({
      sql: 'UPDATE message_library SET is_favorite = ? WHERE id = ?',
      args: [newValue, id],
    });

    return c.json({ is_favorite: newValue === 1 });
  } catch (err) {
    logRouteError(c, err);
    return c.json(
      { error: 'Failed to toggle favorite', error_code: 'TOGGLE_FAVORITE_FAILED' },
      500,
    );
  }
});

/** 라이브러리 항목 삭제 */
library.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json(
      { error: 'Invalid library item ID format', error_code: 'INVALID_LIBRARY_ITEM_ID' },
      400,
    );
  }

  try {
    const result = await db.execute({
      sql: 'DELETE FROM message_library WHERE id = ? AND user_id = ?',
      args: [id, userId],
    });

    if (result.rowsAffected === 0) {
      return c.json({ error: 'Library item not found', error_code: 'LIBRARY_ITEM_NOT_FOUND' }, 404);
    }

    return c.json({ ok: true });
  } catch (err) {
    logRouteError(c, err);
    return c.json(
      { error: 'Failed to delete library item', error_code: 'DELETE_LIBRARY_ITEM_FAILED' },
      500,
    );
  }
});

export default library;
