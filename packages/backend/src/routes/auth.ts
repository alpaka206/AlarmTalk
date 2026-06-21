import { Hono } from 'hono';
import type { Client } from '@libsql/client/web';
import type { Env, AppEnv } from '../types';
import { authMiddleware } from '../middleware/auth';
import { getDB } from '../lib/db';
import { logRouteError } from '../lib/logger';
import { typedRow } from '../lib/db-types';
import { DUMMY_BCRYPT_HASH, hashPassword, verifyPassword } from '../lib/password';
import { signAppJwt, verifyAppJwt } from '../lib/jwt';
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  GoogleLoginRequestSchema,
  AppleLoginRequestSchema,
  EmailVerificationRequestSchema,
  EmailVerificationConfirmRequestSchema,
} from '@alarmtalk/shared';
import { decodeJwtPayload, verifyAppleIdToken, verifyGoogleIdToken } from '../lib/oauth';
import { familyAlarmSettingsFromRow } from '../lib/family-alarm-settings';
import {
  EMPTY_DYNAMIC_PROMPT_SETTINGS,
  dynamicPromptSettingsFromRow,
} from '../lib/dynamic-prompt-settings';
import {
  EMAIL_VERIFICATION_DAILY_CAP,
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
  EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
  EMAIL_VERIFICATION_TTL_SECONDS,
  emailVerificationExpiresAt,
  generateEmailVerificationCode,
  hashEmailVerificationCode,
  normalizeAuthEmail,
  sendEmailVerificationCode,
  shouldExposeDebugEmailCode,
} from '../lib/email-verification';

const auth = new Hono<{ Bindings: Env }>();
const EMAIL_VERIFICATION_PURPOSE_REGISTER = 'register';

function jsonError(code: string, message: string) {
  return { error: message, error_code: code };
}

type EmailVerificationRow = {
  id: string;
  code_hash: string;
  attempts: number | string | null;
  expires_at: string;
};

type EmailVerificationCheck =
  | { ok: true; id: string }
  | { ok: false; status: 400 | 429; code: string; message: string };

