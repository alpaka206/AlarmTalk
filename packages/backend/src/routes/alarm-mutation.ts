import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { UUID_RE } from '../lib/validate';
import { assertSameGroup, resolveUserPk } from '../lib/family-helpers';
import {
  validateAlarmFields,
  normalizeAlarmRow,
  type AlarmRow,
  type AlarmMode,
  type VibrationPattern,
  type WakeMode,
} from './alarm-helpers';

const alarmMutation = new Hono<AppEnv>();

alarmMutation.post('/', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const body = await c.req.json<{
    message_id?: string;
    time: string;
    repeat_days?: number[];
    snooze_minutes?: number;
    target_user_id?: string;
    mode?: string;
    vibration_pattern?: string;
    wake_mode?: string;
    voice_profile_id?: string;
    speaker_id?: string;
    raw_audio_url?: string;
    raw_audio_duration_ms?: number;
  }>();

  if (!body.time) {
    return c.json({ error: 'time is required', error_code: 'REQUIRED_FIELDS_MISSING' }, 400);
  }
  // Three valid sources for what the alarm plays:
  //   1. message_id          → TTS / saved voice clip
  //   2. raw_audio_url       → user-recorded raw audio
  //   3. neither             → "alarm-only" mode: device default alarm sound
  // No further check needed; the alarm row stores message_id NULL for case 3.

  const fieldError = validateAlarmFields(body);
  if (fieldError) return c.json(fieldError, 400);

  let targetUserIdForAlarm: string | null = null;
  if (body.target_user_id) {
    const rawTargetUserId = body.target_user_id.trim();
    if (!rawTargetUserId) {
      return c.json({ error: 'Invalid target_user_id', error_code: 'INVALID_TARGET_USER' }, 400);
    }
    if (rawTargetUserId !== userId) {
      const friendship = await db.execute({
        sql: `SELECT id FROM friendships
              WHERE ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))
                AND status = 'accepted'`,
        args: [userId, rawTargetUserId, rawTargetUserId, userId],
      });

      if (friendship.rows.length > 0) {
        targetUserIdForAlarm = rawTargetUserId;
      } else {
        const targetRes = await db.execute({
          sql: `SELECT id, google_id, allow_family_alarms FROM users
                WHERE google_id = ? OR id = ?
                LIMIT 1`,
          args: [rawTargetUserId, rawTargetUserId],
        });
        if (targetRes.rows.length === 0) {
          return c.json({ error: '친구 관계인 사용자에게만 알람을 설정할 수 있습니다.', error_code: 'NOT_FRIENDS' }, 403);
        }

        const target = targetRes.rows[0]!;
        const targetPk = String(target.id);
        const targetGoogleId = String(target.google_id);
        const senderPk = await resolveUserPk(db, userId);
        const allowed = targetGoogleId !== userId && !!senderPk && (await assertSameGroup(db, senderPk, targetPk));

        if (!allowed) {
          return c.json(
            { error: '친구 또는 같은 커플/가족 그룹 멤버에게만 알람을 설정할 수 있습니다.', error_code: 'NOT_CONNECTED' },
            403,
          );
        }
        targetUserIdForAlarm = targetGoogleId;
      }
    }
  }

  const alarmOwner = targetUserIdForAlarm || userId;

  const user = await db.execute({
    sql: 'SELECT plan FROM users WHERE google_id = ?',
    args: [alarmOwner],
  });

  if (user.rows.length > 0 && user.rows[0]!.plan === 'free') {
    const alarmCount = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM alarms WHERE user_id = ? OR target_user_id = ?',
      args: [alarmOwner, alarmOwner],
    });
    if (Number(alarmCount.rows[0]!.count) >= 2) {
      return c.json({ error: '무료 플랜은 최대 2개의 알람만 설정 가능합니다.', error_code: 'FREE_PLAN_LIMIT' }, 403);
    }
  }

  // Raw-audio alarms have no real TTS message but the schema still requires
  // message_id (NOT NULL). Insert a "raw" placeholder message that points at
  // the same audio URL so the alarm row is satisfied. We attach it to the
  // user's first voice profile because messages.voice_profile_id is NOT NULL.
  let resolvedMessageId: string | null = body.message_id ?? null;
  if (!resolvedMessageId && body.raw_audio_url) {
    const firstVoice = await db.execute({
      sql: 'SELECT id FROM voice_profiles WHERE user_id = ? LIMIT 1',
      args: [userId],
    });
    if (firstVoice.rows.length === 0) {
      return c.json(
        {
          error: 'A voice profile is required to create a raw-audio alarm.',
          error_code: 'VOICE_PROFILE_REQUIRED',
        },
        400,
      );
    }
    const placeholderMsgId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
            VALUES (?, ?, ?, '', ?, 'raw')`,
      args: [
        placeholderMsgId,
        userId,
        firstVoice.rows[0]!.id as string,
        body.raw_audio_url,
      ],
    });
    resolvedMessageId = placeholderMsgId;
  } else if (resolvedMessageId) {
    const msg = await db.execute({
      sql: 'SELECT id FROM messages WHERE id = ? AND user_id = ?',
      args: [resolvedMessageId, userId],
    });
    if (msg.rows.length === 0) {
      return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
    }
  }

  const alarmId = crypto.randomUUID();
  const mode: AlarmMode = (body.mode as AlarmMode | undefined) ?? 'tts';
  const vibPattern: VibrationPattern = (body.vibration_pattern as VibrationPattern | undefined) ?? 'default';
  const wakeMode: WakeMode = (body.wake_mode as WakeMode | undefined) ?? 'sound_then_voice';
  await db.execute({
    sql: `INSERT INTO alarms
            (id, user_id, target_user_id, message_id, time, repeat_days, snooze_minutes,
             mode, vibration_pattern, wake_mode, voice_profile_id, speaker_id,
             raw_audio_url, raw_audio_duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      alarmId,
      userId,
      targetUserIdForAlarm,
      resolvedMessageId,
      body.time,
      JSON.stringify(body.repeat_days ?? []),
      body.snooze_minutes ?? 5,
      mode,
      vibPattern,
      wakeMode,
      body.voice_profile_id ?? null,
      body.speaker_id ?? null,
      body.raw_audio_url ?? null,
      body.raw_audio_duration_ms ?? null,
    ],
  });

  return c.json(
    {
      alarm: {
        id: alarmId,
        ...body,
        target_user_id: targetUserIdForAlarm,
        mode,
        vibration_pattern: vibPattern,
        voice_profile_id: body.voice_profile_id ?? null,
        speaker_id: body.speaker_id ?? null,
      },
    },
    201,
  );
});

