import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AppEnv } from './types';
import { authMiddleware } from './middleware/auth';
import { loggerMiddleware } from './middleware/logger';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { bodyLimitMiddleware } from './middleware/bodyLimit';
import { privateCache, noStore } from './middleware/cache';
import { securityHeadersMiddleware } from './middleware/securityHeaders';
import { sentryMiddleware } from './middleware/sentry';
import { getDB, initDB } from './lib/db';
import { selectFiringAlarms, type ScheduledAlarm } from './lib/scheduler';
import { sendAlarmPush } from './lib/fcm';
import { logRouteError, logStructured } from './lib/logger';
import voiceRoutes from './routes/voice';
import ttsRoutes from './routes/tts';
import alarmRoutes from './routes/alarm';
import userRoutes from './routes/user';
import authRoutes from './routes/auth';
import libraryRoutes from './routes/library';
import friendRoutes from './routes/friend';
import giftRoutes from './routes/gift';
import statsRoutes from './routes/stats';
import billingRoutes from './routes/billing';
import familyRoutes from './routes/family';
import characterRoutes from './routes/character';
import codeRoutes from './routes/code';
import notesRoutes from './routes/notes';

const app = new Hono<AppEnv>();

// Security response headers (OWASP best practices)
app.use('*', securityHeadersMiddleware);

// Sentry error tracking (no-op if SENTRY_DSN is not set)
app.use('*', sentryMiddleware);

// Structured request logging
app.use('*', loggerMiddleware);

// Rate limiting (per-isolate sliding window, 60 req/min)
app.use('*', rateLimitMiddleware);

// Body size limit (512 KB)
app.use('*', bodyLimitMiddleware);

// CORS
const ALLOWED_ORIGINS = [
  'http://localhost:8081',
  'exp://localhost:8081',
  'https://alarm-talk.com',
  'https://www.alarm-talk.com',
];

