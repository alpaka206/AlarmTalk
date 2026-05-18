import { Hono } from 'hono';
import type { Client } from '@libsql/client/web';
import type { Env } from '../types';
import { getDB } from '../lib/db';
import { logRouteError } from '../lib/logger';
import { typedRow } from '../lib/db-types';
import { hashPassword, verifyPassword } from '../lib/password';
import { signAppJwt, verifyAppJwt } from '../lib/jwt';
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  GoogleLoginRequestSchema,
  AppleLoginRequestSchema,
  EmailVerificationRequestSchema,
  EmailVerificationConfirmRequestSchema,
} from '@voice-alarm/shared';
import { verifyAppleIdToken, verifyGoogleIdToken } from '../lib/oauth';
import { familyAlarmSettingsFromRow } from '../lib/family-alarm-settings';
import {
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
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

  try {
    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [email],
    });
    if (existing.rows.length > 0) {
      return c.json(jsonError('AUTH_EMAIL_TAKEN', 'Email is already registered'), 409);
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

    return c.json({
      success: true,
      expires_in_seconds: EMAIL_VERIFICATION_TTL_SECONDS,
      ...(shouldExposeDebugEmailCode(c.env) ? { debug_code: code } : {}),
    });
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
    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [normalizedEmail],
    });
    if (existing.rows.length > 0) {
      return c.json(jsonError('AUTH_EMAIL_TAKEN', 'Email is already registered'), 409);
    }

    const verification = await checkEmailVerificationCode(
      db,
      c.env,
      normalizedEmail,
      email_verification_code,
    );
    if (!verification.ok) {
      return c.json(jsonError(verification.code, verification.message), verification.status);
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password, c.env.PASSWORD_PEPPER);
    const today = new Date().toISOString().split('T')[0]!;

    await db.execute({
      sql: `INSERT INTO users (id, email, google_id, password_hash, name, daily_tts_reset_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, normalizedEmail, id, passwordHash, name, today],
    });

    await consumeEmailVerificationCode(db, verification.id);

    const token = await signAppJwt({ sub: id, email: normalizedEmail, name }, c.env.JWT_SECRET);

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
      sql: `SELECT id, google_id, email, password_hash, name, plan,
                   allow_family_alarms, family_alarm_quiet_days,
                   family_alarm_quiet_start, family_alarm_quiet_end,
                   family_alarm_quiet_windows
            FROM users WHERE email = ?`,
      args: [normalizedEmail],
    });

    if (result.rows.length === 0) {
      return c.json(jsonError('AUTH_INVALID_CREDENTIALS', 'Invalid email or password'), 401);
    }

    const row = typedRow<{
      id: string;
      google_id: string | null;
      email: string;
      password_hash: string | null;
      name: string | null;
      plan: 'free' | 'plus' | 'family' | null;
    }>(result.rows[0]!);

    if (!row.password_hash) {
      return c.json(jsonError('AUTH_OAUTH_ONLY', 'This account uses OAuth sign-in'), 401);
    }

    const ok = await verifyPassword(password, row.password_hash, c.env.PASSWORD_PEPPER);
    if (!ok) {
      return c.json(jsonError('AUTH_INVALID_CREDENTIALS', 'Invalid email or password'), 401);
    }

    if (!row.google_id) {
      await db.execute({
        sql: `UPDATE users SET google_id = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [row.id, row.id],
      });
    }

    const token = await signAppJwt(
      { sub: row.id, email: row.email, name: row.name ?? undefined },
      c.env.JWT_SECRET,
    );

    const familyAlarmSettings = familyAlarmSettingsFromRow(
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
      sql: `SELECT id, google_id, email, name, plan,
                   allow_family_alarms, family_alarm_quiet_days,
                   family_alarm_quiet_start, family_alarm_quiet_end,
                   family_alarm_quiet_windows
            FROM users
            WHERE google_id = ? OR email = ?
            LIMIT 1`,
      args: [googleId, email],
    });

    let userId: string;
    let plan: 'free' | 'plus' | 'family';

    if (existing.rows.length > 0) {
      const row = typedRow<
        {
          id: string;
          google_id: string | null;
          email: string;
          name: string | null;
          plan: 'free' | 'plus' | 'family' | null;
        } & Record<string, unknown>
      >(existing.rows[0]!);
      userId = row.id;
      plan = row.plan ?? 'free';

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
      { sub: googleId, email, name: name || undefined },
      c.env.JWT_SECRET,
    );

    const fresh = await db.execute({
      sql: `SELECT allow_family_alarms, family_alarm_quiet_days,
                   family_alarm_quiet_start, family_alarm_quiet_end,
                   family_alarm_quiet_windows
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
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const status =
      detail.includes('Google token') ||
      detail.includes('issuer') ||
      detail.includes('audience') ||
      detail.includes('expired') ||
      detail.includes('Token')
        ? 401
        : 500;
    return c.json(jsonError('AUTH_GOOGLE_FAILED', detail), status);
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
    const apple = await verifyAppleIdToken(parsed.data.id_token, c.env.APPLE_CLIENT_ID);
    const appleId = apple.sub;
    const email = (apple.email || parsed.data.email || `${appleId}@apple.local`)
      .toLowerCase()
      .trim();
    const name = parsed.data.name ?? apple.name ?? '';

    const existing = await db.execute({
      sql: `SELECT id, google_id, apple_id, email, name, plan,
                   allow_family_alarms, family_alarm_quiet_days,
                   family_alarm_quiet_start, family_alarm_quiet_end,
                   family_alarm_quiet_windows
            FROM users
            WHERE apple_id = ? OR google_id = ? OR email = ?
            LIMIT 1`,
      args: [appleId, appleId, email],
    });

    let userId: string;
    let loginSub: string;
    let plan: 'free' | 'plus' | 'family';
    let resolvedName: string;

    if (existing.rows.length > 0) {
      const row = typedRow<
        {
          id: string;
          google_id: string | null;
          apple_id?: string | null;
          email: string;
          name: string | null;
          plan: 'free' | 'plus' | 'family' | null;
        } & Record<string, unknown>
      >(existing.rows[0]!);
      userId = row.id;
      loginSub = row.google_id ?? appleId;
      plan = row.plan ?? 'free';
      resolvedName = name || row.name || '';

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
      { sub: loginSub, email, name: resolvedName || undefined },
      c.env.JWT_SECRET,
    );

    const fresh = await db.execute({
      sql: `SELECT allow_family_alarms, family_alarm_quiet_days,
                   family_alarm_quiet_start, family_alarm_quiet_end,
                   family_alarm_quiet_windows
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

    return c.json({
      token,
      user: {
        id: userId,
        email,
        name: resolvedName,
        plan,
        allow_family_alarms: familyAlarmSettings.allowFamilyAlarms,
        family_alarm_quiet_days: familyAlarmSettings.quietDays,
        family_alarm_quiet_start: familyAlarmSettings.quietStart,
        family_alarm_quiet_end: familyAlarmSettings.quietEnd,
        family_alarm_quiet_windows: familyAlarmSettings.quietWindows,
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
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
    return c.json(jsonError('AUTH_APPLE_FAILED', detail), status);
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
    const result = await db.execute({
      sql: `SELECT id, email, name, plan,
                   allow_family_alarms, family_alarm_quiet_days,
                   family_alarm_quiet_start, family_alarm_quiet_end,
                   family_alarm_quiet_windows
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
      } & Record<string, unknown>
    >(result.rows[0]!);
    const familyAlarmSettings = familyAlarmSettingsFromRow(row);
    return c.json({
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
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return c.json(jsonError('AUTH_INVALID_TOKEN', detail), 401);
  }
});

export default auth;