async function checkEmailVerificationCode(
  db: Client,
  env: Env,
  email: string,
  code: string,
): Promise<EmailVerificationCheck> {
  const result = await db.execute({
    sql: `SELECT id, code_hash, attempts, expires_at
          FROM email_verification_codes
          WHERE email = ? AND purpose = ? AND consumed_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [email, EMAIL_VERIFICATION_PURPOSE_REGISTER],
  });

  if (result.rows.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'AUTH_EMAIL_CODE_INVALID',
      message: 'Invalid email verification code',
    };
  }

  const row = typedRow<EmailVerificationRow>(result.rows[0]!);
  if (Date.parse(row.expires_at) <= Date.now()) {
    return {
      ok: false,
      status: 400,
      code: 'AUTH_EMAIL_CODE_EXPIRED',
      message: 'Email verification code expired',
    };
  }

  const attempts = Number(row.attempts ?? 0);
  if (attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
    return {
      ok: false,
      status: 429,
      code: 'AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED',
      message: 'Too many email verification attempts',
    };
  }

  const expectedHash = await hashEmailVerificationCode(email, code, env.PASSWORD_PEPPER);
  if (expectedHash !== row.code_hash) {
    await db.execute({
      sql: `UPDATE email_verification_codes
            SET attempts = attempts + 1
            WHERE id = ?`,
      args: [row.id],
    });
    return {
      ok: false,
      status: 400,
      code: 'AUTH_EMAIL_CODE_INVALID',
      message: 'Invalid email verification code',
    };
  }

  return { ok: true, id: row.id };
}

async function consumeEmailVerificationCode(db: Client, id: string): Promise<void> {
  await db.execute({
    sql: `UPDATE email_verification_codes
          SET consumed_at = datetime('now')
          WHERE id = ?`,
    args: [id],
  });
}

auth.post('/email-code', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(jsonError('AUTH_INVALID_JSON', 'Invalid JSON body'), 400);
  }

  const parsed = EmailVerificationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(jsonError('AUTH_VALIDATION_FAILED', 'Validation failed'), 400);
  }

  const email = normalizeAuthEmail(parsed.data.email);
  const db = getDB(c.env);

  // 모든 분기에서 동일한 성공 응답을 돌려준다(계정 열거 방지). debug_code 는 코드를
  // 실제로 새로 발송했을 때만 포함한다(쿨다운/상한/기존가입으로 미발송 시 생략).
  const successResponse = (debugCode?: string) =>
    c.json({
      success: true,
      expires_in_seconds: EMAIL_VERIFICATION_TTL_SECONDS,
      ...(debugCode && shouldExposeDebugEmailCode(c.env) ? { debug_code: debugCode } : {}),
    });

  try {
    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [email],
    });
    // 이미 가입된 이메일이라도 409(AUTH_EMAIL_TAKEN)로 회원 여부를 노출하지 않고
    // 동일한 성공 응답을 반환한다. 코드도 보내지 않는다.
    if (existing.rows.length > 0) {
      return successResponse();
    }

    const nowMs = Date.now();
    // 최근 발급 이력 조회: (a) 쿨다운 내 미만료 코드가 있으면 재발송하지 않고
    // 동일 응답, (b) 최근 24시간 발급 건수가 일일 상한을 넘으면 미발송.
    const recent = await db.execute({
      sql: `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS created_at, expires_at
            FROM email_verification_codes
            WHERE email = ? AND purpose = ?
              AND created_at >= datetime('now', '-1 day')
            ORDER BY created_at DESC`,
      args: [email, EMAIL_VERIFICATION_PURPOSE_REGISTER],
    });

    const cooldownActive = recent.rows.some((r) => {
      const created = Date.parse(String(r.created_at ?? ''));
      const expires = Date.parse(String(r.expires_at ?? ''));
      if (!Number.isFinite(created)) return false;
      const withinCooldown =
        nowMs - created < EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000;
      const stillValid = Number.isFinite(expires) ? expires > nowMs : false;
      return withinCooldown && stillValid;
    });
    if (cooldownActive || recent.rows.length >= EMAIL_VERIFICATION_DAILY_CAP) {
      return successResponse();
    }

    const code = generateEmailVerificationCode();
    const codeHash = await hashEmailVerificationCode(email, code, c.env.PASSWORD_PEPPER);
    const id = crypto.randomUUID();
    const expiresAt = emailVerificationExpiresAt();

    await db.execute({
      sql: `INSERT INTO email_verification_codes
              (id, email, purpose, code_hash, expires_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, email, EMAIL_VERIFICATION_PURPOSE_REGISTER, codeHash, expiresAt],
    });

    await sendEmailVerificationCode(c.env, email, code);

    return successResponse(code);
  } catch (err) {
    logRouteError(c, err);
    const detail = err instanceof Error ? err.message : String(err);
    const status = detail.includes('Email delivery') ? 503 : 500;
    return c.json(jsonError('AUTH_EMAIL_CODE_SEND_FAILED', 'Failed to send email code'), status);
  }
});

auth.post('/email-code/verify', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(jsonError('AUTH_INVALID_JSON', 'Invalid JSON body'), 400);
  }

  const parsed = EmailVerificationConfirmRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(jsonError('AUTH_VALIDATION_FAILED', 'Validation failed'), 400);
  }

  const email = normalizeAuthEmail(parsed.data.email);
  const db = getDB(c.env);

  try {
    const check = await checkEmailVerificationCode(db, c.env, email, parsed.data.code);
    if (!check.ok) {
      return c.json(jsonError(check.code, check.message), check.status);
    }
    return c.json({ success: true });
  } catch (err) {
    logRouteError(c, err);
    return c.json(jsonError('AUTH_EMAIL_CODE_VERIFY_FAILED', 'Failed to verify email code'), 500);
  }
});

