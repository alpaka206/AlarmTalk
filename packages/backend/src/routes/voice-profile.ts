import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ElevenLabsClient } from '../lib/elevenlabs';
import { getDB } from '../lib/db';
import { typedRow, getFormFile } from '../lib/db-types';
import { UUID_RE } from '../lib/validate';
import { logRouteError } from '../lib/logger';
import { createEnrollmentAttempts, UnsupportedVoiceProviderError } from '../lib/voice-provider';

const voiceProfile = new Hono<AppEnv>();
const MAX_VOICE_PROFILES = 1;

/**
 * Dev/cleanup helper: delete every voice profile (and its dependent
 * messages + alarms) belonging to the calling user. Useful for wiping
 * failed clones that piled up during testing. R2 objects are left for
 * the periodic cleanup cron — only DB rows go away here.
 */
voiceProfile.delete('/_dev/clear-mine', async (c) => {
  const subId = c.get('userId') as string;
  const pkId = (c.get('userIdPK') as string | undefined) ?? subId;
  const db = getDB(c.env);
  const ids = Array.from(new Set([subId, pkId].filter(Boolean)));
  const ph = ids.map(() => '?').join(',');
  const counts: Record<string, number> = {};
  const tryDel = async (label: string, sql: string, args: (string | number)[] = []) => {
    try {
      const r = await db.execute({ sql, args });
      counts[label] = r.rowsAffected ?? 0;
    } catch (err) {
      // Best-effort cleanup. Tables may not exist in every environment
      // (e.g. characters added via later migration). Log and continue.
      // eslint-disable-next-line no-console
      console.log('[clear-mine skip]', label, err instanceof Error ? err.message : String(err));
      counts[label] = -1;
    }
  };

  // 1) Tables that reference messages or voice_profiles (delete first).
  await tryDel(
    'gifts',
    `DELETE FROM gifts WHERE sender_id IN (${ph}) OR recipient_id IN (${ph})
     OR message_id IN (SELECT id FROM messages WHERE user_id IN (${ph}))`,
    [...ids, ...ids, ...ids],
  );
  await tryDel(
    'message_library',
    `DELETE FROM message_library WHERE user_id IN (${ph})
     OR message_id IN (SELECT id FROM messages WHERE user_id IN (${ph}))`,
    [...ids, ...ids],
  );
  await tryDel(
    'generated_audio_assets',
    `DELETE FROM generated_audio_assets WHERE user_id IN (${ph})
     OR message_id IN (SELECT id FROM messages WHERE user_id IN (${ph}))
     OR voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (${ph}))`,
    [...ids, ...ids, ...ids],
  );
  await tryDel(
    'dub_jobs',
    `DELETE FROM dub_jobs WHERE user_id IN (${ph})`,
    ids,
  );
  await tryDel(
    'notes',
    `DELETE FROM notes WHERE sender_id IN (${ph}) OR receiver_id IN (${ph})`,
    [...ids, ...ids],
  );
  await tryDel(
    'alarms',
    `DELETE FROM alarms WHERE user_id IN (${ph}) OR target_user_id IN (${ph})
     OR message_id IN (SELECT id FROM messages WHERE user_id IN (${ph}))
     OR voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (${ph}))`,
    [...ids, ...ids, ...ids, ...ids],
  );

  // 2) Now safe to drop messages + voice_profiles.
  await tryDel(
    'messages',
    `DELETE FROM messages WHERE user_id IN (${ph})
     OR voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (${ph}))`,
    [...ids, ...ids],
  );
  await tryDel(
    'voice_profiles',
    `DELETE FROM voice_profiles WHERE user_id IN (${ph})`,
    ids,
  );

  // 3) Per-user satellite tables.
  await tryDel('characters', `DELETE FROM characters WHERE user_id IN (${ph})`, ids);
  await tryDel('character_xp_logs', `DELETE FROM character_xp_logs WHERE user_id IN (${ph})`, ids);
  await tryDel(
    'character_streak_stats',
    `DELETE FROM character_streak_stats WHERE user_id IN (${ph})`,
    ids,
  );
  await tryDel('push_tokens', `DELETE FROM push_tokens WHERE user_id IN (${ph})`, ids);
  await tryDel(
    'friendships',
    `DELETE FROM friendships WHERE user_a IN (${ph}) OR user_b IN (${ph})`,
    [...ids, ...ids],
  );
  await tryDel(
    'voice_speakers',
    `DELETE FROM voice_speakers WHERE upload_id IN (SELECT id FROM voice_uploads WHERE user_id IN (${ph}))`,
    ids,
  );
  await tryDel('voice_uploads', `DELETE FROM voice_uploads WHERE user_id IN (${ph})`, ids);

  // 4) Finally the users row(s).
  await tryDel(
    'users',
    `DELETE FROM users WHERE google_id = ? OR id IN (${ph})`,
    [subId, ...ids],
  );

  return c.json({
    deleted: counts,
    note: '다음 요청 시 auth middleware가 users 행을 새로 만듭니다 (id=google_id).',
  });
});

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
      sql: `SELECT COUNT(*) as total FROM voice_profiles WHERE user_id = ? AND deleted_at IS NULL${statusClause}`,
      args: baseArgs,
    }),
    db.execute({
      sql: `SELECT * FROM voice_profiles WHERE user_id = ? AND deleted_at IS NULL${statusClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      args: [...baseArgs, limit, offset],
    }),
  ]);

  const total = Number(countRes.rows[0]!.total);
  return c.json({
    profiles: result.rows.map((row) => ({
      ...row,
      is_shared: Boolean(Number(row.is_shared ?? 0)),
    })),
    total,
    limit,
    offset,
  });
});

voiceProfile.get('/family', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const memberRes = await db.execute({
    sql: `SELECT DISTINCT fm2.user_id AS member_user_id, u.google_id AS member_google_id
          FROM users me
          JOIN plan_group_members fm1 ON fm1.user_id = me.id
          JOIN plan_group_members fm2 ON fm1.plan_group_id = fm2.plan_group_id
          LEFT JOIN users u ON u.id = fm2.user_id
          WHERE me.google_id = ? AND fm2.user_id != me.id AND fm2.user_id != ?`,
    args: [userId, userId],
  });

  if (memberRes.rows.length === 0) {
    return c.json({ profiles: [] });
  }

  const memberIds = Array.from(
    new Set(
      memberRes.rows.flatMap((r) => {
        const row = typedRow<{
          member_user_id?: string;
          member_google_id?: string | null;
          user_id?: string;
        }>(r);
        return [
          row.member_user_id ?? row.user_id,
          row.member_google_id,
        ].filter((value): value is string => Boolean(value));
      }),
    ),
  );
  if (memberIds.length === 0) {
    return c.json({ profiles: [] });
  }

  const placeholders = memberIds.map(() => '?').join(',');
  const voicesRes = await db.execute({
    sql: `SELECT vp.id, vp.name, vp.status, vp.created_at, vp.user_id, vp.is_shared, u.name as owner_name
          FROM voice_profiles vp
          LEFT JOIN users u ON vp.user_id = u.google_id OR vp.user_id = u.id
          WHERE vp.user_id IN (${placeholders})
            AND vp.deleted_at IS NULL
            AND vp.status = 'ready'
            AND COALESCE(vp.is_shared, 0) = 1
          ORDER BY vp.created_at DESC`,
    args: memberIds,
  });

  return c.json({
    profiles: voicesRes.rows.map((row) => ({
      ...row,
      is_shared: Boolean(Number(row.is_shared ?? 0)),
    })),
  });
});

voiceProfile.get('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' }, 400);
  }

  const result = await db.execute({
    sql: 'SELECT * FROM voice_profiles WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    args: [id, userId],
  });

  if (result.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  const row = result.rows[0]!;
  return c.json({ profile: { ...row, is_shared: Boolean(Number(row.is_shared ?? 0)) } });
});

voiceProfile.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' }, 400);
  }

  let body: { name?: unknown; is_shared?: unknown; isShared?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON body required', error_code: 'JSON_BODY_REQUIRED' }, 400);
  }

  const hasName = body.name !== undefined;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const sharedValue = body.is_shared ?? body.isShared;
  const isSharedUpdate = typeof sharedValue === 'boolean' ? sharedValue : undefined;
  const hasShared = isSharedUpdate !== undefined;
  if (!hasName && !hasShared) {
    return c.json({ error: 'name must be 1-50 characters', error_code: 'INVALID_NAME_LENGTH' }, 400);
  }
  if (hasName && (name.length === 0 || name.length > 50)) {
    return c.json({ error: 'name must be 1-50 characters', error_code: 'INVALID_NAME_LENGTH' }, 400);
  }

  const existing = await db.execute({
    sql: 'SELECT id FROM voice_profiles WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    args: [id, userId],
  });
  if (existing.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  const updates: string[] = [];
  const args: (string | number)[] = [];
  if (hasName) {
    updates.push('name = ?');
    args.push(name);
  }
  if (hasShared) {
    updates.push('is_shared = ?');
    args.push(isSharedUpdate ? 1 : 0);
  }
  updates.push("updated_at = datetime('now')");
  args.push(id);

  await db.execute({
    sql: `UPDATE voice_profiles SET ${updates.join(', ')} WHERE id = ?`,
    args,
  });

  return c.json({
    profile: {
      id,
      ...(hasName ? { name } : {}),
      ...(hasShared ? { is_shared: Boolean(isSharedUpdate) } : {}),
    },
  });
});

voiceProfile.post('/clone', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const profileCount = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM voice_profiles WHERE user_id = ? AND deleted_at IS NULL',
      args: [userId],
    });
    const count = Number(profileCount.rows[0]!.count);
    if (count >= MAX_VOICE_PROFILES) {
      return c.json(
        {
          error: `최대 ${MAX_VOICE_PROFILES}개까지 등록 가능합니다`,
          error_code: 'VOICE_LIMIT_REACHED',
        },
        403,
      );
    }

    const formData = await c.req.formData();
    const audioFile = getFormFile(formData, 'audio');
    const name = formData.get('name') as string | null;
    const isShared = ['true', '1', 'yes'].includes(String(formData.get('isShared') ?? formData.get('is_shared') ?? 'false'));
    if (!audioFile || !name) {
      return c.json({ error: 'audio file and name are required', error_code: 'AUDIO_AND_NAME_REQUIRED' }, 400);
    }

    if (name.length > 50) {
      return c.json({ error: 'Name must be 50 characters or less', error_code: 'NAME_TOO_LONG' }, 400);
    }

    const audioBuffer = await audioFile.arrayBuffer();
    const profileId = crypto.randomUUID();

    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, status, is_shared)
            VALUES (?, ?, ?, 'processing', ?)`,
      args: [profileId, userId, name, isShared ? 1 : 0],
    });

    const attempts = createEnrollmentAttempts({
      env: c.env,
      audioData: audioBuffer,
      name,
    });
    let lastError: unknown = new Error('No voice provider is configured.');
    let provider = '';
    let voiceId = '';
    for (const attempt of attempts) {
      try {
        const result = await attempt.enroll();
        provider = result.provider;
        voiceId = result.providerVoiceId;
        break;
      } catch (err) {
        lastError = err;
        if (err instanceof UnsupportedVoiceProviderError) continue;
        if (attempt !== attempts[attempts.length - 1]) continue;
      }
    }
    if (!voiceId) throw lastError;

    if (provider === 'perso') {
      await db.execute({
        sql: `UPDATE voice_profiles SET perso_voice_id = ?, status = 'ready', updated_at = datetime('now')
              WHERE id = ?`,
        args: [voiceId, profileId],
      });
    } else {
      await db.execute({
        sql: `UPDATE voice_profiles SET elevenlabs_voice_id = ?, status = 'ready', updated_at = datetime('now')
              WHERE id = ?`,
        args: [voiceId, profileId],
      });
    }

    return c.json(
      {
        profile: {
          id: profileId,
          name,
          voice_id: voiceId,
          provider,
          status: 'ready',
          is_shared: isShared,
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
      sql: 'SELECT id, name FROM voice_profiles WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
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
    messages: Number(typedRow<{ count: number }>(msgRes.rows[0]!).count ?? 0),
    alarms: Number(typedRow<{ count: number }>(alarmRes.rows[0]!).count ?? 0),
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
    sql: 'SELECT * FROM voice_profiles WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    args: [id, userId],
  });

  if (result.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  const profile = result.rows[0]!;

  try {
    if (profile.elevenlabs_voice_id) {
      const client = new ElevenLabsClient(c.env.ELEVENLABS_API_KEY);
      await client.deleteVoice(profile.elevenlabs_voice_id as string);
    }
  } catch {
    // 외부 API 삭제 실패해도 로컬은 삭제 진행
  }

  await db.execute({
    sql: `UPDATE voice_profiles
          SET deleted_at = datetime('now'), is_shared = 0, updated_at = datetime('now')
          WHERE id = ?`,
    args: [id],
  });

  return c.json({ success: true, deleted: true });
});

export default voiceProfile;
