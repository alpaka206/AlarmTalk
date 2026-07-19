import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { selectFiringAlarms, type ScheduledAlarm } from '../lib/scheduler';
import { UUID_RE } from '../lib/validate';
import { normalizeAlarmRow, type AlarmRow } from './alarm-helpers';

const alarmQuery = new Hono<AppEnv>();

function viewerIds(c: { get: (key: 'userId' | 'userIdPK') => string }): string[] {
  return Array.from(new Set([c.get('userIdPK') || c.get('userId'), c.get('userId')]));
}

function inPlaceholders(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}

alarmQuery.get('/tick', async (c) => {
  const ids = viewerIds(c);
  const idPlaceholders = inPlaceholders(ids);
  const db = getDB(c.env);

  const result = await db.execute({
    sql: `SELECT id, user_id, target_user_id, time, repeat_days, is_active,
                 mode, voice_profile_id, speaker_id, timezone
          FROM alarms
          WHERE (user_id IN (${idPlaceholders}) OR target_user_id IN (${idPlaceholders})) AND is_active = 1
            AND NOT (
              target_user_id IN (${idPlaceholders})
              AND user_id NOT IN (${idPlaceholders})
              AND EXISTS (
                SELECT 1 FROM alarm_recipient_state ars
                WHERE ars.alarm_id = alarms.id
                  AND ars.recipient_user_id IN (${idPlaceholders})
                  AND ars.declined = 1
              )
            )`,
    args: [...ids, ...ids, ...ids, ...ids, ...ids],
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
      timezone: ((r as Record<string, unknown>).timezone as string | null) ?? null,
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

alarmQuery.get('/', async (c) => {
  const ids = viewerIds(c);
  const idPlaceholders = inPlaceholders(ids);
  const db = getDB(c.env);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
  const isActiveParam = c.req.query('is_active');
  const voiceProfileId = c.req.query('voice_profile_id');

  let whereClause = `WHERE (a.user_id IN (${idPlaceholders}) OR a.target_user_id IN (${idPlaceholders}))
        AND NOT (
          a.target_user_id IN (${idPlaceholders})
          AND a.user_id NOT IN (${idPlaceholders})
          AND EXISTS (
            SELECT 1 FROM alarm_recipient_state ars
            WHERE ars.alarm_id = a.id
              AND ars.recipient_user_id IN (${idPlaceholders})
              AND ars.declined = 1
          )
        )`;
  const whereArgs: (string | number)[] = [...ids, ...ids, ...ids, ...ids, ...ids];

  if (isActiveParam === 'true' || isActiveParam === 'false') {
    whereClause += ' AND a.is_active = ?';
    whereArgs.push(isActiveParam === 'true' ? 1 : 0);
  }

  if (voiceProfileId) {
    whereClause += ' AND m.voice_profile_id = ?';
    whereArgs.push(voiceProfileId);
  }

  // LEFT JOIN messages/voice_profiles so the new "alarm-only" play mode
  // (message_id NULL, no associated voice clip) still appears in the list.
  // The voice_profile_id filter naturally excludes those rows by requiring
  // m to be present.
  const [countRes, result] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as total FROM alarms a
            LEFT JOIN messages m ON a.message_id = m.id
            ${whereClause}`,
      args: whereArgs,
    }),
    db.execute({
      sql: `SELECT a.*, m.text as message_text, m.category, vp.name as voice_name,
              m.audio_url as message_audio_url,
              creator.email as creator_email, creator.name as creator_name
            FROM alarms a
            LEFT JOIN messages m ON a.message_id = m.id
            LEFT JOIN voice_profiles vp ON m.voice_profile_id = vp.id
            LEFT JOIN users creator ON creator.google_id = a.user_id OR creator.id = a.user_id
            ${whereClause}
            ORDER BY a.time ASC
            LIMIT ? OFFSET ?`,
      args: [...whereArgs, limit, offset],
    }),
  ]);

  const total = Number(countRes.rows[0]!.total);
  const alarms = (result.rows as AlarmRow[]).map((r) => normalizeAlarmRow(r, ids));
  return c.json({ alarms, total, limit, offset });
});

alarmQuery.get('/:id', async (c) => {
  const ids = viewerIds(c);
  const idPlaceholders = inPlaceholders(ids);
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid alarm ID format', error_code: 'INVALID_ALARM_ID' }, 400);
  }

  const result = await db.execute({
    sql: `SELECT a.*, m.text as message_text, m.category, vp.name as voice_name,
            m.audio_url as message_audio_url,
            creator.email as creator_email, creator.name as creator_name
          FROM alarms a
          LEFT JOIN messages m ON a.message_id = m.id
          LEFT JOIN voice_profiles vp ON m.voice_profile_id = vp.id
          LEFT JOIN users creator ON creator.google_id = a.user_id OR creator.id = a.user_id
          WHERE a.id = ? AND (a.user_id IN (${idPlaceholders}) OR a.target_user_id IN (${idPlaceholders}))`,
    args: [id, ...ids, ...ids],
  });

  if (result.rows.length === 0) {
    return c.json({ error: 'Alarm not found', error_code: 'ALARM_NOT_FOUND' }, 404);
  }

  return c.json({ alarm: normalizeAlarmRow(result.rows[0] as AlarmRow, ids) });
});

export default alarmQuery;
