import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { selectFiringAlarms, type ScheduledAlarm } from '../lib/scheduler';
import { UUID_RE } from '../lib/validate';
const ALARM_MODES = ['sound-only', 'tts'] as const;
type AlarmMode = (typeof ALARM_MODES)[number];
const VIBRATION_PATTERNS = ['default', 'strong', 'none'] as const;
type VibrationPattern = (typeof VIBRATION_PATTERNS)[number];
const WAKE_MODES = ['sound_then_voice', 'voice_only'] as const;
type WakeMode = (typeof WAKE_MODES)[number];

type AlarmRow = Record<string, unknown> & {
  repeat_days?: unknown;
  is_active?: unknown;
  mode?: unknown;
  vibration_pattern?: unknown;
  wake_mode?: unknown;
  voice_profile_id?: unknown;
  speaker_id?: unknown;
  user_id?: unknown;
  creator_email?: unknown;
  creator_name?: unknown;
  category?: unknown;
};

function normalizeAlarmRow(row: AlarmRow, viewerUserId?: string | null) {
  const rawRepeat = row.repeat_days;
  let repeatDays: number[] = [];
  if (typeof rawRepeat === 'string' && rawRepeat.length > 0) {
    try {
      const parsed: unknown = JSON.parse(rawRepeat);
      if (Array.isArray(parsed)) repeatDays = parsed.filter((n): n is number => Number.isInteger(n));
    } catch {
      repeatDays = [];
    }
  } else if (Array.isArray(rawRepeat)) {
    repeatDays = rawRepeat.filter((n): n is number => Number.isInteger(n));
  }

  const mode: AlarmMode =
    row.mode === 'sound-only' || row.mode === 'tts' ? row.mode : 'tts';

  const vibrationPattern: VibrationPattern =
    row.vibration_pattern === 'default' || row.vibration_pattern === 'strong' || row.vibration_pattern === 'none'
      ? row.vibration_pattern
      : 'default';

  const wakeMode: WakeMode =
    row.wake_mode === 'sound_then_voice' || row.wake_mode === 'voice_only'
      ? row.wake_mode
      : 'sound_then_voice';

  const category = typeof row.category === 'string' ? row.category : null;
  const isFamilyAlarm = category === 'family' || category === 'family-voice';
  const senderUserId = typeof row.user_id === 'string' ? row.user_id : null;
  const senderName = typeof row.creator_name === 'string' ? row.creator_name : null;
  const senderEmail = typeof row.creator_email === 'string' ? row.creator_email : null;
  const isReceivedFamilyAlarm =
    isFamilyAlarm && !!viewerUserId && !!senderUserId && senderUserId !== viewerUserId;

  return {
    ...row,
    repeat_days: repeatDays,
    is_active: row.is_active === 1 || row.is_active === true,
    mode,
    vibration_pattern: vibrationPattern,
    wake_mode: wakeMode,
    voice_profile_id: (row.voice_profile_id ?? null) as string | null,
    speaker_id: (row.speaker_id ?? null) as string | null,
    sender_user_id: senderUserId,
    sender_name: senderName,
    sender_email: senderEmail,
    is_family_alarm: isFamilyAlarm,
    is_received_family_alarm: isReceivedFamilyAlarm,
  };
}

type FieldError = { error: string; error_code: string };

function validateAlarmFields(body: {
  mode?: string;
  vibration_pattern?: string;
  wake_mode?: string;
  voice_profile_id?: string | null;
  speaker_id?: string | null;
  time?: string;
  repeat_days?: number[];
  snooze_minutes?: number;
  message_id?: string;
  is_active?: boolean;
  target_user_id?: string;
}): FieldError | null {
  if (body.message_id !== undefined && !UUID_RE.test(body.message_id)) {
    return { error: 'Invalid message_id format', error_code: 'INVALID_MESSAGE_ID' };
  }

  if (body.target_user_id !== undefined && typeof body.target_user_id !== 'string') {
    return { error: 'Invalid target_user_id', error_code: 'INVALID_TARGET_USER' };
  }

  if (body.mode !== undefined && !ALARM_MODES.includes(body.mode as AlarmMode)) {
    return { error: `mode must be one of: ${ALARM_MODES.join(', ')}`, error_code: 'INVALID_ALARM_MODE' };
  }

  if (body.vibration_pattern !== undefined && !VIBRATION_PATTERNS.includes(body.vibration_pattern as VibrationPattern)) {
    return { error: `vibration_pattern must be one of: ${VIBRATION_PATTERNS.join(', ')}`, error_code: 'INVALID_VIBRATION_PATTERN' };
  }

  if (body.wake_mode !== undefined && !WAKE_MODES.includes(body.wake_mode as WakeMode)) {
    return { error: `wake_mode must be one of: ${WAKE_MODES.join(', ')}`, error_code: 'INVALID_WAKE_MODE' };
  }

  if (body.voice_profile_id !== undefined && body.voice_profile_id !== null && !UUID_RE.test(body.voice_profile_id)) {
    return { error: 'Invalid voice_profile_id format', error_code: 'INVALID_VOICE_PROFILE_ID' };
  }

  if (body.speaker_id !== undefined && body.speaker_id !== null && !UUID_RE.test(body.speaker_id)) {
    return { error: 'Invalid speaker_id format', error_code: 'INVALID_SPEAKER_ID' };
  }

  if (body.time !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(body.time)) {
      return { error: 'time must be in HH:mm format', error_code: 'INVALID_TIME_FORMAT' };
    }
    const [h, m] = body.time.split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      return { error: 'Invalid time value', error_code: 'INVALID_TIME_VALUE' };
    }
  }

  if (
    body.repeat_days !== undefined &&
    (!Array.isArray(body.repeat_days) || body.repeat_days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
  ) {
    return { error: 'repeat_days must be an array of integers 0-6', error_code: 'INVALID_REPEAT_DAYS' };
  }

  if (
    body.snooze_minutes !== undefined &&
    (!Number.isInteger(body.snooze_minutes) || body.snooze_minutes < 1 || body.snooze_minutes > 30)
  ) {
    return { error: 'snooze_minutes must be an integer between 1 and 30', error_code: 'INVALID_SNOOZE_MINUTES' };
  }

  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
    return { error: 'is_active must be a boolean', error_code: 'INVALID_IS_ACTIVE' };
  }

  return null;
}

