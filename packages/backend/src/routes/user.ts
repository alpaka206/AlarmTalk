import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { logRouteError } from '../lib/logger';
import {
  deleteSensitiveVoiceDataForUser,
  type DowngradedAlarm,
} from '../lib/paid-voice-cleanup';
import { notifyDowngradedAlarms } from '../lib/fcm';
import { purgeUserAccount, pseudonymizeBillingForRetention } from '../lib/account-deletion';
import { withWriteTransaction } from '../lib/transactions';
import {
  normalizeQuietWindows,
  validateQuietDays,
  validateQuietTime,
  validateQuietWindows,
} from '../lib/family-alarm-settings';
import { validateDynamicPromptSettings } from '../lib/dynamic-prompt-settings';
import { DISPLAY_NAME_MAX_LENGTH, normalizeDisplayName } from '@alarmtalk/shared';
import {
  ALLOWED_CONSENT_TYPES,
  REQUIRED_CONSENT_TYPES,
  SENSITIVE_REQUIRED_CONSENTS,
  FEATURE_CONSENT_TYPES,
  OPTIONAL_CONSENT_TYPES,
  CURRENT_POLICY_VERSION,
  consentAnswerIsCurrent,
  loadLatestConsents,
  missingConsentTypesFrom,
} from '../lib/consent';
import { appleSignInConfig, revokeAppleToken } from '../lib/apple-revoke';

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
    // trim 만으로는 부족하다 — 제로폭·양방향 문자는 공백이 아니라서 살아남고, 그대로
    // 가족 멤버 목록·알람 보낸사람에 노출된다. 규칙은 shared 한 곳에서만 정의한다.
    const trimmed = normalizeDisplayName(body.name);
    if (trimmed.length === 0 || trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
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

  // 저장은 family_alarm_quiet_windows(JSON) 하나로 일원화한다 — 과거의 단일 필드 3컬럼(#29)은
  // windows[0] 을 그대로 베낀 미러였고 #83 에서 제거됐다. API 계약(입력·출력)은 그대로 유지해
  // windows 없이 3필드만 보내는 클라이언트도 계속 동작하게 한다(그 경우 한 창으로 합성해 저장).
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
    resolvedQuietWindows = windows;
    resolvedQuietDays = firstWindow.days;
    resolvedQuietStart = firstWindow.start;
    resolvedQuietEnd = firstWindow.end;
  } else {
    // 레거시 입력 경로: 온 필드만 검증한 뒤 현재 windows[0] 위에 덮어써 단일 창으로 합성한다
    // (부분 업데이트가 나머지 값을 잃지 않게 한다).
    const hasLegacyDays =
      'family_alarm_quiet_days' in body && body.family_alarm_quiet_days !== undefined;
    const hasLegacyStart =
      'family_alarm_quiet_start' in body && body.family_alarm_quiet_start !== undefined;
    const hasLegacyEnd =
      'family_alarm_quiet_end' in body && body.family_alarm_quiet_end !== undefined;

    if (hasLegacyDays) {
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
      resolvedQuietDays = days;
    }
    if (hasLegacyStart) {
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
      resolvedQuietStart = time;
    }
    if (hasLegacyEnd) {
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
      resolvedQuietEnd = time;
    }

    if (hasLegacyDays || hasLegacyStart || hasLegacyEnd) {
      const currentRow = await db.execute({
        sql: 'SELECT family_alarm_quiet_windows FROM users WHERE google_id = ? OR id = ? LIMIT 1',
        args: [userId, userId],
      });
      const current = normalizeQuietWindows(currentRow.rows[0]?.family_alarm_quiet_windows);
      const base = current[0] ?? { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:30' };
      const merged = {
        days: resolvedQuietDays ?? base.days,
        start: resolvedQuietStart ?? base.start,
        end: resolvedQuietEnd ?? base.end,
      };
      const windows = [merged, ...current.slice(1)];
      updates.push('family_alarm_quiet_windows = ?');
      args.push(JSON.stringify(windows));
      resolvedQuietWindows = windows;
      resolvedQuietDays = merged.days;
      resolvedQuietStart = merged.start;
      resolvedQuietEnd = merged.end;
    }
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
          WHERE id = ?`,
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

user.delete('/me', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    // 토큰이 담고 있던 로그인 식별자. userId 는 미들웨어가 users.id 로 정규화하므로,
    // 통일 이전에 user_id 컬럼에 로그인 식별자가 저장된 자식 데이터(알람·메시지·목소리·
    // 생성 오디오·R2 삭제 큐)까지 지우려면 이 값을 함께 넘겨야 한다. 빠뜨리면 users 행만
    // 지워지고 나머지 PII 가 고아로 남는다(유예 파기 cron 은 row.google_id 를 읽어 이걸 피한다).
    const userLoginId = c.get('userLoginId') || userId;
    const userRes = await db.execute({
      sql: `SELECT id, apple_refresh_token FROM users WHERE google_id = ? OR id = ? LIMIT 1`,
      args: [userLoginId, userId],
    });
    const userPk = userRes.rows.length > 0 ? String(userRes.rows[0]!.id) : null;

    // 애플 연결을 끊는다 — **행을 지우기 전에.** 지운 뒤에는 refresh token 을 읽을 곳이
    // 없어 영영 폐기하지 못하고, 사용자의 '설정 → Apple로 로그인' 목록에 우리 앱이
    // 남는다(애플 심사 5.1.1(v)).
    //
    // ⚠ **실패해도 탈퇴는 진행한다.** 애플이 잠깐 죽었다고 탈퇴를 막으면 사용자는 자기
    // 데이터를 못 지운다 — 그건 폐기 누락보다 나쁘다. 대신 로그에 남겨 추적한다.
    const appleRefreshToken = userRes.rows.length > 0
      ? (userRes.rows[0]!.apple_refresh_token as string | null)
      : null;
    if (appleRefreshToken) {
      const signInConfig = appleSignInConfig(c.env, c.env.APPLE_BUNDLE_ID);
      if (signInConfig) {
        try {
          await revokeAppleToken(signInConfig, appleRefreshToken);
        } catch (err) {
          logRouteError(c, err);
        }
      }
    }

    // 즉시 hard delete 경로에서도 전자상거래법(5년) 결제·구독 기록 가명보존을 먼저 수행한다.
    // (cron 유예 파기 경로와 동일하게 보존 후 파기 — 어느 경로든 보존 누락이 없도록)
    const now = new Date();
    // PASSWORD_PEPPER 는 필수 시크릿. 빈 값으로 조용히 가명보존을 돌리면 진짜 pepper 로
    // 해시된 기존 기록과 어긋나(약한 가명화·불일치) 되므로, 미설정이면 진행하지 않고 실패시킨다.
    const pepper = c.env?.PASSWORD_PEPPER;
    if (!pepper) {
      throw new Error('PASSWORD_PEPPER is not configured');
    }
    const purgeNotifications = await withWriteTransaction(db, async (tx) => {
      if (userPk) {
        await pseudonymizeBillingForRetention(tx, userPk, pepper, now);
      }
      return purgeUserAccount(tx, userPk, userLoginId);
    });

    // 내 목소리를 들고 있는 기기들에 **커밋 후에** 알린다 — 받은 알람은 pull 신호로
    // (family_alarm), 본인 알람·미동기화 알람은 접근권 재확인으로(voice_access_revoked).
    // 안 보내면 다음 주기까지 탈퇴자의 복제 목소리로 계속 울린다.
    // 실패해도 탈퇴는 성공이다(즉시성만 잃고 주기 재조회가 폴백).
    try {
      await notifyDowngradedAlarms(
        db,
        c.env,
        purgeNotifications.downgradedAlarms,
        purgeNotifications.voiceAccessRevokedUserIds,
      );
    } catch (err) {
      logRouteError(c, err);
    }

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
  // 기록되는 정책 버전은 **서버가 정한다**. 항목별 `version` 필드는 받기만 하고 버린다 —
  // 클라 값을 그대로 저장하면 조작되거나 버그 있는 앱이 보낸 '999' 같은 기록이, 재동의
  // 판정이 `>=` 인 탓에 이후 어떤 개정으로 CONSENT_MIN_POLICY_VERSION 을 올려도 그 유형의
  // 재동의를 영구히 무력화한다.
  //
  // 다만 서버가 무조건 도장을 찍으면 반대쪽 구멍이 생긴다. 법무 문서 전문은 **APK 에 실려**
  // 있어(빌드 시 docs/legal 복사) 화면에 뜨는 내용은 설치된 앱 버전에 고정된다. 문서가
  // 개정돼 서버가 v5 가 됐는데 구버전 앱이 살아 있으면, 그 앱은 v4 본문을 보여주면서 v5
  // 동의 기록을 만든다 — 이용자가 본 적 없는 문서에 동의한 것으로 남고, 진짜 v5 재동의는
  // 이미 충족된 것으로 판정돼 영영 안 뜬다.
  //
  // 그래서 클라는 **자기가 실제로 띄운 문서의 버전**(document_version)을 함께 보내야 하고,
  // 그것이 지금 게시된 버전과 다르면 기록하지 않는다. 기록되는 값은 여전히 서버 상수다 —
  // document_version 은 저장용이 아니라 '같은 문서를 보고 있는가' 를 확인하는 값이다.
  const documentVersion = (body as { document_version?: unknown }).document_version;
  if (typeof documentVersion !== 'string' || documentVersion.trim() === '') {
    return c.json(
      {
        error: 'document_version required',
        error_code: 'DOCUMENT_VERSION_REQUIRED',
        current: CURRENT_POLICY_VERSION,
      },
      400,
    );
  }
  if (documentVersion.trim() !== CURRENT_POLICY_VERSION) {
    return c.json(
      {
        error: 'Consent document is out of date',
        error_code: 'POLICY_VERSION_MISMATCH',
        current: CURRENT_POLICY_VERSION,
        submitted: documentVersion.trim(),
      },
      409,
    );
  }
  const rows: Array<{ type: string; agreed: boolean }> = [];
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
      agreed: item.agreed === true || item.agreed === 1 || item.agreed === '1',
    });
  }
  try {
    // 동의 철회로 강등된 알람들 — 커밋 후에 신호를 보내야 한다(롤백될 수 있는 변경을
    // 미리 알리지 않는다). 보관 만료 스윕과 같은 이유로 알람 동기화 신호가 필요하다:
    // 서버가 수신자의 가족알람을 sound-only 로 내리고 R2 오브젝트를 지워도, 신호가
    // 없으면 수신자는 다음 폴백 pull 까지 캐시된 녹음으로 계속 울린다.
    // 같은 유형이 여러 번 담겨 오면 **마지막 값이 유효 동의**다(GET /consents 가 삽입 순서
    // 역순으로 최신을 고른다). 그러니 철회 판정도 마지막 값으로 해야 한다 — 'false 가 하나라도
    // 있으면'으로 보면 [false, true] 처럼 결국 동의한 요청에도 민감 음성 데이터를 되돌릴 수 없게
    // 지워 버린다.
    const finalAgreedByType = new Map<string, boolean>();
    for (const r of rows) finalAgreedByType.set(r.type, r.agreed);

    // ⚠ **재동의 화면에서 안 누른 것을 '철회' 로 읽으면 안 된다.**
    //
    // 민감 동의(voice_biometric)는 `optional` 로 내려가므로 동의 화면의 CTA 가 체크를
    // 요구하지 않는다. 그 상태에서 이미 동의한 사용자가 화면을 그냥 통과하면 `agreed=false`
    // 가 제출되는데, 그걸 철회로 처리하면 **ElevenLabs 보이스와 R2 원본이 영구 삭제된다.**
    // 사용자는 무언가를 지운다는 자각조차 없다.
    //
    // 판별 기준은 요청 모양이 아니라 **지금 그 유형을 다시 묻고 있었는가** 다:
    //  - 재동의 대상(`collect`)에 있었다 → 화면이 물어본 것이다. false 는 '안 눌렀다' 이지
    //    '지워 달라' 가 아니다. 기록만 하고 파기하지 않는다.
    //  - 대상이 아니었다 → 아무도 묻지 않았는데 false 가 왔다 = 설정 화면의 명시적 철회다
    //    (`withdrawVoiceBiometricConsent`). 그때만 파기한다.
    //
    // 요청 모양(항목 1개인가)으로 가르지 않는 이유: 개정이 민감 유형 하나만 대상으로 하면
    // 동의 화면도 항목 1개를 보내므로 둘이 구분되지 않는다.
    //
    // 서버에서 막으므로 **구버전 클라도 즉시 보호된다** — 클라 수정을 기다리지 않는다.
    const latestBeforeWrite = await loadLatestConsents(db, userPk);
    const reAskedTypes = new Set([
      ...missingConsentTypesFrom(latestBeforeWrite, REQUIRED_CONSENT_TYPES),
      ...[...FEATURE_CONSENT_TYPES, ...OPTIONAL_CONSENT_TYPES].filter(
        (type) => !consentAnswerIsCurrent(latestBeforeWrite, type),
      ),
    ]);
    const withdrewSensitiveConsent = SENSITIVE_REQUIRED_CONSENTS.some(
      (type) => finalAgreedByType.get(type) === false && !reAskedTypes.has(type),
    );

    let downgradedAlarms: DowngradedAlarm[] = [];
    let voiceAccessRevokedUserIds: string[] = [];
    await withWriteTransaction(db, async (tx) => {
      for (const r of rows) {
        await tx.execute({
          sql: `INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed)
                VALUES (?, ?, ?, ?, ?)`,
          args: [crypto.randomUUID(), userPk, r.type, CURRENT_POLICY_VERSION, r.agreed ? 1 : 0],
        });
      }
      if (withdrewSensitiveConsent) {
        const revocation = await deleteSensitiveVoiceDataForUser(
          tx,
          userPk,
          c.get('userLoginId'),
        );
        downgradedAlarms = revocation.downgradedAlarms;
        voiceAccessRevokedUserIds = revocation.voiceAccessRevokedUserIds;
      }
    });
    // 철회했으면 알람 행을 못 찾았어도 이 계정에 목소리 접근권 상실을 알린다 — 서버에 아직
    // 동기화되지 않은 로컬 알람은 여기서 안 잡히는데, 발사는 로컬이고 울림 시점 동의 게이트도
    // 없어 그 기기는 지워진 녹음으로 계속 울린다.
    await notifyDowngradedAlarms(
      db,
      c.env,
      downgradedAlarms,
      voiceAccessRevokedUserIds,
    );
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
// 판정은 게이트 미들웨어와 같은 lib/consent 헬퍼로 하고(한 번 읽어 세 목록을 뽑는다),
// 클라이언트는 collect 에 담긴 유형만 화면에 띄우고 그 유형만 제출한다.
user.get('/consents/status', async (c) => {
  const userPk = c.get('userIdPK');
  const db = getDB(c.env);
  try {
    const latest = await loadLatestConsents(db, userPk);
    // needs_consent 는 필수 유형 기준 — 선택/민감 동의 때문에 가입 게이트가 뜨면 안 된다.
    const missing = missingConsentTypesFrom(latest, REQUIRED_CONSENT_TYPES);
    // 이번 동의 화면에서 받아야 하는 유형. 이미 유효한 기록이 있는 유형은 넣지 않는다 —
    // 클라가 안 띄운 유형을 제출하지 않아야 기존 marketing 동의가 살아남는다.
    // 선택 동의는 '거절'도 유효한 응답이라 agreed 가 아니라 버전만 본다.
    // 기능 동의(voice_biometric)·선택 동의(marketing)는 '거절' 도 유효한 응답이라 agreed 가
    // 아니라 버전만 본다 — 한 번 답한 사람에게 다시 묻지 않는다. 거절한 사람은 그 기능을
    // 실제로 쓰려는 순간(목소리 등록 화면)에만 다시 만난다.
    const collect = [
      ...missing,
      ...[...FEATURE_CONSENT_TYPES, ...OPTIONAL_CONSENT_TYPES].filter(
        (type) => !consentAnswerIsCurrent(latest, type),
      ),
    ];
    // 마케팅 재유도 — **거절한 사람에게만**, 그리고 **다른 이유로 화면이 이미 뜰 때만** 덧붙인다.
    //
    // 왜 이 두 조건인가:
    //  - `collect.length > 0` 이 없으면: 거절자는 이 항목 하나 때문에 동의 화면을 **영원히**
    //    본다. 안 누르면 계속 남으니 빠져나갈 방법이 없다. 이 가드가 `needs_collection` 불변도
    //    함께 보장한다(마케팅이 화면을 여는 유일한 사유가 되지 않는다).
    //  - `agreed === false` 가 아니면(예: 미응답까지 포함하면): 위 filter 가 이미 미응답을
    //    잡으므로 중복이고, **동의한 사람**까지 넣으면 화면에 뜬 항목을 무심코 지나칠 때
    //    멀쩡한 동의가 사라진다(prechecked 로 완화되지만 애초에 넣지 않는 게 맞다).
    //
    // 빈도: 개정으로 다른 유형의 최소 버전이 오를 때만 = 개정 1회당 1번. 제출하면 거절이
    // 새 버전으로 다시 기록돼 그 회차는 닫힌다.
    //
    // ⚠ **지금은 발동하지 않는다.** CONSENT_MIN_POLICY_VERSION 6종이 전부 3 이라 위 collect 가
    // 늘 비어 있다. 실제로 켜는 레버는 그 상수를 올리는 것이고, 그건 별도 결재 사항이다.
    // ⚠ **앱 내 화면에서만 유도한다.** 푸시·이메일로 재동의를 권하면 그 메시지 자체가
    // 영리목적 광고성 정보로 평가돼 거절자에게는 정보통신망법 제50조 위반 소지가 있다.
    if (collect.length > 0 && latest.get('marketing')?.agreed === false) {
      if (!collect.includes('marketing')) collect.push('marketing');
    }
    return c.json({
      // needs_consent 와 needs_collection 은 의미가 다르다. 섞어 쓰면 안 된다.
      //  - needs_consent: **앱을 못 쓰게 막는 게이트** 신호(필수 유형 기준). 선택 동의
      //    때문에 앱이 잠기면 안 되므로 여기에는 marketing 이 절대 들어가지 않는다.
      //  - needs_collection: **동의 화면을 한 번 띄워 물어봐야 한다**는 신호(= collect 비어
      //    있지 않음). 선택 유형만 재수집 대상일 때도 true 다. 클라는 이걸로 화면을 띄우되
      //    선택 항목은 체크 없이 통과시킨다. 이게 없으면 앞으로 개정이
      //    CONSENT_MIN_POLICY_VERSION.marketing 만 올렸을 때 collect 에는 marketing 이
      //    담기는데 needs_consent 는 false 라 화면이 영영 안 떠 재수집이 일어나지 않는다.
      needs_consent: missing.length > 0,
      needs_collection: collect.length > 0,
      required: REQUIRED_CONSENT_TYPES,
      missing,
      collect,
      // 가입 화면에 '선택' 으로 함께 띄우는 유형. 클라가 이 목록을 보고 필수와 다르게
      // 그린다(체크 안 해도 CTA 통과).
      optional: [...FEATURE_CONSENT_TYPES, ...OPTIONAL_CONSENT_TYPES],
      // `collect` 중 **이미 동의해 둔** 유형. 클라는 이걸 화면의 **초기 체크 상태**로 쓴다.
      //
      // 왜 필요한가: 선택/기능 동의는 체크 없이도 CTA 가 통과된다. 초기 상태를 항상 미체크로
      // 두면, 이미 동의한 사용자가 화면을 그냥 지나가는 순간 그 동의가 `agreed=false` 로
      // 뒤집힌다 — 사용자는 아무것도 바꾼 적이 없는데 목소리 기능이 막히고(sensitive_missing),
      // 마케팅 수신 동의가 사라진다. **가진 것을 보여주는 것**이지 미리 눌러 주는 게 아니다.
      //
      // ⚠ 필수 유형은 여기 담지 않는다 — 재동의는 명시적 체크로 받아야 한다.
      prechecked: collect.filter(
        (type) =>
          !REQUIRED_CONSENT_TYPES.includes(type as (typeof REQUIRED_CONSENT_TYPES)[number]) &&
          latest.get(type)?.agreed === true,
      ),
      // 음성 라우트가 요구하는 민감 동의 중 아직 없는 것. overseas_transfer 는 가입 필수라
      // 보통 비어 있고, 가입 때 voice_biometric 을 거절한 사람만 여기에 남는다 — 클라는
      // 목소리 등록 화면에서 이 값으로 인라인 동의 항목을 띄운다.
      sensitive_missing: missingConsentTypesFrom(latest, SENSITIVE_REQUIRED_CONSENTS),
      // 이 계정에 동의 기록이 하나라도 있으면 '개정에 따른 재동의' 다. 처음 가입한 사람과
      // 문구가 달라야 한다 — 이미 동의했던 사람에게 '서비스 이용을 위해 동의해 주세요' 는
      // 왜 또 묻는지 설명하지 못한다.
      has_prior_consent: latest.size > 0,
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
