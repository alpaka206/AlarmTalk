import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { logRouteError } from '../lib/logger';
import {
  deletePaidVoiceDataForUser,
  deleteSensitiveVoiceDataForUser,
} from '../lib/paid-voice-cleanup';
import { purgeUserAccount, pseudonymizeBillingForRetention } from '../lib/account-deletion';
import { withWriteTransaction } from '../lib/transactions';
import {
  validateQuietDays,
  validateQuietTime,
  validateQuietWindows,
} from '../lib/family-alarm-settings';
import { validateDynamicPromptSettings } from '../lib/dynamic-prompt-settings';
import {
  ALLOWED_CONSENT_TYPES,
  REQUIRED_CONSENT_TYPES,
  SENSITIVE_REQUIRED_CONSENTS,
  CURRENT_POLICY_VERSION,
} from '../lib/consent';

const user = new Hono<AppEnv>();

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
    // 보안: 유료 승격(plus/family)은 반드시 결제 검증(store-billing) 또는 바우처
    // 사용(voucher redemption) 경로로만 이뤄져야 한다. 이 self-service 엔드포인트는
    // 본인 강등(free)만 허용하고, 무결제 플랜 승격(페이월 우회)을 차단한다.
    if (body.plan !== 'free') {
      return c.json(
        {
          error: 'Plan upgrades require a verified purchase or voucher',
          error_code: 'PLAN_UPGRADE_NOT_ALLOWED',
        },
        403,
      );
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
    // apple_id 도 함께 매칭한다. Apple 로그인 사용자의 JWT sub 는 google_id 가 아닌
    // apple_id 컬럼에만 저장돼 있을 수 있어, 누락하면 userPk 가 null 이 되어 자식
    // PII(생체 음성 등)가 고아로 남는다(auth.ts:94 의 조회 조건과 동일하게 맞춤).
    const userRes = await db.execute({
      sql: `SELECT id FROM users WHERE google_id = ? OR apple_id = ? OR id = ? LIMIT 1`,
      args: [userId, userId, userId],
    });
    const userPk = userRes.rows.length > 0 ? String(userRes.rows[0]!.id) : null;

    // 즉시 hard delete 경로에서도 전자상거래법(5년) 결제·구독 기록 가명보존을 먼저 수행한다.
    // (cron 유예 파기 경로와 동일하게 보존 후 파기 — 어느 경로든 보존 누락이 없도록)
    const now = new Date();
    // PASSWORD_PEPPER 는 필수 시크릿. 빈 값으로 조용히 가명보존을 돌리면 진짜 pepper 로
    // 해시된 기존 기록과 어긋나(약한 가명화·불일치) 되므로, 미설정이면 진행하지 않고 실패시킨다.
    const pepper = c.env?.PASSWORD_PEPPER;
    if (!pepper) {
      throw new Error('PASSWORD_PEPPER is not configured');
    }
    await withWriteTransaction(db, async (tx) => {
      if (userPk) {
        await pseudonymizeBillingForRetention(tx, userPk, pepper, now);
      }
      await purgeUserAccount(tx, userPk, userId);
    });

    return c.json({ success: true });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to delete account', error_code: 'DELETE_ACCOUNT_FAILED' }, 500);
  }
});

// 동의 설정(ALLOWED/REQUIRED/CURRENT_POLICY_VERSION)과 충족 판정 헬퍼(needsConsent)는
// lib/consent.ts 로 일원화됐다(라우트 게이트 미들웨어와 공유). 여기서는 import 해 사용한다.
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
      return c.json(
        { error: `Unknown consent type: ${type}`, error_code: 'INVALID_CONSENT_TYPE' },
        400,
      );
    }
    rows.push({
      type,
      version:
        typeof item.version === 'string' && item.version.trim()
          ? item.version.trim().slice(0, 40)
          : CURRENT_POLICY_VERSION,
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
      if (
        rows.some(
          (row) => !row.agreed && SENSITIVE_REQUIRED_CONSENTS.some((type) => type === row.type),
        )
      ) {
        await deleteSensitiveVoiceDataForUser(tx, userPk, c.get('userId'));
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
    // 미충족 유형 목록(missing)은 응답에 그대로 노출하므로 직접 계산하되, needs_consent
    // 종합 판정은 게이트 미들웨어와 동일한 needsConsent 헬퍼로 일관성을 보장한다.
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
    return c.json(
      { error: 'Failed to load consent status', error_code: 'CONSENT_STATUS_FAILED' },
      500,
    );
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
    return c.json(
      { error: 'Failed to request deletion', error_code: 'DELETION_REQUEST_FAILED' },
      500,
    );
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
    return c.json(
      { error: 'Failed to cancel deletion', error_code: 'DELETION_CANCEL_FAILED' },
      500,
    );
  }
});

export default user;
