import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { logRouteError } from '../lib/logger';
import { deletePaidVoiceDataForUser } from '../lib/paid-voice-cleanup';
import { purgeUserAccount } from '../lib/account-deletion';
import { withWriteTransaction } from '../lib/transactions';
import {
  familyAlarmSettingsFromRow,
  validateQuietDays,
  validateQuietTime,
  validateQuietWindows,
} from '../lib/family-alarm-settings';
import {
  dynamicPromptSettingsFromRow,
  validateDynamicPromptSettings,
} from '../lib/dynamic-prompt-settings';

const user = new Hono<AppEnv>();

user.get('/me', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    // userId is the JWT sub (= users.google_id). Auth middleware guarantees
    // the row exists. The legacy INSERT branch (referencing the long-gone
    // firebase_uid column) is removed.
    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE google_id = ?',
      args: [userId],
    });

    if (result.rows.length === 0) {
      return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
    }

    const u = result.rows[0]!;
    const [profileCount, alarmCount] = await Promise.all([
      db.execute({
        sql: 'SELECT COUNT(*) as count FROM voice_profiles WHERE user_id = ? AND deleted_at IS NULL',
        args: [userId],
      }),
      db.execute({
        sql: 'SELECT COUNT(*) as count FROM alarms WHERE user_id = ?',
        args: [userId],
      }),
      db.execute({
        sql: "UPDATE users SET last_active_at = datetime('now') WHERE google_id = ?",
        args: [userId],
      }),
    ]);

    const familyAlarmSettings = familyAlarmSettingsFromRow(u as Record<string, unknown>);
    const dynamicPromptSettings = dynamicPromptSettingsFromRow(u as Record<string, unknown>);
    return c.json({
      user: {
        ...u,
        allow_family_alarms: familyAlarmSettings.allowFamilyAlarms,
        family_alarm_quiet_days: familyAlarmSettings.quietDays,
        family_alarm_quiet_start: familyAlarmSettings.quietStart,
        family_alarm_quiet_end: familyAlarmSettings.quietEnd,
        family_alarm_quiet_windows: familyAlarmSettings.quietWindows,
        dynamic_prompt_settings: dynamicPromptSettings,
      },
      stats: {
        voice_profiles: Number(profileCount.rows[0]?.count ?? 0),
        alarms: Number(alarmCount.rows[0]?.count ?? 0),
      },
    });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to fetch user info', error_code: 'FETCH_USER_FAILED' }, 500);
  }
});

function toBoolFlag(raw: unknown): 0 | 1 | null {
  if (raw === true || raw === 1 || raw === '1' || raw === 'true') return 1;
  if (raw === false || raw === 0 || raw === '0' || raw === 'false') return 0;
  return null;
}

/**
 * PATCH /user/me
 * 본인 프로필과 상대 알람 허용/불가 시간 설정을 업데이트한다.
 */