const alarm = new Hono<AppEnv>();

/** 디버그용 cron 틱 — 현재 UTC 시각 기준으로 발화 대상 알람을 반환 (푸시 전송은 하지 않음) */
alarm.get('/tick', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const result = await db.execute({
    sql: `SELECT id, user_id, target_user_id, time, repeat_days, is_active,
                 mode, voice_profile_id, speaker_id
          FROM alarms
          WHERE (user_id = ? OR target_user_id = ?) AND is_active = 1`,
    args: [userId, userId],
  });

  const alarms: ScheduledAlarm[] = (result.rows as AlarmRow[]).map((r) => {
    const n = normalizeAlarmRow(r);
    return {
      id: String(r.id),
      user_id: String(r.user_id),
      target_user_id: (r.target_user_id as string | null) ?? null,
      time: String(r.time),
      repeat_days: n.repeat_days,
      is_active: n.is_active,
      mode: n.mode,
      voice_profile_id: n.voice_profile_id,
      speaker_id: n.speaker_id,
    };
  });

  const now = new Date();
  const firing = selectFiringAlarms(alarms, now);
  return c.json({
    now: now.toISOString(),
    checked: alarms.length,
    firing: firing.map((a) => ({
      id: a.id,
      time: a.time,
      mode: a.mode,
      voice_profile_id: a.voice_profile_id,
      speaker_id: a.speaker_id,
    })),
  });
});

/** 알람 목록 조회 */
alarm.get('/', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
  const isActiveParam = c.req.query('is_active');
  const voiceProfileId = c.req.query('voice_profile_id');

  let whereClause = 'WHERE (a.user_id = ? OR a.target_user_id = ?)';
  const whereArgs: (string | number)[] = [userId, userId];

  if (isActiveParam === 'true' || isActiveParam === 'false') {
    whereClause += ' AND a.is_active = ?';
    whereArgs.push(isActiveParam === 'true' ? 1 : 0);
  }

  if (voiceProfileId) {
    whereClause += ' AND m.voice_profile_id = ?';
    whereArgs.push(voiceProfileId);
  }

  const [countRes, result] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as total FROM alarms a
            JOIN messages m ON a.message_id = m.id
            ${whereClause}`,
      args: whereArgs,
    }),
    db.execute({
      sql: `SELECT a.*, m.text as message_text, m.category, vp.name as voice_name,
              creator.email as creator_email, creator.name as creator_name
            FROM alarms a
            JOIN messages m ON a.message_id = m.id
            JOIN voice_profiles vp ON m.voice_profile_id = vp.id
            LEFT JOIN users creator ON creator.google_id = a.user_id
            ${whereClause}
            ORDER BY a.time ASC
            LIMIT ? OFFSET ?`,
      args: [...whereArgs, limit, offset],
    }),
  ]);

  const total = Number(countRes.rows[0].total);
  const alarms = (result.rows as AlarmRow[]).map((r) => normalizeAlarmRow(r, userId));
  return c.json({ alarms, total, limit, offset });
});

/** 단일 알람 조회 */
alarm.get('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid alarm ID format', error_code: 'INVALID_ALARM_ID' }, 400);
  }

  const result = await db.execute({
    sql: `SELECT a.*, m.text as message_text, m.category, vp.name as voice_name,
            creator.email as creator_email, creator.name as creator_name
          FROM alarms a
          JOIN messages m ON a.message_id = m.id
          JOIN voice_profiles vp ON m.voice_profile_id = vp.id
          LEFT JOIN users creator ON creator.google_id = a.user_id
          WHERE a.id = ? AND (a.user_id = ? OR a.target_user_id = ?)`,
    args: [id, userId, userId],
  });

  if (result.rows.length === 0) {
    return c.json({ error: 'Alarm not found', error_code: 'ALARM_NOT_FOUND' }, 404);
  }

  return c.json({ alarm: normalizeAlarmRow(result.rows[0] as AlarmRow, userId) });
});

/** 알람 생성 */
alarm.post('/', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const body = await c.req.json<{
    message_id: string;
    time: string; // HH:mm
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

  if (user.rows.length > 0 && user.rows[0].plan === 'free') {
    const alarmCount = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM alarms WHERE user_id = ? OR target_user_id = ?',
      args: [alarmOwner, alarmOwner],
    });
    if (Number(alarmCount.rows[0].count) >= 2) {
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

/** 알람 수정 */
alarm.patch('/:id', async (c) => {
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

/** 알람 삭제 */
alarm.delete('/:id', async (c) => {
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

export default alarm;
