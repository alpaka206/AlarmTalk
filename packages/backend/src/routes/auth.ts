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
  PasswordResetRequestSchema,
  PasswordResetConfirmRequestSchema,
  clampDisplayName,
} from '@alarmtalk/shared';
import { verifyGoogleIdToken } from '../lib/oauth';
import { verifyAppleIdToken } from '../lib/apple-oauth';
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
  sendPasswordResetCode,
  shouldExposeDebugEmailCode,
} from '../lib/email-verification';

const auth = new Hono<{ Bindings: Env }>();
const EMAIL_VERIFICATION_PURPOSE_REGISTER = 'register';
const EMAIL_VERIFICATION_PURPOSE_RESET = 'reset';

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
  purpose: string = EMAIL_VERIFICATION_PURPOSE_REGISTER,
): Promise<EmailVerificationCheck> {
  const result = await db.execute({
    sql: `SELECT id, code_hash, attempts, expires_at
          FROM email_verification_codes
          WHERE email = ? AND purpose = ? AND consumed_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [email, purpose],
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

type ExistingAccount = { kind: 'password' } | { kind: 'social'; provider: 'google' };

// 가입 시도 이메일이 이미 존재하면 그 가입 방식을 분류한다(중복 가입 차단·로그인 유도용).
//   - password_hash 가 있으면 이메일/비밀번호 계정 → AUTH_EMAIL_TAKEN(로그인 유도)
//   - 없으면 소셜 계정 → AUTH_EMAIL_SOCIAL (Android 전용이라 provider 는 google 뿐)
// 주의(의도된 트레이드오프): 이 분기는 "이 이메일이 가입돼 있는가"를 노출하므로 계정 열거
// (account enumeration)가 가능해진다. 제품 요구(중복 이메일이면 회원가입을 막고 로그인으로
// 안내)를 위해 의도적으로 노출하며, /api/auth/* 의 authRateLimitMiddleware 로 무차별 조회를
// 제한한다. (로그인 라우트는 기존대로 generic 응답을 유지해 비밀번호 추측 표면은 넓히지 않는다.)
async function classifyExistingAccount(db: Client, email: string): Promise<ExistingAccount | null> {
  const result = await db.execute({
    sql: 'SELECT password_hash FROM users WHERE email = ? LIMIT 1',
    args: [email],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0]!;
  const passwordHash = row.password_hash;
  if (passwordHash != null && String(passwordHash).length > 0) {
    return { kind: 'password' };
  }
  return { kind: 'social', provider: 'google' };
}

function existingAccountConflict(account: ExistingAccount) {
  if (account.kind === 'password') {
    return { body: jsonError('AUTH_EMAIL_TAKEN', 'Email already registered'), status: 409 as const };
  }
  return {
    body: {
      ...jsonError('AUTH_EMAIL_SOCIAL', 'Email registered via social login'),
      provider: account.provider,
    },
    status: 409 as const,
  };
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

  // 신규(미가입) 이메일에만 코드를 발송한다. debug_code 는 코드를 실제로 새로 발송했을
  // 때만 포함한다(쿨다운/상한으로 미발송 시 생략).
  const successResponse = (debugCode?: string) =>
    c.json({
      success: true,
      expires_in_seconds: EMAIL_VERIFICATION_TTL_SECONDS,
      ...(debugCode && shouldExposeDebugEmailCode(c.env) ? { debug_code: debugCode } : {}),
    });

  try {
    // 이미 가입된 이메일이면 가입 방식에 맞는 409 로 회원가입을 막고 로그인으로 안내한다.
    // (AUTH_EMAIL_TAKEN=이메일/비번 계정, AUTH_EMAIL_SOCIAL+provider=소셜 계정)
    const existingAccount = await classifyExistingAccount(db, email);
    if (existingAccount) {
      const conflict = existingAccountConflict(existingAccount);
      return c.json(conflict.body, conflict.status);
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

// 비밀번호 재설정 코드 요청. 계정 존재 여부를 응답으로 드러내지 않는다(enumeration 방지):
// 비밀번호 계정이 아니면(미가입·소셜) 코드를 보내지 않고 동일한 성공 응답을 돌려준다.
auth.post('/password-reset', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(jsonError('AUTH_INVALID_JSON', 'Invalid JSON body'), 400);
  }

  const parsed = PasswordResetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(jsonError('AUTH_VALIDATION_FAILED', 'Validation failed'), 400);
  }

  const email = normalizeAuthEmail(parsed.data.email);
  const db = getDB(c.env);

  // 코드를 실제로 새로 발송했을 때만 debug_code 를 포함한다.
  const successResponse = (debugCode?: string) =>
    c.json({
      success: true,
      expires_in_seconds: EMAIL_VERIFICATION_TTL_SECONDS,
      ...(debugCode && shouldExposeDebugEmailCode(c.env) ? { debug_code: debugCode } : {}),
    });

  try {
    // 비밀번호 계정에만 재설정 코드를 보낸다(소셜/미가입은 재설정할 비밀번호가 없음).
    const account = await classifyExistingAccount(db, email);
    if (!account || account.kind !== 'password') {
      return successResponse();
    }

    const nowMs = Date.now();
    const recent = await db.execute({
      sql: `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS created_at, expires_at
            FROM email_verification_codes
            WHERE email = ? AND purpose = ?
              AND created_at >= datetime('now', '-1 day')
            ORDER BY created_at DESC`,
      args: [email, EMAIL_VERIFICATION_PURPOSE_RESET],
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
      args: [id, email, EMAIL_VERIFICATION_PURPOSE_RESET, codeHash, expiresAt],
    });

    await sendPasswordResetCode(c.env, email, code);

    return successResponse(code);
  } catch (err) {
    logRouteError(c, err);
    const detail = err instanceof Error ? err.message : String(err);
    const status = detail.includes('Email delivery') ? 503 : 500;
    return c.json(jsonError('AUTH_EMAIL_CODE_SEND_FAILED', 'Failed to send email code'), status);
  }
});

// 비밀번호 재설정 확정: 코드 검증 → 새 비밀번호 해시로 교체 + token_epoch+1(유출된 기존 세션
// 전부 폐기) → 코드 소모. 비밀번호 계정에만 허용한다.
auth.post('/password-reset/confirm', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(jsonError('AUTH_INVALID_JSON', 'Invalid JSON body'), 400);
  }

  const parsed = PasswordResetConfirmRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ...jsonError('AUTH_VALIDATION_FAILED', 'Validation failed'), issues: parsed.error.issues },
      400,
    );
  }

  const email = normalizeAuthEmail(parsed.data.email);
  const db = getDB(c.env);

  try {
    const check = await checkEmailVerificationCode(
      db,
      c.env,
      email,
      parsed.data.code,
      EMAIL_VERIFICATION_PURPOSE_RESET,
    );
    if (!check.ok) {
      return c.json(jsonError(check.code, check.message), check.status);
    }

    // 코드가 유효해도 비밀번호 계정이 아니면(소셜/미가입) 재설정하지 않는다.
    const account = await classifyExistingAccount(db, email);
    if (!account || account.kind !== 'password') {
      return c.json(jsonError('AUTH_EMAIL_CODE_INVALID', 'Invalid email verification code'), 400);
    }

    const passwordHash = await hashPassword(parsed.data.password, c.env.PASSWORD_PEPPER);
    await db.execute({
      sql: `UPDATE users
            SET password_hash = ?, token_epoch = token_epoch + 1, updated_at = datetime('now')
            WHERE email = ?`,
      args: [passwordHash, email],
    });

    await consumeEmailVerificationCode(db, check.id);

    return c.json({ success: true });
  } catch (err) {
    logRouteError(c, err);
    return c.json(jsonError('AUTH_PASSWORD_RESET_FAILED', 'Failed to reset password'), 500);
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
    // 정상 흐름에선 /auth/email-code 가 미가입 이메일에만 코드를 발급하므로 인증 코드가
    // 1차 게이트다. 여기선 방어적으로 한 번 더 검증한다.
    const verification = await checkEmailVerificationCode(
      db,
      c.env,
      normalizedEmail,
      email_verification_code,
    );
    if (!verification.ok) {
      return c.json(jsonError(verification.code, verification.message), verification.status);
    }

    // 인증 코드를 통과했더라도(이론상 경쟁 상태) 이미 존재하는 이메일이면 가입 방식에 맞는
    // 409 로 막고 로그인으로 안내한다(email-code 와 동일한 정책).
    const existingAccount = await classifyExistingAccount(db, normalizedEmail);
    if (existingAccount) {
      const conflict = existingAccountConflict(existingAccount);
      return c.json(conflict.body, conflict.status);
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password, c.env.PASSWORD_PEPPER);

    // google_id 는 **구글 계정 식별자 전용**이다. 과거에는 이메일 가입자에게도
    // google_id = users.id 를 박아 넣어(외부 식별자 공간 오염) 나중에 같은 이메일로
    // 구글 로그인하면 그 값이 덮어써지며 식별자가 갈라졌다. 이제 NULL 로 둔다.
    await db.execute({
      sql: `INSERT INTO users (id, email, google_id, password_hash, name)
            VALUES (?, ?, NULL, ?, ?)`,
      args: [id, normalizedEmail, passwordHash, name],
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
                   allow_family_alarms,
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
    // 구성 가드. GOOGLE_CLIENT_ID 미설정 시 aud 검증이 무력화되면
    // 안 되므로(oauth.ts 는 fail-closed) 명시적으로 500 을 반환한다.
    if (!c.env.GOOGLE_CLIENT_ID) {
      return c.json(jsonError('AUTH_GOOGLE_CONFIG_MISSING', 'Google client ID is not configured'), 500);
    }
    const google = await verifyGoogleIdToken(parsed.data.id_token, c.env.GOOGLE_CLIENT_ID);
    const googleId = google.sub;
    const email = (google.email || `${googleId}@google.local`).toLowerCase().trim();
    // 구글이 준 이름도 **외부 입력**이다. 우리 규칙을 통과시키고 상한으로 자른다 —
    // 검증 없이 받으면 앱·PATCH 경로에만 있는 30자·보이지 않는 문자 규칙이 이 문으로 새 나간다.
    const name = clampDisplayName(google.name ?? '');

    const existing = await db.execute({
      sql: `SELECT id, google_id, email, name, plan, token_epoch,
                   allow_family_alarms,
                   family_alarm_quiet_windows, dynamic_prompt_settings_json
            FROM users
            WHERE google_id = ? OR email = ?
            LIMIT 1`,
      args: [googleId, email],
    });

    let userId: string;
    let plan: 'free' | 'plus' | 'family';
    let tokenEpoch = 0;
    // DB 에 쓰는 이름과 응답·JWT 에 담는 이름은 **같은 값이어야 한다.** 갈라지면 로그인
    // 직후엔 구글 이름이 보이다가 새로고침하면 저장된 닉네임으로 바뀐다.
    let effectiveName = name;

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
      // 이미 이름이 있으면 그게 사용자가 고른 닉네임이다. 구글 이름은 빈 칸만 채운다.
      //
      // 단 **저장된 값도 규칙을 통과시킨다.** 옛 스키마(가입 max(64)·trim 없음)로 만들어진
      // 행에는 공백뿐인 이름, 보이지 않는 문자, 64자짜리가 남아 있을 수 있다. 그대로
      // 이기게 두면 이 문으로 다시 DB·JWT·응답에 실려 나가, 규칙을 한 곳으로 모은 의미가
      // 없어진다. 정리해서 남는 게 없으면 구글 이름으로 고쳐 준다(Codex #671 P2).
      const storedName = clampDisplayName(row.name ?? '');
      effectiveName = storedName || name;

      await db.execute({
        sql: `UPDATE users
              SET google_id = ?, email = ?, name = ?, updated_at = datetime('now')
              WHERE id = ?`,
        // **저장된 이름이 이긴다.** 반대였다 — 재로그인할 때마다 구글 프로필 이름이
        // 사용자가 앱에서 고친 닉네임을 덮어써서, 닉네임 수정이 다음 로그인에 되돌아갔다.
        // 구글 이름은 아직 이름이 없을 때만 채운다.
        args: [googleId, email, effectiveName || null, userId],
      });
    } else {
      // 신규 구글 가입도 서버 생성 UUID 를 PK 로 쓴다. 과거에는 googleId 를 그대로 PK 로
      // 삼아 users.id 가 외부 식별자였는데, 그러면 내부 관계 키가 provider 에 종속된다.
      userId = crypto.randomUUID();
      plan = 'free';
      await db.execute({
        sql: `INSERT INTO users (id, google_id, email, name)
              VALUES (?, ?, ?, ?)`,
        args: [userId, googleId, email, name || null],
      });
    }

    // JWT sub 은 **항상 users.id** 다. 과거에는 googleId 를 sub 으로 발급했는데, 이메일로
    // 먼저 가입한 계정이 나중에 같은 이메일로 구글 로그인하면(위 email 매칭 분기) google_id
    // 만 덮어써지고 id 는 UUID 로 남아 sub != users.id 로 갈라졌다. 그 순간부터
    // `WHERE google_id = ?` 로 조회하는 라우트와 users.id 로 조회하는 라우트가 서로 다른
    // 사용자를 보게 되어(구독·가족그룹·코드등록이 조용히 0행) 데이터가 반으로 쪼개졌다.
    const token = await signAppJwt(
      { sub: userId, email, name: effectiveName || undefined, epoch: tokenEpoch },
      c.env.JWT_SECRET,
    );

    const fresh = await db.execute({
      sql: `SELECT allow_family_alarms,
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
        name: effectiveName,
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

// Sign in with Apple. 구조는 POST /google 과 같고 식별자 컬럼만 apple_id 다.
//
// 애플 고유의 두 가지:
//  1) **이름은 최초 1회만 온다.** 애플은 첫 로그인 응답에만 fullName 을 주고 그 뒤로는
//     영영 안 준다. 그래서 앱이 그때 받은 값을 `full_name` 으로 보내 주고, 여기서
//     빈 칸을 채우는 데만 쓴다.
//  2) **이메일 가리기(Private Relay).** 사용자가 이메일 가리기를 고르면 `@privaterelay
//     .appleid.com` 주소가 온다. 정상 값이라 그대로 저장한다. 아예 이메일이 없는 경우도
//     있어(재로그인 시 미포함) 구글과 같은 방식으로 합성 주소를 쓴다.
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
    // 구성 가드 — 구글과 같은 이유로 fail-closed. aud(번들 ID)를 모르면 **다른 앱용으로
    // 발급된 유효한 애플 토큰**도 통과해 그 앱 사용자가 우리 계정을 차지할 수 있다.
    if (!c.env.APPLE_BUNDLE_ID) {
      return c.json(
        jsonError('AUTH_APPLE_CONFIG_MISSING', 'Apple bundle ID is not configured'),
        500,
      );
    }

    const apple = await verifyAppleIdToken(
      parsed.data.identity_token,
      c.env.APPLE_BUNDLE_ID,
      parsed.data.nonce,
    );
    const appleId = apple.sub;
    const email = (apple.email || `${appleId}@apple.local`).toLowerCase().trim();
    // 애플이 준 이름도 **외부 입력**이다(구글과 동일 규약 — CLAUDE.md 「입력 규칙은 한 곳에서만」).
    const name = clampDisplayName(parsed.data.full_name ?? '');

    const existing = await db.execute({
      sql: `SELECT id, apple_id, email, name, plan, token_epoch,
                   allow_family_alarms,
                   family_alarm_quiet_windows, dynamic_prompt_settings_json
            FROM users
            WHERE apple_id = ? OR email = ?
            LIMIT 1`,
      args: [appleId, email],
    });

    let userId: string;
    let plan: 'free' | 'plus' | 'family';
    let tokenEpoch = 0;
    let effectiveName = name;

    if (existing.rows.length > 0) {
      const row = typedRow<
        {
          id: string;
          apple_id: string | null;
          email: string;
          name: string | null;
          plan: 'free' | 'plus' | 'family' | null;
          token_epoch: number | string | null;
        } & Record<string, unknown>
      >(existing.rows[0]!);
      userId = row.id;
      plan = row.plan ?? 'free';
      tokenEpoch = Number(row.token_epoch ?? 0);
      // 저장된 이름이 이긴다 — 애플 이름은 빈 칸만 채운다(구글 경로와 동일한 이유:
      // 재로그인이 사용자가 고친 닉네임을 덮어쓰면 안 된다). 옛 스키마로 저장된 값도
      // 규칙을 통과시킨다.
      const storedName = clampDisplayName(row.name ?? '');
      effectiveName = storedName || name;

      await db.execute({
        sql: `UPDATE users
              SET apple_id = ?, name = ?, updated_at = datetime('now')
              WHERE id = ?`,
        // ⚠ 구글 경로와 달리 **email 을 덮어쓰지 않는다.** 애플은 재로그인 때 이메일을
        // 안 주는 경우가 있어, 그때 합성한 `<sub>@apple.local` 로 갱신하면 이미 저장된
        // 진짜 주소가 지워진다.
        args: [appleId, effectiveName || null, userId],
      });
    } else {
      userId = crypto.randomUUID();
      plan = 'free';
      await db.execute({
        sql: `INSERT INTO users (id, apple_id, email, name)
              VALUES (?, ?, ?, ?)`,
        args: [userId, appleId, email, name || null],
      });
    }

    // JWT sub 은 항상 users.id (구글 경로 주석 참고).
    const token = await signAppJwt(
      { sub: userId, email, name: effectiveName || undefined, epoch: tokenEpoch },
      c.env.JWT_SECRET,
    );

    const fresh = await db.execute({
      sql: `SELECT allow_family_alarms,
                   family_alarm_quiet_windows, dynamic_prompt_settings_json
            FROM users WHERE id = ? LIMIT 1`,
      args: [userId],
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
        name: effectiveName,
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
    // 구글 경로와 동일 — 검증 실패 상세는 서버 로그에만, 클라에는 generic.
    logRouteError(c, err);
    const detail = err instanceof Error ? err.message : String(err);
    const status =
      detail.includes('Apple token') ||
      detail.includes('Apple signing key') ||
      detail.includes('Apple identity token') ||
      detail.includes('issuer') ||
      detail.includes('audience') ||
      detail.includes('expired') ||
      detail.includes('nonce') ||
      detail.includes('Token')
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
  // **검증 실패와 그 뒤의 장애를 구조로 가른다.** 하나의 try 로 묶으면 DB 오류까지 401 로
  // 나가고, 클라는 그걸 '세션 만료' 로 읽어 로그아웃시킨다 — /auth/me 는 rolling refresh 때문에
  // 앱을 열 때마다 도는 자리라 피해가 크다. 메시지 문자열로 가르는 것도 틀렸다:
  // `no such column: token_epoch` 같은 스키마 스큐 오류에 token 이 들어간다(Codex #665 P1).
  // authMiddleware 가 이미 같은 구조를 쓴다.
  let payload: Awaited<ReturnType<typeof verifyAppJwt>>;
  try {
    payload = await verifyAppJwt(token, c.env.JWT_SECRET);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return c.json(jsonError('AUTH_INVALID_TOKEN', detail), 401);
  }
  try {
    const db = getDB(c.env);
    const result = await db.execute({
      sql: `SELECT id, email, name, plan, token_epoch, deletion_status,
                   allow_family_alarms,
                   family_alarm_quiet_windows, dynamic_prompt_settings_json
            FROM users WHERE id = ? OR google_id = ? LIMIT 1`,
      args: [payload.sub, payload.sub],
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
        token_epoch: number | string | null;
        deletion_status: string | null;
      } & Record<string, unknown>
    >(result.rows[0]!);
    // 토큰 폐기 검사(authMiddleware 와 동일): JWT epoch 가 users.token_epoch 보다 낮으면
    // 로그아웃(전 기기)/비밀번호 재설정으로 무효화된 구 토큰 → 401. /auth/me 가 세션
    // 검증 역할을 하므로 보호 API 도달 전에 여기서 막아 폐기된 세션 재저장을 방지한다.
    if ((payload.epoch ?? 0) < Number(row.token_epoch ?? 0)) {
      return c.json(jsonError('TOKEN_REVOKED', 'Token has been revoked'), 401);
    }
    const familyAlarmSettings = familyAlarmSettingsFromRow(row);
    const dynamicPromptSettings = dynamicPromptSettingsFromRow(row);
    // 세션을 굴린다(rolling refresh). 여기까지 온 토큰은 서명·만료·폐기 검사를 모두
    // 통과했으므로, 같은 수명의 새 토큰을 발급해 앱이 갈아 끼우게 한다. 앱을 열 때마다
    // 만료가 뒤로 밀려 "업데이트했더니 로그아웃돼 있다"가 사라진다.
    //
    // sub 은 payload.sub 이 아니라 **row.id** 다. sub 이 google_id 인 구 토큰을 들고 온
    // 경우 여기서 users.id 로 갈아 끼워진다 — 발급 경로가 이미 users.id 로 통일돼 있어
    // (b05c6c19) 새 토큰만 그 규약을 따르면 된다.
    //
    // 재발급이 실패해도 200 은 유지한다. /auth/me 는 본래 사용자 정보를 주는 자리라,
    // 토큰을 못 갱신했다고 로그인 자체를 깨뜨릴 이유가 없다 — 클라는 token 이 없으면
    // 쓰던 토큰을 그대로 쓰고 다음 기회에 다시 시도한다.
    const rolledToken = await signAppJwt(
      {
        sub: String(row.id),
        email: row.email,
        name: row.name ?? undefined,
        epoch: Number(row.token_epoch ?? 0),
      },
      c.env.JWT_SECRET,
    ).catch(() => null);
    return c.json({
      ...(rolledToken ? { token: rolledToken } : {}),
      user: {
        id: row.id,
        email: row.email,
        name: row.name ?? '',
        plan: row.plan ?? 'free',
        // 탈퇴 유예 상태 — 클라가 복구 전용 화면 게이팅에 쓴다(누락 시 active 로 오인해 진입).
        deletion_status: (row.deletion_status as string | null) ?? 'active',
        allow_family_alarms: familyAlarmSettings.allowFamilyAlarms,
        family_alarm_quiet_days: familyAlarmSettings.quietDays,
        family_alarm_quiet_start: familyAlarmSettings.quietStart,
        family_alarm_quiet_end: familyAlarmSettings.quietEnd,
        family_alarm_quiet_windows: familyAlarmSettings.quietWindows,
        dynamic_prompt_settings: dynamicPromptSettings,
      },
    });
  } catch (err) {
    // 토큰 검증은 위에서 이미 통과했다 — 여기 오는 건 DB 등 인프라 장애뿐이다. 503 으로 돌려
    // 클라가 세션을 지우지 않고 다음 기회에 다시 시도하게 한다. 내부 예외 메시지는 반사하지
    // 않고 서버 로그에만 남긴다.
    const detail = err instanceof Error ? err.message : String(err);
    const { logStructured } = await import('../lib/logger');
    logStructured('error', { at: 'auth.me', error: detail });
    return c.json(
      jsonError('ACCOUNT_STATUS_UNVERIFIED', 'Unable to verify account status'),
      503,
    );
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
            WHERE id = ? OR google_id = ?`,
      args: [userPk ?? userId, userId],
    });
    return c.json({ success: true });
  } catch (err) {
    logRouteError(c, err);
    return c.json(jsonError('AUTH_LOGOUT_FAILED', 'Logout failed'), 500);
  }
});
auth.route('/logout', logout);

export default auth;
