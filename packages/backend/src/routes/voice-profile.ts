import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ElevenLabsClient } from '../lib/elevenlabs';
import { getDB } from '../lib/db';
import { typedRow, getFormFile } from '../lib/db-types';
import { UUID_RE } from '../lib/validate';
import { logRouteError } from '../lib/logger';

const voiceProfile = new Hono<AppEnv>();
const MAX_VOICE_PROFILES = 2;

voiceProfile.get('/', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
  const status = c.req.query('status');

  const validStatuses = ['ready', 'processing', 'failed'];
  let statusClause = '';
  const baseArgs: (string | number)[] = [userId];
  if (status && validStatuses.includes(status)) {
    statusClause = ' AND status = ?';
    baseArgs.push(status);
  }

  const [countRes, result] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as total FROM voice_profiles WHERE user_id = ?${statusClause}`,
      args: baseArgs,
    }),
    db.execute({
      sql: `SELECT * FROM voice_profiles WHERE user_id = ?${statusClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      args: [...baseArgs, limit, offset],
    }),
  ]);

  const total = Number(countRes.rows[0].total);
  return c.json({ profiles: result.rows, total, limit, offset });
});

voiceProfile.get('/family', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const memberRes = await db.execute({
    sql: `SELECT fm2.user_id
          FROM family_members fm1
          JOIN family_members fm2 ON fm1.group_id = fm2.group_id
          WHERE fm1.user_id = ? AND fm2.user_id != ?`,
    args: [userId, userId],
  });

  if (memberRes.rows.length === 0) {
    return c.json({ profiles: [] });
  }

  const memberIds = memberRes.rows.map((r) => typedRow<{ user_id: string }>(r).user_id);
  const placeholders = memberIds.map(() => '?').join(',');
  const voicesRes = await db.execute({
    sql: `SELECT vp.id, vp.name, vp.status, vp.created_at, vp.user_id, u.name as owner_name
          FROM voice_profiles vp
          LEFT JOIN users u ON vp.user_id = u.google_id
          WHERE vp.user_id IN (${placeholders}) AND vp.status = 'ready'
          ORDER BY vp.created_at DESC`,
    args: memberIds,
  });

  return c.json({ profiles: voicesRes.rows });
});

