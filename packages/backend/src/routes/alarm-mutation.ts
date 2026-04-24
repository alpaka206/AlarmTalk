import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { UUID_RE } from '../lib/validate';
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
    message_id: string;
    time: string;
    repeat_days?: number[];
    snooze_minutes?: number;
    target_user_id?: string;
    mode?: string;
    vibration_pattern?: string;
    wake_mode?: string;
    voice_profile_id?: string;
    speaker_id?: string;
  }>();

  if (!body.message_id || !body.time) {
    return c.json({ error: 'message_id and time are required', error_code: 'REQUIRED_FIELDS_MISSING' }, 400);
  }

  const fieldError = validateAlarmFields(body);
  if (fieldError) return c.json(fieldError, 400);

  if (body.target_user_id && body.target_user_id !== userId) {
    const friendship = await db.execute({
      sql: `SELECT id FROM friendships
            WHERE ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))
              AND status = 'accepted'`,
      args: [userId, body.target_user_id, body.target_user_id, userId],
    });
    if (friendship.rows.length === 0) {
      return c.json({ error: '친구 관계인 사용자에게만 알람을 설정할 수 있습니다.', error_code: 'NOT_FRIENDS' }, 403);
    }
  }

  const alarmOwner = body.target_user_id || userId;

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

  const msg = await db.execute({
    sql: 'SELECT id FROM messages WHERE id = ? AND user_id = ?',
    args: [body.message_id, userId],
  });
  if (msg.rows.length === 0) {
    return c.json({ error: 'Message not found' }, 404);
  }

  const alarmId = crypto.randomUUID();
  const mode: AlarmMode = (body.mode as AlarmMode | undefined) ?? 'tts';
  const vibPattern: VibrationPattern = (body.vibration_pattern as VibrationPattern | undefined) ?? 'default';
  const wakeMode: WakeMode = (body.wake_mode as WakeMode | undefined) ?? 'sound_then_voice';
  await db.execute({
    sql: `INSERT INTO alarms
            (id, user_id, target_user_id, message_id, time, repeat_days, snooze_minutes,
             mode, vibration_pattern, wake_mode, voice_profile_id, speaker_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      alarmId,
      userId,
      body.target_user_id ?? null,
      body.message_id,
      body.time,
      JSON.stringify(body.repeat_days ?? []),
      body.snooze_minutes ?? 5,
      mode,
      vibPattern,
      wakeMode,
      body.voice_profile_id ?? null,
      body.speaker_id ?? null,
    ],
  });

  return c.json(
    {
      alarm: {
        id: alarmId,
        ...body,
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
    message_id?: string;
    mode?: string;
    vibration_pattern?: string;
    wake_mode?: string;
    voice_profile_id?: string | null;
    speaker_id?: string | null;
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
