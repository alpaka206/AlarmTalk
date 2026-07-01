import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AppEnv } from './types';
import { authMiddleware } from './middleware/auth';
import { consentMiddleware } from './middleware/consent';
import { loggerMiddleware } from './middleware/logger';
import { rateLimitMiddleware, authRateLimitMiddleware } from './middleware/rateLimit';
import { bodyLimitMiddleware } from './middleware/bodyLimit';
import { privateCache, noStore, publicCache } from './middleware/cache';
import { securityHeadersMiddleware } from './middleware/securityHeaders';
import { sentryMiddleware } from './middleware/sentry';
import { Toucan } from 'toucan-js';
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
import billingGoogleRtdn from './routes/billing-google-rtdn';
import familyRoutes from './routes/family';
import codeRoutes from './routes/code';
import notesRoutes from './routes/notes';
import holidayRoutes from './routes/holiday';
import adminRoutes from './routes/admin';

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
    // 허용 목록에 없는 Origin 에는 ACAO 헤더를 설정하지 않아 브라우저가 차단하게 한다.
    // (기본 origin 반사는 정책을 모호하게 만들고 localhost 출처를 프로덕션에 노출한다.
    //  토큰 인증은 Authorization 헤더 기반이라 네이티브 앱 요청에는 CORS 영향 없음.)
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : undefined),
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
    name: 'AlarmTalk API',
    version: '1.0.0',
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    db: dbStatus,
  };
}

// Health check with DB connectivity
app.get('/', async (c) => c.json(await healthPayload(c.env)));
app.get('/health', async (c) => c.json(await healthPayload(c.env)));

// init-db / seed 는 파괴적 DDL + 유료 합성을 수행하므로 모든 환경에서 INIT_DB_SECRET 헤더를
// 요구한다. 시크릿이 설정돼 있지 않으면(=의도적으로 비활성) 무조건 거부한다(404).
// 헤더 비교는 상수시간(timingSafeEqualStr)으로 수행해 타이밍 오라클을 차단한다.
function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}

function canRunInitDb(c: { env: Env; req: { header: (name: string) => string | undefined } }) {
  const expected = c.env.INIT_DB_SECRET;
  if (!expected) return false;
  const provided = c.req.header('x-init-db-secret');
  if (!provided) return false;
  return timingSafeEqualStr(provided, expected);
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
    // SQL/Turso 내부 메시지를 클라이언트로 반사하지 않는다 — 서버 로그로만 남긴다.
    logRouteError(c, err);
    return c.json({ error: 'DB init failed' }, 500);
  }
});