voiceProfile.get('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' }, 400);
  }

  const result = await db.execute({
    sql: 'SELECT * FROM voice_profiles WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });

  if (result.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  return c.json({ profile: result.rows[0] });
});

voiceProfile.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' }, 400);
  }

  let body: { name?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON body required', error_code: 'JSON_BODY_REQUIRED' }, 400);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length === 0 || name.length > 50) {
    return c.json({ error: 'name must be 1-50 characters', error_code: 'INVALID_NAME_LENGTH' }, 400);
  }

  const existing = await db.execute({
    sql: 'SELECT id FROM voice_profiles WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });
  if (existing.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  await db.execute({
    sql: "UPDATE voice_profiles SET name = ?, updated_at = datetime('now') WHERE id = ?",
    args: [name, id],
  });

  return c.json({ profile: { id, name } });
});

voiceProfile.post('/clone', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const profileCount = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM voice_profiles WHERE user_id = ?',
      args: [userId],
    });
    const count = Number(profileCount.rows[0].count);
    if (count >= MAX_VOICE_PROFILES) {
      return c.json(
        {
          error: 'VOICE_LIMIT_REACHED',
          error_code: 'VOICE_LIMIT_REACHED',
          message: `최대 ${MAX_VOICE_PROFILES}개까지 등록 가능합니다`,
        },
        403,
      );
    }

    const formData = await c.req.formData();
    const audioFile = getFormFile(formData, 'audio');
    const name = formData.get('name') as string | null;
    if (!audioFile || !name) {
      return c.json({ error: 'audio file and name are required', error_code: 'AUDIO_AND_NAME_REQUIRED' }, 400);
    }

    if (name.length > 50) {
      return c.json({ error: 'Name must be 50 characters or less', error_code: 'NAME_TOO_LONG' }, 400);
    }

    const audioBuffer = await audioFile.arrayBuffer();
    const profileId = crypto.randomUUID();

    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, status)
            VALUES (?, ?, ?, 'processing')`,
      args: [profileId, userId, name],
    });

    const client = new ElevenLabsClient(c.env.ELEVENLABS_API_KEY);
    const result = await client.createInstantClone(audioBuffer, name);
    const voiceId = result.voice_id;

    await db.execute({
      sql: `UPDATE voice_profiles SET elevenlabs_voice_id = ?, status = 'ready', updated_at = datetime('now')
            WHERE id = ?`,
      args: [voiceId, profileId],
    });

    return c.json(
      {
        profile: {
          id: profileId,
          name,
          voice_id: voiceId,
          status: 'ready',
        },
      },
      201,
    );
  } catch (err) {
    logRouteError(c, err);
    const detail = err instanceof Error ? err.message : 'Unknown error';

    return c.json(
      {
        error: 'Voice cloning failed',
        error_code: 'VOICE_CLONING_FAILED',
        detail,
      },
      500,
    );
  }
});

voiceProfile.get('/:id/stats', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' }, 400);
  }

  const [profileRes, msgRes, alarmRes] = await Promise.all([
    db.execute({
      sql: 'SELECT id, name FROM voice_profiles WHERE id = ? AND user_id = ?',
      args: [id, userId],
    }),
    db.execute({
      sql: 'SELECT COUNT(*) as count FROM messages WHERE voice_profile_id = ? AND user_id = ?',
      args: [id, userId],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as count FROM alarms a
            JOIN messages m ON a.message_id = m.id
            WHERE m.voice_profile_id = ? AND (a.user_id = ? OR a.target_user_id = ?)`,
      args: [id, userId, userId],
    }),
  ]);

  if (profileRes.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  return c.json({
    voice_profile_id: id,
    messages: Number(typedRow<{ count: number }>(msgRes.rows[0]).count ?? 0),
    alarms: Number(typedRow<{ count: number }>(alarmRes.rows[0]).count ?? 0),
  });
});

voiceProfile.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' }, 400);
  }

  const result = await db.execute({
    sql: 'SELECT * FROM voice_profiles WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });

  if (result.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  const profile = result.rows[0];

  const msgCheck = await db.execute({
    sql: 'SELECT COUNT(*) as cnt FROM messages WHERE voice_profile_id = ?',
    args: [id],
  });
  const msgCount = Number(typedRow<{ cnt: number }>(msgCheck.rows[0]).cnt ?? 0);

  if (msgCount > 0 && c.req.query('force') !== 'true') {
    return c.json(
      {
        warning: true,
        error_code: 'VOICE_PROFILE_IN_USE',
        message_count: msgCount,
        message: `This voice profile has ${msgCount} message(s). Add ?force=true to delete anyway.`,
      },
      409,
    );
  }

  try {
    if (profile.elevenlabs_voice_id) {
      const client = new ElevenLabsClient(c.env.ELEVENLABS_API_KEY);
      await client.deleteVoice(profile.elevenlabs_voice_id as string);
    }
  } catch {
    // 외부 API 삭제 실패해도 로컬은 삭제 진행
  }

  if (msgCount > 0) {
    await db.execute({
      sql: 'DELETE FROM alarms WHERE message_id IN (SELECT id FROM messages WHERE voice_profile_id = ?)',
      args: [id],
    });
    await db.execute({
      sql: 'DELETE FROM message_library WHERE message_id IN (SELECT id FROM messages WHERE voice_profile_id = ?)',
      args: [id],
    });
    await db.execute({
      sql: 'DELETE FROM messages WHERE voice_profile_id = ?',
      args: [id],
    });
  }

  await db.execute({
    sql: 'DELETE FROM voice_profiles WHERE id = ?',
    args: [id],
  });

  return c.json({ success: true, messages_deleted: msgCount });
});

export default voiceProfile;