alarmMutation.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid alarm ID format', error_code: 'INVALID_ALARM_ID' }, 400);
  }

  const body = await c.req.json<{
    time?: string;
    repeat_days?: number[];
    is_active?: boolean;
    snooze_minutes?: number;
    message_id?: string | null;
    mode?: string;
    vibration_pattern?: string;
    wake_mode?: string;
    voice_profile_id?: string | null;
    speaker_id?: string | null;
    raw_audio_url?: string | null;
    raw_audio_duration_ms?: number | null;
  }>();

  const fieldError = validateAlarmFields(body);
  if (fieldError) return c.json(fieldError, 400);

  const existing = await db.execute({
    sql: 'SELECT id FROM alarms WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });
  if (existing.rows.length === 0) {
    return c.json({ error: 'Alarm not found', error_code: 'ALARM_NOT_FOUND' }, 404);
  }

  const updates: string[] = [];
  const args: (string | number | null)[] = [];

  if (body.time !== undefined) {
    updates.push('time = ?');
    args.push(body.time);
  }
  if (body.repeat_days !== undefined) {
    updates.push('repeat_days = ?');
    args.push(JSON.stringify(body.repeat_days));
  }
  if (body.is_active !== undefined) {
    updates.push('is_active = ?');
    args.push(body.is_active ? 1 : 0);
  }
  if (body.snooze_minutes !== undefined) {
    updates.push('snooze_minutes = ?');
    args.push(body.snooze_minutes);
  }
  if (body.message_id !== undefined) {
    updates.push('message_id = ?');
    args.push(body.message_id);
  }
  if (body.mode !== undefined) {
    updates.push('mode = ?');
    args.push(body.mode);
  }
  if (body.vibration_pattern !== undefined) {
    updates.push('vibration_pattern = ?');
    args.push(body.vibration_pattern);
  }
  if (body.wake_mode !== undefined) {
    updates.push('wake_mode = ?');
    args.push(body.wake_mode);
  }
  if (body.voice_profile_id !== undefined) {
    updates.push('voice_profile_id = ?');
    args.push(body.voice_profile_id);
  }
  if (body.speaker_id !== undefined) {
    updates.push('speaker_id = ?');
    args.push(body.speaker_id);
  }
  if (body.raw_audio_url !== undefined) {
    updates.push('raw_audio_url = ?');
    args.push(body.raw_audio_url);
  }
  if (body.raw_audio_duration_ms !== undefined) {
    updates.push('raw_audio_duration_ms = ?');
    args.push(body.raw_audio_duration_ms);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update', error_code: 'NO_UPDATE_FIELDS' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  args.push(id);

  await db.execute({
    sql: `UPDATE alarms SET ${updates.join(', ')} WHERE id = ?`,
    args,
  });

  const updated = await db.execute({
    sql: `SELECT id, user_id, target_user_id, message_id, time, repeat_days,
                 is_active, snooze_minutes, mode, vibration_pattern, wake_mode,
                 voice_profile_id, speaker_id, created_at, updated_at
          FROM alarms WHERE id = ?`,
    args: [id],
  });

  return c.json({
    success: true,
    alarm: normalizeAlarmRow(updated.rows[0] as AlarmRow, userId),
  });
});

alarmMutation.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid alarm ID format', error_code: 'INVALID_ALARM_ID' }, 400);
  }

  const result = await db.execute({
    sql: 'DELETE FROM alarms WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });

  if (result.rowsAffected === 0) {
    return c.json({ error: 'Alarm not found', error_code: 'ALARM_NOT_FOUND' }, 404);
  }

  return c.json({ success: true });
});

export default alarmMutation;
