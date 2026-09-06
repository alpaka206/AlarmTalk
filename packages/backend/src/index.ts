import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AppEnv } from './types';
// 타입만 정적으로 가져온다(런타임에는 지워짐) — 구현은 cron 안에서 동적 import 한다.
import type { RevokedRecipientTarget } from './lib/account-deletion';
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
import { retryTransientTurso } from './lib/turso-retry';
import { timingSafeEqualStr } from './lib/timing-safe-equal';
import { logRouteError, logStructured } from './lib/logger';
import voiceRoutes from './routes/voice';
import ttsRoutes from './routes/tts';
import alarmRoutes from './routes/alarm';
import userRoutes from './routes/user';
import authRoutes from './routes/auth';
import billingRoutes from './routes/billing';
import billingGoogleRtdn from './routes/billing-google-rtdn';
import billingApple from './routes/billing-apple';
import familyRoutes from './routes/family';
import codeRoutes from './routes/code';
import pushRoutes from './routes/push';
import eventsRoutes from './routes/events';
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
      const { runMigrationsRange, migrationMaxId } = await import('./lib/migrations');
      const ran = await runMigrationsRange(
        (await import('./lib/db')).getDB(c.env),
        Number(fromId),
        Number(toId),
      );
      // **이 워커가 아는 마이그레이션 최대 id.** 호출자는 이 값으로 배포 전파를 확인한다 —
      // 배포 직후 옛 번들이 응답하면 새 마이그레이션 id 를 '모르는 id' 로 조용히 건너뛰고
      // 빈 ran 을 돌려주는데, 그게 '이미 적용됨' 과 구분되지 않는다(#660 이후 dev 실사고).
      return c.json({ success: true, ran, range: { fromId, toId }, maxId: migrationMaxId() });
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
api.route('/billing', billingApple);
api.route('/billing', billingRoutes);
api.route('/family', familyRoutes);
api.route('/code', codeRoutes);
api.route('/push', pushRoutes);
// 사용 기록 — 앱이 오프라인에 쌓아 둔 이벤트를 모아 보낸다(routes/events.ts).
api.route('/events', eventsRoutes);

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
async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  const rawDb = getDB(env);
  // 520 is a transient failure of Turso's HTTP gateway. Retry only read
  // queries: retrying a write after an ambiguous HTTP failure can duplicate a
  // side effect. Failed maintenance writes remain safe to resume next tick.
  const db = new Proxy(rawDb, {
    get(target, property) {
      if (property === 'execute') {
        return (...args: unknown[]) => {
          const statement = args[0];
          const sql =
            typeof statement === 'string'
              ? statement
              : typeof statement === 'object' && statement !== null && 'sql' in statement
                ? String(statement.sql)
                : '';
          const execute = () => Reflect.apply(target.execute, target, args);
          return /^\s*(?:SELECT|EXPLAIN)\b/i.test(sql) ? retryTransientTurso(execute) : execute();
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
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
    await drainExternalDeletions(db, env, now);
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

  // 전자상거래법 보존기간이 끝난 가명 결제 기록 파기. retain_until 을 저장만 하고
  // 지우지 않으면 '5년 보존'이 사실상 무기한 보존이 된다.
  try {
    await db.execute({
      sql: 'DELETE FROM retained_billing_records WHERE retain_until <= ?',
      args: [now.toISOString()],
    });
  } catch (err) {
    captureCron('scheduled.billing_retention_prune', err);
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
    // ⚠ **`apple_refresh_token` 을 함께 읽는다.** 파기하면 읽을 곳이 없어져 영영 폐기하지
    // 못하고, 사용자의 '설정 → Apple로 로그인' 목록에 우리 앱이 남는다(애플 심사 5.1.1(v)).
    // 즉시 삭제(`DELETE /user/me`)에는 이 처리가 있었는데 **앱이 실제로 쓰는 경로**는
    // 유예 삭제(`POST /user/me/deletion`)라, 정작 대부분의 탈퇴에서 빠져 있었다
    // (2026-08-18 Codex #697 P1).
    const due = await db.execute({
      sql: `SELECT id, google_id, apple_refresh_token FROM users
            WHERE deletion_status = 'pending_deletion'
              AND deletion_purge_at IS NOT NULL
              AND deletion_purge_at <= ?
            LIMIT 50`,
      args: [now.toISOString()],
    });
    const revokedTargets: RevokedRecipientTarget[] = [];
    const voiceAccessRevokedUserIds: string[] = [];
    // **이미 커밋된 파기는 반드시 알린다.** 배치 뒤쪽 계정에서 던져도 앞 계정의 파기는
    // 이미 커밋돼 되돌아가지 않는다 — 그 수신자들에게 안 알리면 탈퇴자의 목소리를 폴백
    // 주기만큼 더 들고 있게 된다. 그래서 발송은 finally 에 둔다(모아 보내는 건 유지 —
    // sendPushNotifications 는 호출마다 OAuth 를 새로 받아, 계정마다 나눠 부르면 틱당
    // 최대 50 왕복이 된다).
    try {
      const { appleSignInConfig, revokeAppleToken } = await import('./lib/apple-revoke');
      for (const row of due.rows) {
        const userPk = String(row.id);
        const userId = (row.google_id as string | null) ?? userPk;
        // 애플 연결을 끊는다 — **행을 지우기 전에.**
        // ⚠ 실패해도 파기는 진행한다(즉시 삭제 경로와 같은 판단). 애플이 잠깐 죽었다고
        // 파기를 막으면 사용자의 데이터가 유예 기간을 넘겨 남는다.
        const appleRefreshToken = row.apple_refresh_token as string | null;
        if (appleRefreshToken) {
          const signInConfig = appleSignInConfig(env, env.APPLE_BUNDLE_ID);
          if (signInConfig) {
            try {
              await revokeAppleToken(signInConfig, appleRefreshToken);
            } catch (err) {
              captureCron('scheduled.account_purge.apple_revoke', err);
            }
          }
        }
        const purged = await withWriteTransaction(db, async (tx) => {
          await pseudonymizeBillingForRetention(tx, userPk, env.PASSWORD_PEPPER, now);
          return purgeUserAccount(tx, userPk, userId);
        });
        revokedTargets.push(...purged.downgradedAlarms);
        voiceAccessRevokedUserIds.push(...purged.voiceAccessRevokedUserIds);
      }
      if (due.rows.length > 0) {
        logStructured('info', { at: 'scheduled.account_purge', purged: due.rows.length });
      }
    } finally {
      // 파기된 계정의 목소리를 들고 있는 기기들에 알린다 — 받은 알람은 pull 신호로,
      // 본인 알람·미동기화 알람은 접근권 재확인으로. **여기서 던지면 안 된다** —
      // 원래 파기 실패를 이 실패가 덮어써 바깥 catch 가 엉뚱한 걸 기록한다.
      try {
        const { notifyDowngradedAlarms } = await import('./lib/fcm');
        await notifyDowngradedAlarms(db, env, revokedTargets, voiceAccessRevokedUserIds);
      } catch (notifyErr) {
        captureCron('scheduled.account_purge_notify', notifyErr);
      }
    }
  } catch (err) {
    captureCron('scheduled.account_purge', err);
  }

  // 발사 시각 서버 push 는 보내지 않는다: 알람은 각 기기가 로컬 AlarmManager 로 직접 울리고(수신 가족
  // 알람도 pull→로컬 스케줄), 서버가 발사 때 type=alarm notification 을 또 보내면 로컬 링과 중복 알림이
  // 된다(push_tokens 는 즉시 배달용 토큰이라 이 경로가 소비하면 안 됨). '새 가족 알람 도착' 즉시성은 생성
  // 시점의 sendFamilyAlarmPush(data-only)로 처리하고, 발사 자체는 로컬에 맡긴다.
  // (push 제거 후 남아 있던 '발사 대상 스캔+로그' 블록도 정리 — 소비자 없는 알람 테이블 풀스캔이
  //  틱마다 Turso row-read 만 소모했다.)

  // ⚠⚠ **기본(시스템) 목소리 스톡 클립 드레인은 껐다**(2026-09-03 리뷰 15차).
  //
  // 7차에 이걸 붙인 이유는 "교체가 배포되는 순간 기본 목소리에 클립이 0개가 된다" 였다.
  // 그 문제는 이제 **미리 구워 올리는 것**으로 푼다(`scripts/publish-stock-clips.ts`) —
  // 배포 전에 R2 에 바이트를 올려 두고, 마이그레이션 직후 행만 넣으면 공백이 거의 없다.
  //
  // 그런데 **둘을 같이 두면 서로 싸운다.** 롤아웃은 `#110` 이 전부 은퇴시킨 뒤 사람이
  // `publish:stock` 을 돌리는 순서인데, 그 사이의 5분 틱이 **같은 타깃을 합성하기
  // 시작한다.** cron 이 한 자리를 먼저 커밋하면 `publish:stock` 은 그 자리를
  // '이미 있음' 으로 보고 건너뛰어, **사람이 들어 보고 확정한 바이트가 영영 안 올라간다.**
  // 그리고 그때부터 결정론적 키를 놓고 두 렌더가 겹치는 옛 경합이 되살아난다.
  //
  // 되살릴 거라면 **게시가 렌더 산출물을 덮어쓰도록** 먼저 고쳐야 한다(지금은 건너뛴다).
  // 클론 드레인(아래)은 그대로다 — 그건 큐가 지목한 목소리만 굽고, 미리 구울 수 없다
  // (등록한 사람의 목소리라서 우리가 미리 갖고 있지 않다).
  //
  // 특정 목소리만 다시 굽는 수동 도구는 남아 있다: `POST /api/admin/seed-stock-clips`
  // (`?voice=`·`?reset=`). 새 프리셋을 추가했는데 미리 굽지 않았다면 그걸로 채운다.

  // 유료 클론 목소리 preset 사전렌더 드레인. 시간민감 알람 푸시 '뒤'에서, 틱당 소량만 생성해
  // Workers 서브리퀘스트 상한·ElevenLabs 비용/rate·푸시 지연을 막는다. 큐가 지목한 클론만
  // 대상이라 전유저 스캔이 없고, 한 건 실패가 나머지를 막지 않도록 격리한다.
  try {
    const { runPrerenderBatch } = await import('./lib/stock-clips');
    // 틱(5분)당 생성 클립 상한. 클립 1개 = Gemini 문구 생성 + ElevenLabs 합성 + R2 업로드다.
    //
    // ⚠ **6 → 10 으로 올렸다**(2026-08-20). 6은 목소리 1개 풀셋(21클립)에 4틱 = 20분이
    // 걸린다는 뜻이었고, 실기기 QA 에서 그 대기가 문제로 지적됐다. 상한을 넘겨 서브리퀘스트가
    // 소진되면 `runPrerenderBatch` 가 즉시 멈추고 pending 을 유지해 다음 틱이 이어받으므로,
    // 올려서 손해 보는 경우가 "그 틱이 조금 일찍 끝난다" 뿐이다 — 그 안전장치가 이미
    // 검증돼 있어서 올릴 수 있다. 등록 직후 첫 배치는 요청 쪽에서 따로 돈다(promote).
    const result = await runPrerenderBatch(db, env, {
      maxClips: 10,
      maxVoices: 5,
      onClipError: (genErr) => captureCron('scheduled.stock_clips.generate', genErr),
    });
    if (result.rendered > 0) {
      logStructured('info', {
        at: 'scheduled.stock_clips',
        rendered: result.rendered,
        claimed: result.claimed,
      });
    }
  } catch (err) {
    captureCron('scheduled.stock_clips', err);
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