user.patch('/me', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const body = await c.req
    .json<{
      allow_family_alarms?: unknown;
      family_alarm_quiet_days?: unknown;
      family_alarm_quiet_start?: unknown;
      family_alarm_quiet_end?: unknown;
      family_alarm_quiet_windows?: unknown;
      dynamic_prompt_settings?: unknown;
      name?: unknown;
    }>()
    .catch(() => ({}));

  const updates: string[] = [];
  const args: (string | number)[] = [];
  let resolvedName: string | null = null;
  let resolvedDynamicPromptSettings: ReturnType<typeof validateDynamicPromptSettings> = null;

  if ('name' in body && body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return c.json({ error: 'name 은 문자열이어야 합니다', error_code: 'INVALID_NAME' }, 400);
    }
    const trimmed = body.name.trim();
    if (trimmed.length === 0 || trimmed.length > 30) {
      return c.json(
        { error: '닉네임은 1~30자여야 합니다', error_code: 'INVALID_NAME_LENGTH' },
        400,
      );
    }
    updates.push('name = ?');
    args.push(trimmed);
    resolvedName = trimmed;
  }

  let resolvedFlag: 0 | 1 | null = null;
  if ('allow_family_alarms' in body && body.allow_family_alarms !== undefined) {
    const flag = toBoolFlag(body.allow_family_alarms);
    if (flag === null) {
      return c.json(
        { error: 'allow_family_alarms 는 boolean 이어야 합니다', error_code: 'INVALID_BOOLEAN' },
        400,
      );
    }
    updates.push('allow_family_alarms = ?');
    args.push(flag);
    resolvedFlag = flag;
  }

  const hasQuietWindows =
    'family_alarm_quiet_windows' in body && body.family_alarm_quiet_windows !== undefined;
  let resolvedQuietWindows: { days: number[]; start: string; end: string }[] | null = null;
  let resolvedQuietDays: number[] | null = null;
  let resolvedQuietStart: string | null = null;
  let resolvedQuietEnd: string | null = null;

  if (hasQuietWindows) {
    const windows = validateQuietWindows(body.family_alarm_quiet_windows);
    if (windows === null) {
      return c.json(
        {
          error: 'family_alarm_quiet_windows 는 days/start/end 배열이어야 합니다',
          error_code: 'INVALID_QUIET_WINDOWS',
        },
        400,
      );
    }
    const firstWindow = windows[0] ?? { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:30' };
    updates.push('family_alarm_quiet_windows = ?');
    args.push(JSON.stringify(windows));
    updates.push('family_alarm_quiet_days = ?');
    args.push(JSON.stringify(firstWindow.days));
    updates.push('family_alarm_quiet_start = ?');
    args.push(firstWindow.start);
    updates.push('family_alarm_quiet_end = ?');
    args.push(firstWindow.end);
    resolvedQuietWindows = windows;
    resolvedQuietDays = firstWindow.days;
    resolvedQuietStart = firstWindow.start;
    resolvedQuietEnd = firstWindow.end;
  }

  if (
    !hasQuietWindows &&
    'family_alarm_quiet_days' in body &&
    body.family_alarm_quiet_days !== undefined
  ) {
    const days = validateQuietDays(body.family_alarm_quiet_days);
    if (days === null) {
      return c.json(
        {
          error: 'family_alarm_quiet_days 는 0~6 숫자 배열이어야 합니다',
          error_code: 'INVALID_QUIET_DAYS',
        },
        400,
      );
    }
    updates.push('family_alarm_quiet_days = ?');
    args.push(JSON.stringify(days));
    resolvedQuietDays = days;
  }

  if (
    !hasQuietWindows &&
    'family_alarm_quiet_start' in body &&
    body.family_alarm_quiet_start !== undefined
  ) {
    const time = validateQuietTime(body.family_alarm_quiet_start);
    if (time === null) {
      return c.json(
        {
          error: 'family_alarm_quiet_start 는 HH:mm 형식이어야 합니다',
          error_code: 'INVALID_QUIET_TIME',
        },
        400,
      );
    }
    updates.push('family_alarm_quiet_start = ?');
    args.push(time);
    resolvedQuietStart = time;
  }

  if (
    !hasQuietWindows &&
    'family_alarm_quiet_end' in body &&
    body.family_alarm_quiet_end !== undefined
  ) {
    const time = validateQuietTime(body.family_alarm_quiet_end);
    if (time === null) {
      return c.json(
        {
          error: 'family_alarm_quiet_end 는 HH:mm 형식이어야 합니다',
          error_code: 'INVALID_QUIET_TIME',
        },
        400,
      );
    }
    updates.push('family_alarm_quiet_end = ?');
    args.push(time);
    resolvedQuietEnd = time;
  }

  if ('dynamic_prompt_settings' in body && body.dynamic_prompt_settings !== undefined) {
    const settings = validateDynamicPromptSettings(body.dynamic_prompt_settings);
    if (settings === null) {
      return c.json(
        {
          error: 'dynamic_prompt_settings 형식이 올바르지 않습니다',
          error_code: 'INVALID_DYNAMIC_PROMPT_SETTINGS',
        },
        400,
      );
    }
    updates.push('dynamic_prompt_settings_json = ?');
    args.push(JSON.stringify(settings));
    resolvedDynamicPromptSettings = settings;
  }

  if (updates.length === 0) {
    return c.json({ error: '변경할 필드가 없습니다', error_code: 'NO_FIELDS_TO_UPDATE' }, 400);
  }

  args.push(userId);
  const result = await db.execute({
    sql: `UPDATE users SET ${updates.join(', ')}, updated_at = datetime('now')
          WHERE google_id = ?`,
    args,
  });
  if (result.rowsAffected === 0) {
    return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  }

  return c.json({
    success: true,
    name: resolvedName,
    allow_family_alarms: resolvedFlag === null ? null : resolvedFlag === 1,
    family_alarm_quiet_days: resolvedQuietDays,
    family_alarm_quiet_start: resolvedQuietStart,
    family_alarm_quiet_end: resolvedQuietEnd,
    family_alarm_quiet_windows: resolvedQuietWindows,
    dynamic_prompt_settings: resolvedDynamicPromptSettings,
  });
});

