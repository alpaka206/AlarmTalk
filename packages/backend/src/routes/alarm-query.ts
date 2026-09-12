import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { jsonError } from '../lib/api-error';
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
  const pagination = c.req.query('pagination');
  const cursorMode = pagination === 'cursor';
  const after = c.req.query('after');
  if (
    (pagination !== undefined && !cursorMode) ||
    (after !== undefined &&
      (!cursorMode ||
        after.length === 0 ||
        after.length > 128 ||
        Array.from(after).some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127))) ||
    (cursorMode && c.req.query('offset') !== undefined)
  ) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'Invalid alarm pagination parameters');
  }

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

  // 두 페이지 계약이 같은 행/표시 필드를 내려주도록 조회 본문은 공유한다.
  const selectAlarms = `SELECT a.*, m.text as message_text, m.category, vp.name as voice_name,
              m.audio_url as message_audio_url,
              creator.email as creator_email, creator.name as creator_name
            FROM alarms a
            LEFT JOIN messages m ON a.message_id = m.id
            LEFT JOIN voice_profiles vp ON m.voice_profile_id = vp.id
            LEFT JOIN users creator ON creator.google_id = a.user_id OR creator.id = a.user_id`;

  if (cursorMode) {
    // 시각은 편집으로 바뀌고 offset은 앞 행 삭제로 밀린다. 불변 PK로 이어 읽는다.
    // 커서 행이 ack되어 없어져도 id 값의 비교만 하므로 다음 가족 알람을 건너뛰지 않는다.
    if (after !== undefined) {
      whereClause += ' AND a.id > ?';
      whereArgs.push(after);
    }
    const result = await db.execute({
      sql: `${selectAlarms}
            ${whereClause}
            ORDER BY a.id ASC LIMIT ?`,
      args: [...whereArgs, limit + 1],
    });
    const alarms = (result.rows.slice(0, limit) as AlarmRow[]).map((r) =>
      normalizeAlarmRow(r, ids),
    );
    const hasMore = result.rows.length > limit;
    return c.json({ alarms, has_more: hasMore, next_cursor: hasMore ? alarms.at(-1)!.id : null });
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
      sql: `${selectAlarms}
            ${whereClause}
            ORDER BY a.time ASC, a.id ASC
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
 * 이유를 구분할 수 없다. 사유는 **셋**이고 결과가 서로 다르다:
 *
 *  1. **수신자가 그만받기** → 이 계정의 다른 기기에서도 지운다(`alarm_ids`)
 *  2. **목소리가 사라졌다**(발신자 탈퇴·목소리 삭제·플랜 강등) → 목소리만 걷어내고 알람은
 *     남긴다(`revoked_alarm_ids`)
 *  3. **전달이 끝나 서버가 행을 지웠다** → 두 배열 어디에도 안 실린다. 로컬은 **그대로
 *     둔다** — 정상 종료이지 사라진 것이 아니다(`docs/spec/family-alarm.md` 1-2).
 *
 * 3번이 기본값이라, 목록에서 빠졌다는 사실만으로 로컬을 지우면 **정상적으로 받은 알람이
 * 전부 사라진다.** 지우는 근거는 언제나 이 엔드포인트가 명시적으로 준 id 다.
 */
alarmQuery.get('/declined', async (c) => {
  const db = getDB(c.env);
  const ids = viewerIds(c);
  if (ids.length === 0) return c.json({ alarm_ids: [], revoked_alarm_ids: [] });
  const placeholders = inPlaceholders(ids);
  // 상한 없이 전부 돌려주면 그만받기 기록이 쌓일수록 매 pull 이 무거워진다(CLAUDE.md 의
  // 신규 리스트 엔드포인트 페이지네이션 규약). 클라가 다음 페이지를 이어 받는다.
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
  // 두 종류를 **한 페이지에서** 함께 읽어 나눠 담는다. 따로 두 번 페이지네이션하면
  // 오프셋이 어긋나 한쪽이 누락된다. 클라는 두 배열의 합만큼 offset 을 전진시킨다.
  //  - declined: 수신자가 그만받기 → 그 기기에서 알람을 지운다
  //  - revoked: 발신자 탈퇴/철회 → 목소리만 걷어내고 알람은 남긴다
  const result = await db.execute({
    sql: `SELECT alarm_id, declined, revoked FROM alarm_recipient_state
          WHERE recipient_user_id IN (${placeholders}) AND (declined = 1 OR revoked = 1)
          ORDER BY alarm_id
          LIMIT ? OFFSET ?`,
    args: [...ids, limit, offset],
  });
  const alarmIds: string[] = [];
  const revokedAlarmIds: string[] = [];
  for (const row of result.rows) {
    // 그만받기가 우선한다 — 수신자가 직접 뺀 알람은 목소리만 걷어낼 게 아니라 지운다.
    if (Number(row.declined) === 1) alarmIds.push(String(row.alarm_id));
    else revokedAlarmIds.push(String(row.alarm_id));
  }
  // has_more 로 다음 페이지 여부를 알린다 — 총계를 따로 세지 않아 쿼리가 하나로 끝난다.
  return c.json({
    alarm_ids: alarmIds,
    revoked_alarm_ids: revokedAlarmIds,
    has_more: result.rows.length === limit,
  });
});

export default alarmQuery;