auth.post('/register', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(jsonError('AUTH_INVALID_JSON', 'Invalid JSON body'), 400);
  }

  const parsed = RegisterRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ...jsonError('AUTH_VALIDATION_FAILED', 'Validation failed'), issues: parsed.error.issues },
      400,
    );
  }

  const { email, password, name, email_verification_code } = parsed.data;
  const normalizedEmail = normalizeAuthEmail(email);
  const db = getDB(c.env);

  try {
    // 계정 열거 방지: 이미 가입된 이메일이라도 409(AUTH_EMAIL_TAKEN)로 회원 여부를
    // 노출하지 않는다. 가입된 이메일에는 /auth/email-code 가 코드를 발급하지 않으므로
    // 아래 인증 코드 검증이 게이트 역할을 한다(미가입자만 유효 코드를 보유).
    const verification = await checkEmailVerificationCode(
      db,
      c.env,
      normalizedEmail,
      email_verification_code,
    );
    if (!verification.ok) {
      return c.json(jsonError(verification.code, verification.message), verification.status);
    }

    // 인증 코드를 통과했더라도(이론상 경쟁 상태) 이미 존재하는 이메일이면 generic
    // 코드 무효 응답으로 통일한다 — 회원 가입 여부를 별도 코드로 노출하지 않는다.
    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [normalizedEmail],
    });
    if (existing.rows.length > 0) {
      return c.json(
        jsonError('AUTH_EMAIL_CODE_INVALID', 'Invalid email verification code'),
        400,
      );
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password, c.env.PASSWORD_PEPPER);

    await db.execute({
      sql: `INSERT INTO users (id, email, google_id, password_hash, name)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, normalizedEmail, id, passwordHash, name],
    });

    await consumeEmailVerificationCode(db, verification.id);

    // 신규 가입자는 token_epoch 가 항상 0 이지만(방금 INSERT), 폐기 로직과 일관되게
    // 명시적으로 박아 둔다.
    const token = await signAppJwt(
      { sub: id, email: normalizedEmail, name, epoch: 0 },
      c.env.JWT_SECRET,
    );

    return c.json(
      {
        token,
        user: {
          id,
          email: normalizedEmail,
          name,
          plan: 'free' as const,
          allow_family_alarms: false,
          family_alarm_quiet_days: [1, 2, 3, 4, 5],
          family_alarm_quiet_start: '09:00',
          family_alarm_quiet_end: '18:30',
          family_alarm_quiet_windows: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:30' }],
          dynamic_prompt_settings: EMPTY_DYNAMIC_PROMPT_SETTINGS,
        },
      },
      201,
    );
  } catch (err) {
    logRouteError(c, err);
    return c.json(jsonError('AUTH_REGISTER_FAILED', 'Registration failed'), 500);
  }
});

auth.post('/login', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(jsonError('AUTH_INVALID_JSON', 'Invalid JSON body'), 400);
  }

  const parsed = LoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(jsonError('AUTH_VALIDATION_FAILED', 'Validation failed'), 400);
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();
  const db = getDB(c.env);

  try {
    const result = await db.execute({
      sql: `SELECT id, google_id, email, password_hash, name, plan, token_epoch,
                   allow_family_alarms, family_alarm_quiet_days,
                   family_alarm_quiet_start, family_alarm_quiet_end,
                   family_alarm_quiet_windows, dynamic_prompt_settings_json
            FROM users WHERE email = ?`,
      args: [normalizedEmail],
    });

    // 계정 열거(account enumeration) 방지: 존재하지 않는 이메일·OAuth 전용 계정·
    // 비밀번호 불일치를 모두 동일한 응답(AUTH_INVALID_CREDENTIALS, 401)으로 처리한다.
    // 또한 사용자가 없을 때도 고정 더미 해시로 bcrypt 비교를 수행해, 존재 여부가
    // 응답 시간(타이밍 오라클)으로 새지 않게 한다.
    if (result.rows.length === 0) {
      await verifyPassword(password, DUMMY_BCRYPT_HASH, c.env.PASSWORD_PEPPER);
      return c.json(jsonError('AUTH_INVALID_CREDENTIALS', 'Invalid email or password'), 401);
    }

    const row = typedRow<{
      id: string;
      google_id: string | null;
      email: string;
      password_hash: string | null;
      name: string | null;
      plan: 'free' | 'plus' | 'family' | null;
      token_epoch: number | string | null;
    }>(result.rows[0]!);

    // OAuth 전용 계정(비밀번호 없음)도 더미 해시로 동일 비용 비교 후 동일 응답을
    // 반환한다. 별도 error_code 로 가입 방식을 노출하면 계정 열거에 악용된다.
    const passwordHash = row.password_hash ?? DUMMY_BCRYPT_HASH;
    const ok = await verifyPassword(password, passwordHash, c.env.PASSWORD_PEPPER);
    if (!row.password_hash || !ok) {
      return c.json(jsonError('AUTH_INVALID_CREDENTIALS', 'Invalid email or password'), 401);
    }

    if (!row.google_id) {
      await db.execute({
        sql: `UPDATE users SET google_id = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [row.id, row.id],
      });
    }

    const token = await signAppJwt(
      {
        sub: row.id,
        email: row.email,
        name: row.name ?? undefined,
        epoch: Number(row.token_epoch ?? 0),
      },
      c.env.JWT_SECRET,
    );

    const familyAlarmSettings = familyAlarmSettingsFromRow(
      row as unknown as Record<string, unknown>,
    );
    const dynamicPromptSettings = dynamicPromptSettingsFromRow(
      row as unknown as Record<string, unknown>,
    );
    return c.json({
      token,
      user: {
        id: row.id,
        email: row.email,
        name: row.name ?? '',
        plan: row.plan ?? 'free',
        allow_family_alarms: familyAlarmSettings.allowFamilyAlarms,
        family_alarm_quiet_days: familyAlarmSettings.quietDays,
        family_alarm_quiet_start: familyAlarmSettings.quietStart,
        family_alarm_quiet_end: familyAlarmSettings.quietEnd,
        family_alarm_quiet_windows: familyAlarmSettings.quietWindows,
        dynamic_prompt_settings: dynamicPromptSettings,
      },
    });
  } catch (err) {
    logRouteError(c, err);
    return c.json(jsonError('AUTH_LOGIN_FAILED', 'Login failed'), 500);
  }
});

