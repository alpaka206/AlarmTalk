import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { normalizeAlarmRow, type AlarmRow } from './alarm-helpers';

const alarmQuery = new Hono<AppEnv>();

// 소유권 기준은 users.id(userId) 다. userLoginId 를 함께 넣는 이유는 식별자 통일 전에
// user_id 컬럼에 로그인 식별자(google_id)가 저장된 과거 행까지 읽어 주기 위해서다
// (userId 는 미들웨어가 PK 로 정규화하므로 이 값을 따로 넣지 않으면 레거시 행이 누락된다).
function viewerIds(c: { get: (key: 'userId' | 'userIdPK' | 'userLoginId') => string }): string[] {
  return Array.from(
    new Set([c.get('userIdPK') || c.get('userId'), c.get('userLoginId')].filter(Boolean)),
  );
}

function inPlaceholders(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}

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

/**
 * 이 사용자가 '그만받기' 한 알람 id 목록.
 *
 * 목록(`GET /alarm`)은 그만받기 한 알람을 아예 빼서 내려주므로, 클라는 "목록에서 사라짐" 의
 * 이유를 구분할 수 없다 — **수신자가 그만받기** 했는지, **발신자가 지웠**는지. 그 둘은 결과가
 * 정반대여야 한다: 그만받기는 이 계정의 다른 기기에서도 지워야 하고, 발신자 삭제는 이미
 * 받은 사람의 알람을 건드리면 안 된다(받은 뒤부터는 받는 사람 것이다).
 */
alarmQuery.get('/declined', async (c) => {
  const db = getDB(c.env);
  const ids = viewerIds(c);
  if (ids.length === 0) return c.json({ alarm_ids: [] });
  const placeholders = inPlaceholders(ids);
  const result = await db.execute({
    sql: `SELECT alarm_id FROM alarm_recipient_state
          WHERE recipient_user_id IN (${placeholders}) AND declined = 1`,
    args: ids,
  });
  return c.json({ alarm_ids: result.rows.map((r) => String(r.alarm_id)) });
});

export default alarmQuery;
