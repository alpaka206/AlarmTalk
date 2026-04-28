import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';

const push = new Hono<AppEnv>();

push.post('/token', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  let body: { token?: unknown; platform?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON body required', error_code: 'JSON_BODY_REQUIRED' }, 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const platform = typeof body.platform === 'string' ? body.platform.trim() : '';

  if (token.length === 0 || token.length > 500) {
    return c.json({ error: 'token must be 1-500 characters', error_code: 'INVALID_TOKEN_LENGTH' }, 400);
  }
  if (!['ios', 'android', 'web'].includes(platform)) {
    return c.json({ error: 'platform must be ios, android, or web', error_code: 'INVALID_PLATFORM' }, 400);
  }

  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO push_tokens (id, user_id, token, platform)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (user_id, token) DO UPDATE SET
            platform = excluded.platform,
            updated_at = datetime('now')`,
    args: [id, userId, token, platform],
  });

  return c.json({ success: true }, 201);
});

push.delete('/token', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  let body: { token?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON body required', error_code: 'JSON_BODY_REQUIRED' }, 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (token.length === 0) {
    return c.json({ error: 'token is required', error_code: 'TOKEN_REQUIRED' }, 400);
  }

  await db.execute({
    sql: 'DELETE FROM push_tokens WHERE user_id = ? AND token = ?',
    args: [userId, token],
  });

  return c.json({ success: true });
});

export default push;