auth.post('/google', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(jsonError('AUTH_INVALID_JSON', 'Invalid JSON body'), 400);
  }

  const parsed = GoogleLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(jsonError('AUTH_VALIDATION_FAILED', 'Validation failed'), 400);
  }

  const db = getDB(c.env);

  try {
    const google = await verifyGoogleIdToken(parsed.data.id_token, c.env.GOOGLE_CLIENT_ID);
    const googleId = google.sub;
    const email = (google.email || `${googleId}@google.local`).toLowerCase().trim();
    const name = google.name ?? '';

    const existing = await db.execute({
      sql: `SELECT id, google_id, email, name, plan, token_epoch,
                   allow_family_alarms, family_alarm_quiet_days,
                   family_alarm_quiet_start, family_alarm_quiet_end,
                   family_alarm_quiet_windows, dynamic_prompt_settings_json
            FROM users
            WHERE google_id = ? OR email = ?
            LIMIT 1`,
      args: [googleId, email],
    });

    let userId: string;
    let plan: 'free' | 'plus' | 'family';
    let tokenEpoch = 0;

    if (existing.rows.length > 0) {
      const row = typedRow<
        {
          id: string;
          google_id: string | null;
          email: string;
          name: string | null;
          plan: 'free' | 'plus' | 'family' | null;
          token_epoch: number | string | null;
        } & Record<string, unknown>
      >(existing.rows[0]!);
      userId = row.id;
      plan = row.plan ?? 'free';
      tokenEpoch = Number(row.token_epoch ?? 0);

      await db.execute({
        sql: `UPDATE users
              SET google_id = ?, email = ?, name = ?, picture = ?, updated_at = datetime('now')
              WHERE id = ?`,
        args: [googleId, email, name || row.name || null, google.picture || null, userId],
      });
    } else {
      userId = googleId;
      plan = 'free';
      await db.execute({
        sql: `INSERT INTO users (id, google_id, email, name, picture)
              VALUES (?, ?, ?, ?, ?)`,
        args: [userId, googleId, email, name || null, google.picture || null],
      });
    }

    const token = await signAppJwt(
      { sub: googleId, email, name: name || undefined, epoch: tokenEpoch },
      c.env.JWT_SECRET,
    );

    const fresh = await db.execute({
      sql: `SELECT allow_family_alarms, family_alarm_quiet_days,
                   family_alarm_quiet_start, family_alarm_quiet_end,
                   family_alarm_quiet_windows, dynamic_prompt_settings_json
            FROM users WHERE id = ? OR google_id = ? LIMIT 1`,
      args: [userId, googleId],
    });
    const familyAlarmSettings =
      fresh.rows.length > 0
        ? familyAlarmSettingsFromRow(fresh.rows[0] as Record<string, unknown>)
        : {
            allowFamilyAlarms: false,
            quietDays: [1, 2, 3, 4, 5],
            quietStart: '09:00',
            quietEnd: '18:30',
            quietWindows: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:30' }],
          };
    const dynamicPromptSettings =
      fresh.rows.length > 0
        ? dynamicPromptSettingsFromRow(fresh.rows[0] as Record<string, unknown>)
        : EMPTY_DYNAMIC_PROMPT_SETTINGS;

    return c.json({
      token,
      user: {
        id: userId,
        email,
        name,
        plan,
        allow_family_alarms: familyAlarmSettings.allowFamilyAlarms,
        family_alarm_quiet_days: familyAlarmSettings.quietDays,
        family_alarm_quiet_start: familyAlarmSettings.quietStart,
        family_alarm_quiet_end: familyAlarmSettings.quietEnd,
        family_alarm_quiet_windows: familyAlarmSettings.quietWindows,
        dynamic_prompt_settings: dynamicPromptSettings,
      },
    });
  } catch (err) {
    // 검증 실패 상세(err.message)는 서버에만 로깅하고, 클라이언트에는 provider/검증
    // 내부 정보를 반영하지 않는 안정적인 generic 메시지만 반환한다(정보 노출 방지).
    logRouteError(c, err);
    const detail = err instanceof Error ? err.message : String(err);
    const status =
      detail.includes('Google token') ||
      detail.includes('issuer') ||
      detail.includes('audience') ||
      detail.includes('expired') ||
      detail.includes('Token')
        ? 401
        : 500;
    return c.json(jsonError('AUTH_GOOGLE_FAILED', 'Google sign-in failed'), status);
  }
});

