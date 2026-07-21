import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AppEnv } from './types';
import { authMiddleware } from './middleware/auth';
import { consentMiddleware } from './middleware/consent';
import { loggerMiddleware } from './middleware/logger';
import {
  rateLimitMiddleware,
  ipRateLimitMiddleware,
  ipRateLimitRefundMiddleware,
  authRateLimitMiddleware,
} from './middleware/rateLimit';
import { bodyLimitMiddleware } from './middleware/bodyLimit';
import { privateCache, noStore, publicCache } from './middleware/cache';
import { securityHeadersMiddleware } from './middleware/securityHeaders';
import { sentryMiddleware } from './middleware/sentry';
import { Toucan } from 'toucan-js';
import { getDB, initDB } from './lib/db';
import { timingSafeEqualStr } from './lib/timing-safe-equal';
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
import pushRoutes from './routes/push';
import holidayRoutes from './routes/holiday';
import adminRoutes from './routes/admin';

const app = new Hono<AppEnv>();

// Security response headers (OWASP best practices)
app.use('*', securityHeadersMiddleware);

// Sentry error tracking (no-op if SENTRY_DSN is not set)
app.use('*', sentryMiddleware);

// Structured request logging
app.use('*', loggerMiddleware);

// Rate limiting — 인증 전 전역은 IP 버킷(느슨, NAT 공유 대비), 인증 후 api 는 사용자
// 버킷(아래 api.use). prefix 분리로 같은 요청이 두 버킷에 이중 카운트되지 않는다.
app.use('*', ipRateLimitMiddleware);

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
// 인증 성공한 요청은 전역 IP 버킷 카운트를 환불 — 이후는 사용자 버킷(아래)만 소모한다.
// 비인증/인증실패/공개 라우트는 환불이 없어 IP 버킷에 그대로 누적된다(rateLimit.ts 참고).
api.use('*', ipRateLimitRefundMiddleware);
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
api.route('/push', pushRoutes);

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
async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  const db = getDB(env);
  const now = new Date(event.scheduledTime);

  // cron 은 HTTP 미들웨어(sentryMiddleware)를 타지 않으므로 Sentry 클라이언트를 직접
  // 만든다(DSN 미설정 시 no-op). captureCron 은 구조화 로그 + Sentry 캡처를 함께 해
  // 정상 복구되지 않는 cron 오류를 관리자가 즉시 인지하게 한다.
  const sentry = env.SENTRY_DSN
    ? new Toucan({
        dsn: env.SENTRY_DSN,
        context: ctx,
        environment: env.ENVIRONMENT || 'production',
      })
    : null;
  const captureCron = (at: string, err: unknown): void => {
    logStructured('error', { at, error: String(err) });
    sentry?.captureException(err);
  };

  // 외부 자원(ElevenLabs 클론 / R2 오디오) 지연 삭제 큐 드레인 + TTL 정리.
  try {
    const { drainExternalDeletions, cleanupExpiredAudio, cleanupStaleDraftVoices } =
      await import('./lib/audio-retention');
    await cleanupExpiredAudio(db, now);
    // 앱 강제종료 등으로 클라이언트 정리를 못 거친 고아 draft 보이스 회수
    // (draft 쿼터·ElevenLabs 슬롯 영구 점유 방지).
    await cleanupStaleDraftVoices(db, now);
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
  // env 를 넘겨 만료 처리 전 Play 실상태 재조회(RTDN 유실 대비 reconciliation)를 켠다.
  try {
    const { processSubscriptionExpiry } = await import('./lib/billing-cancel');
    await processSubscriptionExpiry(db, env, now);
  } catch (err) {
    captureCron('scheduled.subscription_expiry', err);
  }

  // 탈퇴 유예(30일) 경과 계정 영구파기 (개인정보보호법 제21조). 파기 전 결제·구독 기록은
  // 전자상거래법(5년) 보존을 위해 가명처리해 분리 테이블로 옮긴다.
  try {
    const { purgeUserAccount, pseudonymizeBillingForRetention } =
      await import('./lib/account-deletion');
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

  // 발사 시각 서버 push 는 보내지 않는다: 알람은 각 기기가 로컬 AlarmManager 로 직접 울리고(수신 가족
  // 알람도 pull→로컬 스케줄), 서버가 발사 때 type=alarm notification 을 또 보내면 로컬 링과 중복 알림이
  // 된다(push_tokens 는 즉시 배달용 토큰이라 이 경로가 소비하면 안 됨). '새 가족 알람 도착' 즉시성은 생성
  // 시점의 sendFamilyAlarmPush(data-only)로 처리하고, 발사 자체는 로컬에 맡긴다.
  // (push 제거 후 남아 있던 '발사 대상 스캔+로그' 블록도 정리 — 소비자 없는 알람 테이블 풀스캔이
  //  틱마다 Turso row-read 만 소모했다. 발사 예정 확인이 필요하면 GET /tick 으로 온디맨드 조회.)

  // 유료 클론 목소리 preset 사전렌더 드레인. 시간민감 알람 푸시 '뒤'에서, 틱당 소량만 생성해
  // Workers 서브리퀘스트 상한·ElevenLabs 비용/rate·푸시 지연을 막는다. 큐가 지목한 클론만
  // 대상이라 전유저 스캔이 없고, 한 건 실패가 나머지를 막지 않도록 격리한다.
  try {
    const {
      claimPendingPrerenderVoices,
      listReadyCloneVoices,
      findMissingStockTargets,
      generateStockClip,
      markPrerenderDone,
      markPrerenderFailed,
      releasePrerenderClaim,
    } = await import('./lib/stock-clips');
    const { missingConsentType, SENSITIVE_REQUIRED_CONSENTS } = await import('./lib/consent');
    // 틱(5분)당 생성 클립 상한. 클립 1개 = Gemini 문구 생성 + ElevenLabs 합성 + R2 업로드라 서브리퀘스트·
    // 비용·rate 를 제한하되, 목소리 1개 풀셋(21클립)이 너무 늦지 않게 6으로 잡는다(≈4틱, keep 후 ~20분).
    // 발사 시각 알람 푸시는 cron 에서 제거돼(중복 알림) 이 드레인이 틱의 시간민감 작업을 막을 일은 없다.
    const MAX_CLIPS_PER_TICK = 6;
    const claimed = await claimPendingPrerenderVoices(db, 5);
    if (claimed.length > 0) {
      const cloneVoices = await listReadyCloneVoices(db, claimed);
      const claimByVoiceId = new Map(claimed.map((request) => [request.voiceProfileId, request]));
      // 큐엔 있으나 ready 클론이 아닌 항목(삭제/실패/draft 등)은 실패 처리해 무한 pending 을 막는다.
      const readyIds = new Set(cloneVoices.map((v) => v.id));
      for (const req of claimed) {
        if (!readyIds.has(req.voiceProfileId)) {
          await markPrerenderFailed(db, req.voiceProfileId, req.claimToken);
        }
      }
      let rendered = 0;
      let subrequestExhausted = false;
      for (const voice of cloneVoices) {
        if (subrequestExhausted) break;
        const claim = claimByVoiceId.get(voice.id);
        if (!claim) continue;
        if (await missingConsentType(db, claim.ownerUserId, SENSITIVE_REQUIRED_CONSENTS)) {
          await markPrerenderFailed(db, voice.id, claim.claimToken);
          continue;
        }
        if (rendered >= MAX_CLIPS_PER_TICK) {
          await releasePrerenderClaim(db, voice.id, claim.claimToken);
          continue;
        }
        const targets = await findMissingStockTargets(db, [voice]);
        if (targets.length === 0) {
          await markPrerenderDone(db, voice.id, claim.claimToken);
          continue;
        }
        let voiceRendered = 0;
        let voiceError = false;
        for (const target of targets) {
          if (rendered >= MAX_CLIPS_PER_TICK) break;
          rendered += 1;
          try {
            await generateStockClip(db, env, target);
            voiceRendered += 1;
          } catch (genErr) {
            // 한 클립 실패가 이 보이스의 나머지 클립(예: love/medication)을 버리지 않도록, 그 클립만
            // 건너뛰고 계속한다. 진전이 있으면 pending 유지(다음 틱 재시도), 진전 0+에러면 실패 처리.
            captureCron('scheduled.stock_clips.generate', genErr);
            voiceError = true;
            // 이 틱의 서브리퀘스트 한도가 소진되면 남은 시도는 전부 같은 오류다 — 즉시 중단해
            // 오류 반복을 줄인다. 뒤따르는 상태 갱신(DB 호출)도 실패할 수 있지만, 그 경우
            // 15분 임대 만료가 회수해 다음 틱에 재시도된다. (7/11~ dev 실사례: 매 틱 실패하던
            // account_purge 가 파기 시퀀스로 예산을 태워 프리렌더가 항상 이 오류로 죽었다.)
            if (String(genErr).includes('Too many subrequests')) {
              subrequestExhausted = true;
              break;
            }
          }
        }
        // 재조회 없이 판정: 이번 틱에 이 보이스의 남은 대상을 전부(에러 없이) 만들었으면 완료.
        if (voiceRendered === targets.length && !voiceError) {
          await markPrerenderDone(db, voice.id, claim.claimToken);
        } else if (voiceError && voiceRendered === 0) {
          // 이 틱에 아무것도 못 만들고 에러만 → attempts 증가(영구 실패 클립의 무한 재시도 방지).
          await markPrerenderFailed(db, voice.id, claim.claimToken);
        } else {
          await releasePrerenderClaim(db, voice.id, claim.claimToken);
        }
      }
      if (rendered > 0) {
        logStructured('info', { at: 'scheduled.stock_clips', rendered, claimed: claimed.length });
      }
    }
  } catch (err) {
    captureCron('scheduled.stock_clips', err);
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