// 무료 플랜용 스톡 알람 클립 생성 (dev 전용 / prod 는 x-init-db-secret 필요).
// Workers 서브리퀘스트 캡을 피하려고 한 번에 max 개(기본 2)만 생성하고 remaining 을
// 돌려준다. 호출자가 remaining 이 0 이 될 때까지 반복 호출한다 (멱등).
app.post('/api/admin/seed-stock-clips', async (c) => {
  if (!canRunInitDb(c)) {
    return c.json({ error: 'Not found' }, 404);
  }
  try {
    const max = Math.min(Math.max(parseInt(c.req.query('max') || '2', 10) || 2, 1), 12);
    const reset = ['1', 'true', 'yes'].includes((c.req.query('reset') || '').toLowerCase());
    // 특정 보이스(+카테고리)만 재생성하고 싶을 때: ?voice=<elevenlabs_voice_id>&category=greeting
    // 해당 클립만 지우면 findMissingStockTargets 가 그것만 다시 채운다 (다른 클립·알람 영향 없음).
    const voice = (c.req.query('voice') || '').trim();
    const category = (c.req.query('category') || '').trim();
    const { findMissingStockTargets, generateStockClip, deleteAllStockClips, deleteStockClips } =
      await import('./lib/stock-clips');
    const db = getDB(c.env);
    let deleted = 0;
    if (voice) {
      deleted = await deleteStockClips(db, c.env, {
        elevenlabsVoiceId: voice,
        category: category || undefined,
      });
    } else if (reset) {
      deleted = await deleteAllStockClips(db, c.env);
    }
    const missing = await findMissingStockTargets(db);
    const batch = missing.slice(0, max);
    const generated = [];
    for (const target of batch) {
      generated.push(await generateStockClip(db, c.env, target));
    }
    return c.json({
      success: true,
      deleted,
      generated,
      generated_count: generated.length,
      remaining: missing.length - generated.length,
    });
  } catch (err) {
    // 합성/스토리지 내부 오류 메시지를 클라이언트로 반사하지 않는다 — 서버 로그로만 남긴다.
    logRouteError(c, err);
    return c.json({ error: 'Stock clip seed failed' }, 500);
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

// 공휴일 조회 (인증 불필요, 다국가). 결과가 (country,region,from,to,lang) 에 결정적이라 publicCache.
// KR 은 KASI_SERVICE_KEY 설정 시 대체/임시공휴일을 보정한다 (미설정 시 date-holidays 결과만).
app.use('/api/holiday', publicCache);
app.route('/api/holiday', holidayRoutes);

// 이메일+비밀번호 가입/로그인 (인증 미들웨어 미적용)
// 무차별 대입 방어용 엄격 한도를 일반 한도와 별개 버킷으로 추가 적용한다.
app.use('/api/auth/*', authRateLimitMiddleware);
app.route('/api/auth', authRoutes);

// Google Play RTDN 웹훅 (인증 미들웨어 미적용 — Pub/Sub push 가 사용자 인증 없이 호출하므로
// ?token=GOOGLE_RTDN_VERIFICATION_TOKEN 쿼리로만 보호한다).
app.route('/api/billing/google', billingGoogleRtdn);

// 인증이 필요한 라우트들
const api = new Hono<AppEnv>();
api.use('*', authMiddleware);
// 서버측 동의 강제(B4) — authMiddleware 직후에 둬 userIdPK 를 사용한다. 데이터 수집
// 라우트는 일반 필수 동의가 없으면 403. 면제 경로는 consentMiddleware 내부에서 통과.
api.use('*', consentMiddleware);
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
api.route('/code', codeRoutes);
api.route('/notes', notesRoutes);

// 관리자 콘솔(/admin) — 사용자 JWT 가 아니라 ADMIN_SECRET(HTTP Basic)로 보호한다
// (admin.ts 내부 미들웨어). 프로모 쿠폰 발급/관리 등 SQL 수기 없이 웹 폼에서.
app.route('/admin', adminRoutes);

app.route('/api', api);

app.onError((err, c) => {
  const sentry = c.get('sentry');
  if (sentry) sentry.captureException(err);
  logRouteError(c, err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Cloudflare Workers Cron Trigger 진입점 — wrangler.toml [triggers] crons = ["*/5 * * * *"] (5분 주기).
// 주기를 바꾸면 lib/scheduler.ts 의 CRON_WINDOW_MINUTES 도 함께 바꿔야 한다.
async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const db = getDB(env);
  const now = new Date(event.scheduledTime);

  // cron 은 HTTP 미들웨어(sentryMiddleware)를 타지 않으므로 Sentry 클라이언트를 직접
  // 만든다(DSN 미설정 시 no-op). captureCron 은 구조화 로그 + Sentry 캡처를 함께 해
  // 정상 복구되지 않는 cron 오류를 관리자가 즉시 인지하게 한다.
  const sentry = env.SENTRY_DSN
    ? new Toucan({ dsn: env.SENTRY_DSN, context: ctx, environment: env.ENVIRONMENT || 'production' })
    : null;
  const captureCron = (at: string, err: unknown): void => {
    logStructured('error', { at, error: String(err) });
    sentry?.captureException(err);
  };

  // 외부 자원(ElevenLabs 클론 / R2 오디오) 지연 삭제 큐 드레인 + TTL 정리.
  try {
    const { drainExternalDeletions, cleanupExpiredAudio } = await import('./lib/audio-retention');
    await cleanupExpiredAudio(db, now);
    await drainExternalDeletions(db, env);
  } catch (err) {
    captureCron('scheduled.audio_retention', err);
  }

  // 만료된 이메일 인증코드(PII) 정리 — 무한 보존 방지. expires_at 은 ISO 문자열로 기록되므로
  // 동일 포맷으로 비교한다. 만료 후 72h 유예를 두고 일괄 삭제(저렴·멱등).
  try {
    const pruneBefore = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();
    await db.execute({
      sql: 'DELETE FROM email_verification_codes WHERE expires_at < ?',
      args: [pruneBefore],
    });
  } catch (err) {
    captureCron('scheduled.email_code_prune', err);
  }

  // 구독 만료 / 결제일 도달 정리. 알람 푸시보다 먼저 처리해 plan 다운그레이드를 반영.
  try {
    const { processSubscriptionExpiry } = await import('./lib/billing-cancel');
    await processSubscriptionExpiry(db, now);
  } catch (err) {
    captureCron('scheduled.subscription_expiry', err);
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
    captureCron('scheduled.account_purge', err);
  }

  const result = await db.execute(
    `SELECT id, user_id, target_user_id, time, repeat_days, is_active,
            mode, voice_profile_id, speaker_id, timezone
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
    timezone: (r.timezone as string | null) ?? null,
  }));

  const firing = selectFiringAlarms(alarms, now);

  logStructured('info', {
    at: 'scheduled',
    now: now.toISOString(),
    checked: alarms.length,
    firing_count: firing.length,
    firing_ids: firing.map((a) => a.id),
  });

  // 알람 푸시를 순차(await in loop)로 보내면 동시에 울릴 알람이 많을 때 지연이
  // 선형으로 쌓인다(마지막 사용자는 늦게 울림). Workers 의 subrequest 상한을
  // 고려해 청크 단위로 병렬 전송하고, 한 건 실패가 나머지를 막지 않도록 allSettled.
  const PUSH_CONCURRENCY = 10;
  for (let i = 0; i < firing.length; i += PUSH_CONCURRENCY) {
    const chunk = firing.slice(i, i + PUSH_CONCURRENCY);
    await Promise.allSettled(
      chunk.map((alarm) =>
        sendAlarmPush(db, env, alarm.target_user_id ?? alarm.user_id, alarm.id, alarm.time),
      ),
    );
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
