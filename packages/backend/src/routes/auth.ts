import { Hono } from 'hono';
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
} from '@voice-alarm/shared';
import { verifyGoogleIdToken } from '../lib/oauth';
import { familyAlarmSettingsFromRow } from '../lib/family-alarm-settings';

const auth = new Hono<{ Bindings: Env }>();

function jsonError(code: string, message: string) {
  return { error: message, error_code: code };
}

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

  const { email, password, name } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();
  const db = getDB(c.env);

  try {
    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [normalizedEmail],
    });
    if (existing.rows.length > 0) {
      return c.json(jsonError('AUTH_EMAIL_TAKEN', 'Email is already registered'), 409);
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password, c.env.PASSWORD_PEPPER);
    const today = new Date().toISOString().split('T')[0]!;

    await db.execute({
      sql: `INSERT INTO users (id, email, google_id, password_hash, name, daily_tts_reset_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, normalizedEmail, id, passwordHash, name, today],
    });

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