user.patch('/plan', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const body = await c.req.json<{ plan: 'free' | 'plus' | 'family' }>();

    if (!['free', 'plus', 'family'].includes(body.plan)) {
      return c.json({ error: 'Invalid plan', error_code: 'INVALID_PLAN' }, 400);
    }

    const result = await withWriteTransaction(db, async (tx) => {
      const update = await tx.execute({
        sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE google_id = ?`,
        args: [body.plan, userId],
      });
      if (update.rowsAffected === 0) return update;
      if (body.plan === 'free') {
        const userRes = await tx.execute({
          sql: `SELECT id FROM users WHERE google_id = ? LIMIT 1`,
          args: [userId],
        });
        const userPk = userRes.rows[0]?.id;
        if (typeof userPk === 'string') {
          await deletePaidVoiceDataForUser(tx, userPk, userId);
        }
      }
      return update;
    });
    if (result.rowsAffected === 0) {
      return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
    }

    return c.json({ success: true, plan: body.plan });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to update plan', error_code: 'UPDATE_PLAN_FAILED' }, 500);
  }
});

user.delete('/me', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const userRes = await db.execute({
      sql: `SELECT id FROM users WHERE google_id = ? OR id = ? LIMIT 1`,
      args: [userId, userId],
    });
    const userPk = userRes.rows.length > 0 ? String(userRes.rows[0]!.id) : null;

    await withWriteTransaction(db, (tx) => purgeUserAccount(tx, userPk, userId));

    return c.json({ success: true });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to delete account', error_code: 'DELETE_ACCOUNT_FAILED' }, 500);
  }
});

// 동의 기록 (개인정보보호법 제22조). 가입/이용 중 동의 사실을 누적 INSERT 로 보관한다.
// consent_type: 'terms'(이용약관·필수), 'privacy'(개인정보·필수), 'marketing'(마케팅·선택),
// 'age14'(만14세이상·필수). 동일 (user_id, consent_type) 최신 행이 현재 동의 상태.
const ALLOWED_CONSENT_TYPES = new Set(['terms', 'privacy', 'marketing', 'age14']);
// 가입/이용에 반드시 필요한 필수 동의. marketing(광고성 정보 수신) 은 선택이라 제외.
const REQUIRED_CONSENT_TYPES = ['terms', 'privacy', 'age14'] as const;
// 처리방침/약관 버전. 정책을 개정하면 이 값을 올려 기존 가입자 재동의를 유도한다.
const CURRENT_POLICY_VERSION = '1';
const DELETION_GRACE_DAYS = 30;

user.post('/consents', async (c) => {
  const userPk = c.get('userIdPK');
  const db = getDB(c.env);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON', error_code: 'INVALID_JSON' }, 400);
  }
  const list = (body as { consents?: unknown }).consents;
  if (!Array.isArray(list) || list.length === 0) {
    return c.json({ error: 'consents required', error_code: 'CONSENTS_REQUIRED' }, 400);
  }
  const rows: Array<{ type: string; version: string; agreed: boolean }> = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const type = typeof item.type === 'string' ? item.type.trim() : '';
    if (!ALLOWED_CONSENT_TYPES.has(type)) {
      return c.json({ error: `Unknown consent type: ${type}`, error_code: 'INVALID_CONSENT_TYPE' }, 400);
    }
    rows.push({
      type,
      version:
        typeof item.version === 'string' && item.version.trim()
          ? item.version.trim().slice(0, 40)
          : '1',
      agreed: item.agreed === true || item.agreed === 1 || item.agreed === '1',
    });
  }
  try {
    await withWriteTransaction(db, async (tx) => {
      for (const r of rows) {
        await tx.execute({
          sql: `INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed)
                VALUES (?, ?, ?, ?, ?)`,
          args: [crypto.randomUUID(), userPk, r.type, r.version, r.agreed ? 1 : 0],
        });
      }
    });
    return c.json({ success: true, recorded: rows.length });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to record consents', error_code: 'CONSENT_RECORD_FAILED' }, 500);
  }
});

user.get('/consents', async (c) => {
  const userPk = c.get('userIdPK');
  const db = getDB(c.env);
  try {
    const res = await db.execute({
      // created_at 은 초 단위라 같은 초에 토글하면 동점이 된다. rowid(삽입 순서)를
      // 보조 정렬로 두어 같은 초여도 항상 마지막 삽입을 최신으로 선택한다.
      sql: `SELECT consent_type, policy_version, agreed, agreed_at
            FROM user_consents WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`,
      args: [userPk],
    });
    const latest = new Map<
      string,
      { consent_type: string; policy_version: string; agreed: boolean; agreed_at: string }
    >();
    for (const row of res.rows) {
      const type = String(row.consent_type);
      if (latest.has(type)) continue;
      latest.set(type, {
        consent_type: type,
        policy_version: String(row.policy_version),
        agreed: Number(row.agreed) === 1,
        agreed_at: String(row.agreed_at),
      });
    }
    return c.json({ consents: Array.from(latest.values()) });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to load consents', error_code: 'CONSENT_LOAD_FAILED' }, 500);
  }
});

// 동의 상태 조회. 기존 가입자/신규 가입자 모두 로그인 후 이 결과로 재동의 화면을 띄운다.
// needs_consent = 필수 동의 중 하나라도 (미기록 | 미동의 | 현재 정책버전과 불일치) 이면 true.
user.get('/consents/status', async (c) => {
  const userPk = c.get('userIdPK');
  const db = getDB(c.env);
  try {
    const res = await db.execute({
      sql: `SELECT consent_type, policy_version, agreed
            FROM user_consents WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`,
      args: [userPk],
    });
    const latest = new Map<string, { agreed: boolean; version: string }>();
    for (const row of res.rows) {
      const type = String(row.consent_type);
      if (latest.has(type)) continue; // 유형별 최신 1건만
      latest.set(type, { agreed: Number(row.agreed) === 1, version: String(row.policy_version) });
    }
    const missing = REQUIRED_CONSENT_TYPES.filter((type) => {
      const cur = latest.get(type);
      return !cur || !cur.agreed || cur.version !== CURRENT_POLICY_VERSION;
    });
    return c.json({
      needs_consent: missing.length > 0,
      required: REQUIRED_CONSENT_TYPES,
      missing,
      policy_version: CURRENT_POLICY_VERSION,
    });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to load consent status', error_code: 'CONSENT_STATUS_FAILED' }, 500);
  }
});

// 탈퇴 유예 (개인정보보호법 제21조). 신청 즉시 pending_deletion 으로 두고 30일 후
// cron 이 영구파기한다. 유예 기간 내 DELETE /me/deletion 으로 철회 가능.
user.post('/me/deletion', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const now = new Date();
  const purgeAt = new Date(now.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
  try {
    const res = await db.execute({
      sql: `UPDATE users
            SET deletion_status = 'pending_deletion',
                deletion_requested_at = ?,
                deletion_purge_at = ?,
                updated_at = datetime('now')
            WHERE google_id = ? OR id = ?`,
      args: [now.toISOString(), purgeAt.toISOString(), userId, userId],
    });
    if (res.rowsAffected === 0) {
      return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
    }
    return c.json({
      success: true,
      status: 'pending_deletion',
      purge_at: purgeAt.toISOString(),
      grace_days: DELETION_GRACE_DAYS,
    });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to request deletion', error_code: 'DELETION_REQUEST_FAILED' }, 500);
  }
});

user.delete('/me/deletion', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  try {
    const res = await db.execute({
      sql: `UPDATE users
            SET deletion_status = 'active',
                deletion_requested_at = NULL,
                deletion_purge_at = NULL,
                updated_at = datetime('now')
            WHERE (google_id = ? OR id = ?) AND deletion_status = 'pending_deletion'`,
      args: [userId, userId],
    });
    if (res.rowsAffected === 0) {
      return c.json({ error: 'No pending deletion', error_code: 'NO_PENDING_DELETION' }, 404);
    }
    return c.json({ success: true, status: 'active' });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to cancel deletion', error_code: 'DELETION_CANCEL_FAILED' }, 500);
  }
});

user.get('/search', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const q = (c.req.query('q') || '').trim();

  if (q.length < 2) {
    return c.json({ users: [] });
  }

  try {
    const result = await db.execute({
      sql: `SELECT google_id, email, name, picture FROM users
            WHERE google_id != ? AND email LIKE ?
            LIMIT 10`,
      args: [userId, `%${q}%`],
    });

    return c.json({
      users: result.rows.map((r) => ({
        id: r.google_id,
        email: r.email,
        name: r.name,
        picture: r.picture,
      })),
    });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Search failed', error_code: 'SEARCH_FAILED' }, 500);
  }
});

export default user;