app.use(
  '*',
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

async function healthPayload(env: Env) {
  let dbStatus: 'ok' | 'error' = 'error';
  try {
    const db = getDB(env);
    await db.execute('SELECT 1');
    dbStatus = 'ok';
  } catch {
    // DB unreachable — report but don't fail the health check
  }
  return {
    name: 'VoiceAlarm API',
    version: '1.0.0',
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    db: dbStatus,
  };
}

// Health check with DB connectivity
app.get('/', async (c) => c.json(await healthPayload(c.env)));
app.get('/health', async (c) => c.json(await healthPayload(c.env)));

function canRunInitDb(c: { env: Env; req: { header: (name: string) => string | undefined } }) {
  if (c.env.ENVIRONMENT !== 'production') return true;
  const expected = c.env.INIT_DB_SECRET;
  if (!expected) return false;
  return c.req.header('x-init-db-secret') === expected;
}

// DB 초기화 엔드포인트 — Workers free plan caps subrequests per invocation
// (~50), so we run migrations in small batches selected by query params:
//   POST /api/init-db                    → run all (only safe if not over cap)
//   POST /api/init-db?fromId=1&toId=10   → run migrations 1..10 inclusive
app.post('/api/init-db', async (c) => {
  if (!canRunInitDb(c)) {
    return c.json({ error: 'Not found' }, 404);
  }
  try {
    const fromId = c.req.query('fromId');
    const toId = c.req.query('toId');
    if (fromId && toId) {
      const { runMigrationsRange } = await import('./lib/migrations');
      const ran = await runMigrationsRange(
        (await import('./lib/db')).getDB(c.env),
        Number(fromId),
        Number(toId),
      );
      return c.json({ success: true, ran, range: { fromId, toId } });
    }
    await initDB(c.env);
    return c.json({ success: true, message: 'Database initialized' });
  } catch (err) {
    return c.json(
      {
        error: 'DB init failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
});

// 공개 라우트 (인증 불필요)
app.get('/api/tts/presets', noStore, async (c) => {
  const { loadTtsPresets } = await import('./lib/tts-presets');
  return c.json({ presets: await loadTtsPresets(c.env) });
});

// 앱 버전 정책 (인증 불필요) — 구버전 앱이 로그인 전에도 강제/권장 업데이트를 판단한다.
app.get('/api/app/version', noStore, async (c) => {
  const { appVersionPolicy } = await import('./lib/app-version');
  const platform = c.req.query('platform') || c.req.header('X-App-Platform') || 'android';
  const policy = appVersionPolicy(platform);
  return c.json({
    platform: (platform || 'android').toLowerCase(),
    min_supported_version: policy.minSupported,
    latest_version: policy.latest,
    store_url: policy.storeUrl,
  });
});

// 이메일+비밀번호 가입/로그인 (인증 미들웨어 미적용)
app.route('/api/auth', authRoutes);

// 인증이 필요한 라우트들
const api = new Hono<AppEnv>();
api.use('*', authMiddleware);
api.use('*', rateLimitMiddleware);
api.use('*', async (c, next) => {
  const mw = c.req.method === 'GET' ? privateCache : noStore;
  return mw(c, next);
});
api.route('/voice', voiceRoutes);
api.route('/tts', ttsRoutes);
api.route('/alarm', alarmRoutes);
api.route('/user', userRoutes);
api.route('/library', libraryRoutes);
api.route('/friend', friendRoutes);
api.route('/gift', giftRoutes);
api.route('/stats', statsRoutes);
api.route('/billing', billingRoutes);
api.route('/family', familyRoutes);
api.route('/characters', characterRoutes);
api.route('/code', codeRoutes);
api.route('/notes', notesRoutes);

app.route('/api', api);

app.onError((err, c) => {
  const sentry = c.get('sentry');
  if (sentry) sentry.captureException(err);
  logRouteError(c, err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Cloudflare Workers Cron Trigger 진입점 — wrangler.toml 에 `[triggers] crons = ["* * * * *"]` 등록 시 1분 주기로 호출됨
async function scheduled(event: ScheduledEvent, env: Env): Promise<void> {
  const db = getDB(env);
  const now = new Date(event.scheduledTime);

  // 구독 만료 / 결제일 도달 정리. 알람 푸시보다 먼저 처리해 plan 다운그레이드를 반영.
  try {
    const { processSubscriptionExpiry } = await import('./lib/billing-cancel');
    await processSubscriptionExpiry(db, now);
  } catch (err) {
    logStructured('error', { at: 'scheduled.subscription_expiry', error: String(err) });
  }

  // 탈퇴 유예(30일) 경과 계정 영구파기 (개인정보보호법 제21조). 파기 전 결제·구독 기록은
  // 전자상거래법(5년) 보존을 위해 가명처리해 분리 테이블로 옮긴다.
  try {
    const { purgeUserAccount, pseudonymizeBillingForRetention } = await import(
      './lib/account-deletion'
    );
    const { withWriteTransaction } = await import('./lib/transactions');
    const due = await db.execute({
      sql: `SELECT id, google_id FROM users
            WHERE deletion_status = 'pending_deletion'
              AND deletion_purge_at IS NOT NULL
              AND deletion_purge_at <= ?
            LIMIT 50`,
      args: [now.toISOString()],
    });
    for (const row of due.rows) {
      const userPk = String(row.id);
      const userId = (row.google_id as string | null) ?? userPk;
      await withWriteTransaction(db, async (tx) => {
        await pseudonymizeBillingForRetention(tx, userPk, env.PASSWORD_PEPPER, now);
        await purgeUserAccount(tx, userPk, userId);
      });
    }
    if (due.rows.length > 0) {
      logStructured('info', { at: 'scheduled.account_purge', purged: due.rows.length });
    }
  } catch (err) {
    logStructured('error', { at: 'scheduled.account_purge', error: String(err) });
  }

  const result = await db.execute(
    `SELECT id, user_id, target_user_id, time, repeat_days, is_active,
            mode, voice_profile_id, speaker_id
     FROM alarms WHERE is_active = 1`,
  );

  const alarms: ScheduledAlarm[] = result.rows.map((r) => ({
    id: String(r.id),
    user_id: String(r.user_id),
    target_user_id: (r.target_user_id as string | null) ?? null,
    time: String(r.time),
    repeat_days: (() => {
      try {
        const parsed: unknown = JSON.parse(String(r.repeat_days ?? '[]'));
        return Array.isArray(parsed) ? parsed.filter((n): n is number => Number.isInteger(n)) : [];
      } catch {
        return [];
      }
    })(),
    is_active: r.is_active === 1,
    mode: r.mode === 'sound-only' ? 'sound-only' : 'tts',
    voice_profile_id: (r.voice_profile_id as string | null) ?? null,
    speaker_id: (r.speaker_id as string | null) ?? null,
  }));

  const firing = selectFiringAlarms(alarms, now);

  logStructured('info', {
    at: 'scheduled',
    now: now.toISOString(),
    checked: alarms.length,
    firing_count: firing.length,
    firing_ids: firing.map((a) => a.id),
  });

  for (const alarm of firing) {
    const targetUserId = alarm.target_user_id ?? alarm.user_id;
    await sendAlarmPush(db, targetUserId, alarm.id, alarm.time);
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