auth.post('/apple', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(jsonError('AUTH_INVALID_JSON', 'Invalid JSON body'), 400);
  }

  const parsed = AppleLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(jsonError('AUTH_VALIDATION_FAILED', 'Validation failed'), 400);
  }

  const db = getDB(c.env);

  try {
    if (!c.env.APPLE_CLIENT_ID) {
      return c.json(
        jsonError('AUTH_APPLE_CONFIG_MISSING', 'Apple client ID is not configured'),
        500,
      );
    }

    // raw nonce 를 SHA-256 으로 hex 인코딩한 뒤 id_token.nonce 와 동일성 비교.
    // 클라이언트가 nonce 를 보내지 않은 경우(legacy) verifyAppleIdToken 이
    // 내부적으로 console.warn 만 남기고 통과시킨다. 다만 클라이언트가 nonce
    // 를 빠뜨렸는데 토큰 자체엔 nonce 클레임이 있다면 점진 마이그레이션
    // 정책상 replay 가능성이 있으므로 mismatch 로 거부한다.
    let expectedNonceHash: string | undefined;
    if (parsed.data.nonce) {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(parsed.data.nonce),
      );
      expectedNonceHash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } else {
      const preview = decodeJwtPayload(parsed.data.id_token);
      if (typeof preview.nonce === 'string' && preview.nonce.length > 0) {
        throw new Error('Apple token nonce mismatch: client did not supply raw nonce');
      }
      console.warn('[auth] /auth/apple called without nonce; replay defense disabled for request');
    }

    const apple = await verifyAppleIdToken(
      parsed.data.id_token,
      c.env.APPLE_CLIENT_ID,
      expectedNonceHash,
    );
    const appleId = apple.sub;
    // 계정 연동에 쓰이는 email 은 *검증된 토큰*의 email 만 신뢰한다. 클라이언트가
    // 보낸 parsed.data.email 을 fallback 으로 쓰면, Apple 토큰에 email 이 없는
    // (재로그인) 경우 공격자가 피해자 이메일을 주입해 기존 계정에 연동·탈취할 수
    // 있다. 토큰에 email 이 없으면 충돌하지 않는 placeholder 로 둔다.
    const email = (apple.email || `${appleId}@apple.local`).toLowerCase().trim();
    const name = parsed.data.name ?? apple.name ?? '';

    const existing = await db.execute({
      sql: `SELECT id, google_id, apple_id, email, name, plan, token_epoch,
                   allow_family_alarms, family_alarm_quiet_days,
                   family_alarm_quiet_start, family_alarm_quiet_end,
                   family_alarm_quiet_windows, dynamic_prompt_settings_json
            FROM users
            WHERE apple_id = ? OR google_id = ? OR email = ?
            LIMIT 1`,
      args: [appleId, appleId, email],
    });

    let userId: string;
    let loginSub: string;
    let plan: 'free' | 'plus' | 'family';
    let resolvedName: string;
    let tokenEpoch = 0;

    if (existing.rows.length > 0) {
      const row = typedRow<
        {
          id: string;
          google_id: string | null;
          apple_id?: string | null;
          email: string;
          name: string | null;
          plan: 'free' | 'plus' | 'family' | null;
          token_epoch: number | string | null;
        } & Record<string, unknown>
      >(existing.rows[0]!);
      userId = row.id;
      loginSub = row.google_id ?? appleId;
      plan = row.plan ?? 'free';
      resolvedName = name || row.name || '';
      tokenEpoch = Number(row.token_epoch ?? 0);

      await db.execute({
        sql: `UPDATE users
              SET apple_id = ?,
                  google_id = COALESCE(google_id, ?),
                  email = ?,
                  name = COALESCE(NULLIF(?, ''), name),
                  updated_at = datetime('now')
              WHERE id = ?`,
        args: [appleId, appleId, email, name, userId],
      });
    } else {
      userId = appleId;
      loginSub = appleId;
      plan = 'free';
      resolvedName = name;
      await db.execute({
        sql: `INSERT INTO users (id, google_id, apple_id, email, name)
              VALUES (?, ?, ?, ?, ?)`,
        args: [userId, appleId, appleId, email, name || null],
      });
    }

    const token = await signAppJwt(
      { sub: loginSub, email, name: resolvedName || undefined, epoch: tokenEpoch },
      c.env.JWT_SECRET,
    );

    const fresh = await db.execute({
      sql: `SELECT allow_family_alarms, family_alarm_quiet_days,
                   family_alarm_quiet_start, family_alarm_quiet_end,
                   family_alarm_quiet_windows, dynamic_prompt_settings_json
            FROM users WHERE id = ? OR google_id = ? OR apple_id = ? LIMIT 1`,
      args: [userId, loginSub, appleId],
    });
    const familyAlarmSettings =
      fresh.rows.length > 0
        ? familyAlarmSettingsFromRow(fresh.rows[0] as Record<string, unknown>)
        : {
            allowFamilyAlarms: false,
            quietDays: [1, 2, 3, 4, 5],
            quietStart: '09:00',
            quietEnd: '18:30',
            quietWindows: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:30' }],
          };
    const dynamicPromptSettings =
      fresh.rows.length > 0
        ? dynamicPromptSettingsFromRow(fresh.rows[0] as Record<string, unknown>)
        : EMPTY_DYNAMIC_PROMPT_SETTINGS;

    return c.json({
      token,
      user: {
        id: userId,
        email,
        name: resolvedName,
        plan,
        // Phase 4-D2: 클라이언트가 ASAuthorizationAppleIDProvider.credentialState
        // 조회에 사용하는 stable Apple user identifier. iOS AuthViewModel 가
        // 세션에 보관해 foreground 진입 시 revoke 여부를 확인한다.
        apple_user_id: appleId,
        allow_family_alarms: familyAlarmSettings.allowFamilyAlarms,
        family_alarm_quiet_days: familyAlarmSettings.quietDays,
        family_alarm_quiet_start: familyAlarmSettings.quietStart,
        family_alarm_quiet_end: familyAlarmSettings.quietEnd,
        family_alarm_quiet_windows: familyAlarmSettings.quietWindows,
        dynamic_prompt_settings: dynamicPromptSettings,
      },
    });
  } catch (err) {
    // 검증 실패 상세(err.message)는 서버에만 로깅하고, 클라이언트에는 provider/검증
    // 내부 정보를 반영하지 않는 안정적인 generic 메시지만 반환한다(정보 노출 방지).
    logRouteError(c, err);
    const detail = err instanceof Error ? err.message : String(err);
    if (detail.includes('nonce mismatch')) {
      return c.json(jsonError('AUTH_APPLE_NONCE_MISMATCH', 'Apple sign-in nonce mismatch'), 401);
    }
    const status =
      detail.includes('Apple token') ||
      detail.includes('Apple JWKS') ||
      detail.includes('issuer') ||
      detail.includes('audience') ||
      detail.includes('expired') ||
      detail.includes('signature') ||
      detail.includes('algorithm') ||
      detail.includes('key') ||
      detail.includes('format')
        ? 401
        : 500;
    return c.json(jsonError('AUTH_APPLE_FAILED', 'Apple sign-in failed'), status);
  }
});

auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(jsonError('AUTH_MISSING', 'Authorization header required'), 401);
  }
  const token = authHeader.slice(7);
  try {
    const payload = await verifyAppJwt(token, c.env.JWT_SECRET);
    const db = getDB(c.env);
    // Phase 4-D2: apple_id 컬럼도 함께 조회·매칭한다. Apple 로그인 사용자의 JWT sub
    // 는 google_id 칼럼이 아닌 apple_id 칼럼에만 저장돼 있을 수 있다.
    const result = await db.execute({
      sql: `SELECT id, email, name, plan, apple_id,
                   allow_family_alarms, family_alarm_quiet_days,
                   family_alarm_quiet_start, family_alarm_quiet_end,
                   family_alarm_quiet_windows, dynamic_prompt_settings_json
            FROM users WHERE id = ? OR google_id = ? OR apple_id = ? LIMIT 1`,
      args: [payload.sub, payload.sub, payload.sub],
    });
    if (result.rows.length === 0) {
      return c.json(jsonError('AUTH_USER_NOT_FOUND', 'User not found'), 404);
    }
    const row = typedRow<
      {
        id: string;
        email: string;
        name: string | null;
        plan: 'free' | 'plus' | 'family' | null;
        apple_id: string | null;
      } & Record<string, unknown>
    >(result.rows[0]!);
    const familyAlarmSettings = familyAlarmSettingsFromRow(row);
    const dynamicPromptSettings = dynamicPromptSettingsFromRow(row);
    return c.json({
      user: {
        id: row.id,
        email: row.email,
        name: row.name ?? '',
        plan: row.plan ?? 'free',
        // Phase 4-D2: iOS 클라이언트가 credentialState 조회에 사용. 비-Apple 사용자
        // 는 null. iOS AuthUser.appleUserId 는 옵셔널이라 누락도 호환.
        apple_user_id: row.apple_id ?? null,
        allow_family_alarms: familyAlarmSettings.allowFamilyAlarms,
        family_alarm_quiet_days: familyAlarmSettings.quietDays,
        family_alarm_quiet_start: familyAlarmSettings.quietStart,
        family_alarm_quiet_end: familyAlarmSettings.quietEnd,
        family_alarm_quiet_windows: familyAlarmSettings.quietWindows,
        dynamic_prompt_settings: dynamicPromptSettings,
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return c.json(jsonError('AUTH_INVALID_TOKEN', detail), 401);
  }
});

// POST /auth/logout — 전 기기 로그아웃(sign-out-all-devices). authMiddleware 를 통과한
// 사용자의 users.token_epoch 를 +1 하여, 현재까지 발급된 모든 앱 JWT(이전 epoch)를
// 즉시 폐기한다. 다음 로그인 시 새 epoch 가 박힌 토큰이 발급된다.
// NOTE: 비밀번호 재설정 라우트는 아직 없다. 추가될 경우, 재설정 성공 시에도 반드시
//       동일하게 token_epoch 를 +1 하여 유출된 기존 세션을 무효화해야 한다.
// authMiddleware 가 userIdPK/userId 를 심으므로 별도 AppEnv 서브앱으로 마운트한다.
const logout = new Hono<AppEnv>();
logout.use('*', authMiddleware);
logout.post('/', async (c) => {
  const userPk = c.get('userIdPK');
  const userId = c.get('userId');
  const db = getDB(c.env);
  try {
    await db.execute({
      sql: `UPDATE users
            SET token_epoch = token_epoch + 1, updated_at = datetime('now')
            WHERE id = ? OR google_id = ? OR apple_id = ?`,
      args: [userPk ?? userId, userId, userId],
    });
    return c.json({ success: true });
  } catch (err) {
    logRouteError(c, err);
    return c.json(jsonError('AUTH_LOGOUT_FAILED', 'Logout failed'), 500);
  }
});
auth.route('/logout', logout);

export default auth;
