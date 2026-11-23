import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import {
  ADMIN_PASSWORD_RETRY_AFTER_SECONDS,
  chargeAdminPasswordAttempt,
  clearAdminPasswordAttempts,
} from '../lib/admin/password-attempts';
import { jsonError } from '../lib/api-error';
import { countAudience, parseAudience } from '../lib/admin/audience';
import { listPushJobs, loadOverview, parseRange, searchUsers } from '../lib/admin/metrics';
import { loadStoreDownloads } from '../lib/admin/store-downloads';
import { renderLogin, renderOverview, renderPush, renderUserDetail, renderUsers } from '../lib/admin/pages';
import {
  AdminPushError,
  adPushEnabled,
  cancelPushJob,
  createPushJob,
  effectiveAudience,
  parseCopy,
  runJobStep,
  sendTestPush,
} from '../lib/admin/push-jobs';
import { emptyState, newNonce, page, securityHeaders } from '../lib/admin/ui';
import { loadUserDetail } from '../lib/admin/user-detail';
import { loadRenderBacklog, loadTtsUsage } from '../lib/admin/tts-ops';
import { isRerenderKind } from '../lib/render-backlog';
import { loadAdRewardReconciliation, loadUserAdRewards } from '../lib/admin/ad-rewards';
import { loadUsageMetrics, parseUsageFilter } from '../lib/admin/usage-metrics';
import { renderUsage } from '../lib/admin/usage-pages';

// MARK: - 관리자 전용 페이지 (/admin/*)
//
// 사용자 JWT 가 아니라 ADMIN_SECRET(관리자 비밀번호)로 보호한다. 로그인은 비밀번호만
// 입력하는 폼(/admin/login) — 이메일/아이디는 받지 않는다. 성공 시 ADMIN_SECRET 로 서명한
// 세션 쿠키(HttpOnly·Secure·SameSite=Strict)를 발급하고 이후 요청은 그 쿠키로 인증한다.
// curl/스크립트용으로 HTTP Basic(비밀번호=ADMIN_SECRET, 아이디 무시)도 그대로 허용한다.
// ADMIN_SECRET 미설정 시 503. 접속: https://<host>/admin/login
//
// 화면은 개요 · 사용 지표 · 사용자 · 알림 보내기다(`docs/spec/admin-console.md`). 사용자 상세는 읽기 전용이다 — 플러스 기간
// 지급·회수와 추가 음성팩 검수·게시는 2026-11-23 에 없앴다(유료는 스토어 결제뿐, 무료 이용은 스토어 무료 체험). 2026-10-23 에
// 다시 만들면서 프로모 코드 이력 화면은 지웠다 — 프로모 코드는 2026-10-12 에 없앴고(App Store 3.1.1), 코드를 쳐서 유료 기능을 여는 길을
// 되살리지 않는다(CLAUDE.md 「유료 기능은 스토어 결제로만 연다」). 발급 화면을 다시 만들지 말 것.

const admin = new Hono<AppEnv>();

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 로그인 세션 12시간

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function refererOrigin(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ADMIN_SECRET 를 키로 한 HMAC-SHA256 서명 — 세션 쿠키 위조를 막는다(키 없이는 서명 불가).
async function hmacSign(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toBase64Url(new Uint8Array(sig));
}

// 세션 토큰 = `v1.<만료epoch>.<HMAC(v1.만료epoch)>`. 만료시각을 서명에 포함해 위·변조와
// 무한수명을 동시에 막는다. ADMIN_SECRET 이 바뀌면 기존 토큰은 자동 무효(서명 불일치).
async function makeSessionToken(secret: string, nowMs: number): Promise<string> {
  const payload = `v1.${nowMs + SESSION_TTL_MS}`;
  return `${payload}.${await hmacSign(payload, secret)}`;
}

async function isValidSessionToken(token: string, secret: string, nowMs: number): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [ver, expStr, sig] = parts;
  if (ver !== 'v1' || !expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < nowMs) return false;
  return safeEqual(sig, await hmacSign(`${ver}.${expStr}`, secret));
}

// 비밀번호를 맞춰 보는 IP 의 통 — IP 를 그대로 적지 않는다. 위조할 수 없는 `cf-connecting-ip` 만 믿는다(`middleware/rateLimit.ts`).
function adminPasswordKey(c: Context<AppEnv>, secret: string): Promise<string> {
  return hmacSign(`admin-password:${c.req.header('cf-connecting-ip') || 'unknown'}`, secret);
}

function sessionCookieHeader(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/admin; HttpOnly; Secure; SameSite=Strict`;
}

function clearedCookieHeader(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/admin; HttpOnly; Secure; SameSite=Strict`;
}

// 1) 설정 게이트 — ADMIN_SECRET 미설정이면 로그인 포함 모든 /admin/* 이 503.
admin.use('*', async (c, next) => {
  if (!c.env.ADMIN_SECRET) {
    return c.json({ error: 'Admin console is not configured', error_code: 'ADMIN_UNCONFIGURED' }, 503);
  }
  return next();
});

// 2) CSRF 방어 — 상태 변경(POST: 로그인/로그아웃/발급/토글)은 Origin(없으면 Referer)이
//    콘솔 호스트와 정확히 일치할 때만 허용한다. 세션 쿠키가 SameSite=Strict 라 이중 방어.
admin.use('*', async (c, next) => {
  if (c.req.method === 'POST') {
    const expected = new URL(c.req.url).origin;
    const source = c.req.header('Origin') ?? refererOrigin(c.req.header('Referer'));
    if (source !== expected) {
      return c.text('CSRF check failed', 403);
    }
  }
  return next();
});

// --- 로그인/로그아웃 (인증 게이트 앞: 로그인 없이 접근 가능) ---

admin.get('/login', async (c) => {
  const secret = c.env.ADMIN_SECRET!;
  const cookie = readCookie(c.req.header('Cookie'), SESSION_COOKIE);
  if (cookie && (await isValidSessionToken(cookie, secret, Date.now()))) {
    return c.redirect('/admin', 302);
  }
  // 오류 문구는 쿼리 값을 그대로 비추지 않는다 — 고정 문구 하나만(남의 링크로 엉뚱한 글을 띄우지 못하게).
  const nonce = newNonce();
  const html = renderLogin(nonce, c.req.query('err') ? '비밀번호가 맞지 않아요. 다시 입력해 주세요.' : null);
  return c.html(html, 200, securityHeaders(nonce));
});

// 비밀번호만 검증(아이디/이메일 없음). 시도 횟수는 Basic 과 한 통으로 센다(`lib/admin/password-attempts.ts`).
admin.post('/login', async (c) => {
  const secret = c.env.ADMIN_SECRET!;
  const db = getDB(c.env);
  const attemptKey = await adminPasswordKey(c, secret);
  if (!(await chargeAdminPasswordAttempt(db, attemptKey))) {
    const nonce = newNonce();
    return c.html(renderLogin(nonce, '비밀번호를 너무 많이 틀렸어요. 잠시 뒤에 다시 해 주세요.'), 429, {
      ...securityHeaders(nonce),
      'Retry-After': String(ADMIN_PASSWORD_RETRY_AFTER_SECONDS),
    });
  }
  const form = await c.req.parseBody();
  const password = String(form.password ?? '');
  if (!safeEqual(password, secret)) {
    return c.redirect('/admin/login?err=1', 303);
  }
  await clearAdminPasswordAttempts(db, attemptKey);
  const token = await makeSessionToken(secret, Date.now());
  return new Response(null, {
    status: 303,
    headers: { Location: '/admin', 'Set-Cookie': sessionCookieHeader(token) },
  });
});

admin.post('/logout', async () => {
  return new Response(null, {
    status: 303,
    headers: { Location: '/admin/login', 'Set-Cookie': clearedCookieHeader() },
  });
});

// 3) 인증 게이트 — 세션 쿠키 또는 Basic(스크립트용) 중 하나면 통과. 둘 다 아니면 로그인
//    폼으로 리다이렉트한다. WWW-Authenticate 를 보내지 않으므로 브라우저 기본 아이디/비번
//    창(=이메일 입력칸)이 뜨지 않는다.
admin.use('*', async (c, next) => {
  const secret = c.env.ADMIN_SECRET!;
  const cookie = readCookie(c.req.header('Cookie'), SESSION_COOKIE);
  if (cookie && (await isValidSessionToken(cookie, secret, Date.now()))) {
    return next();
  }
  const header = c.req.header('Authorization') || '';
  if (header.startsWith('Basic ')) {
    const db = getDB(c.env);
    const attemptKey = await adminPasswordKey(c, secret);
    if (!(await chargeAdminPasswordAttempt(db, attemptKey))) {
      c.header('Retry-After', String(ADMIN_PASSWORD_RETRY_AFTER_SECONDS));
      return jsonError(c, 429, 'RATE_LIMITED', '비밀번호를 너무 많이 틀렸어요. 잠시 뒤에 다시 해 주세요.', {
        retryAfter: ADMIN_PASSWORD_RETRY_AFTER_SECONDS,
      });
    }
    let passwordMatches = false;
    try {
      const decoded = atob(header.slice(6));
      passwordMatches = safeEqual(decoded.slice(decoded.indexOf(':') + 1), secret);
    } catch {
      /* 잘못된 Basic 헤더 → 아래 로그인 리다이렉트로 폴백 */
    }
    if (passwordMatches) {
      await clearAdminPasswordAttempts(db, attemptKey);
      return next();
    }
  }
  // 화면 안에서 부르는 JSON 요청(세션이 만료된 뒤)은 리다이렉트 대신 401 로 — 스크립트가 문구를 띄운다.
  if (c.req.method === 'POST') {
    return jsonError(c, 401, 'ADMIN_UNAUTHORIZED', '로그인이 끝났어요. 새로고침해 다시 로그인해 주세요.');
  }
  return c.redirect('/admin/login', 302);
});

// --- 화면 ---

/** 콘솔 화면 응답 — 매번 새 nonce·보안 헤더. */
function html(c: Context<AppEnv>, render: (nonce: string) => string, status: 200 | 500 = 200) {
  const nonce = newNonce();
  return c.html(render(nonce), status, securityHeaders(nonce));
}

/** 표가 아직 없는 창(배포 → 마이그레이션, 1분 남짓)과 DB 오류를 같은 화면으로 말한다. */
function unavailable(nonce: string, err: unknown, active: 'overview' | 'usage' | 'users' | 'push'): string {
  const missing = /no such table|no such column/i.test(String(err));
  return page({
    title: '잠시 뒤 다시',
    active,
    nonce,
    body: `<section class="panel">${emptyState(
      missing ? '데이터베이스를 갱신하는 중이에요' : '숫자를 불러오지 못했어요',
      missing ? '배포 직후에는 1분쯤 걸려요. 잠시 뒤 새로고침해 주세요.' : '잠시 뒤 새로고침해 주세요. 계속되면 워커 로그를 확인해 주세요.',
      '<a class="btn btn-secondary btn-sm" href="">새로고침</a>',
    )}</section>`,
  });
}

admin.get('/', async (c) => {
  const nowMs = Date.now();
  try {
    const db = getDB(c.env);
    // 스토어 숫자는 따로 읽는다 — 그 표가 아직 없는 창(마이그레이션 #138 전)이어도 개요의 나머지는 그린다.
    const [overview, store] = await Promise.all([
      loadOverview(db, parseRange(c.req.query('range')), nowMs),
      loadStoreDownloads(db, c.env).catch((err: unknown) => {
        console.error('[admin] store downloads failed', err);
        return null;
      }),
    ]);
    return html(c, (nonce) => renderOverview(nonce, overview, nowMs, store));
  } catch (err) {
    console.error('[admin] overview failed', err);
    return html(c, (nonce) => unavailable(nonce, err, 'overview'), 500);
  }
});

// --- 합성 운영(JSON — `docs/spec/tts-render-and-budget.md` §4·§5). 읽기만 한다. ---

/** 다시 구울 목록과 예상 글자. `?kind=` 를 주면 그 종류의 대상 한 쪽(`limit` ≤100·`offset`), `?legacy=1` 은 지문 이전 행도. */
admin.get('/tts/render-backlog', async (c) => {
  const kind = c.req.query('kind');
  if (kind !== undefined && !isRerenderKind(kind)) {
    return jsonError(c, 400, 'INVALID_REQUEST', 'kind must be one of system_stock, clone_prerender, manual, other.');
  }
  try {
    const body = await loadRenderBacklog(getDB(c.env), c.env, {
      kind: kind ?? null,
      includeLegacy: c.req.query('legacy') === '1',
      limit: Number(c.req.query('limit') ?? 50),
      offset: Number(c.req.query('offset') ?? 0),
    });
    return c.json(body);
  } catch (err) {
    console.error('[admin] render backlog failed', err);
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Could not read the render backlog.');
  }
});

/** 요청 종류별 합성 사용량·예산 설정·클론 슬롯. `?days=`(1~100, 기본 31), `?provider=1` 이면 공급자 잔여도 조회한다. */
admin.get('/tts/usage', async (c) => {
  try {
    const body = await loadTtsUsage(getDB(c.env), c.env, {
      days: Number(c.req.query('days') ?? 31),
      provider: c.req.query('provider') === '1',
    });
    return c.json(body);
  } catch (err) {
    console.error('[admin] tts usage failed', err);
    return jsonError(c, 500, 'INTERNAL_ERROR', 'Could not read the synthesis usage.');
  }
});

admin.get('/usage', async (c) => {
  try {
    const metrics = await loadUsageMetrics(getDB(c.env), parseUsageFilter((key) => c.req.query(key)));
    return html(c, (nonce) => renderUsage(nonce, metrics));
  } catch (err) {
    console.error('[admin] usage failed', err);
    return html(c, (nonce) => unavailable(nonce, err, 'usage'), 500);
  }
});

admin.get('/users', async (c) => {
  const nowMs = Date.now();
  const q = (c.req.query('q') ?? '').slice(0, 100);
  try {
    const users = await searchUsers(getDB(c.env), q);
    return html(c, (nonce) => renderUsers(nonce, q, users, nowMs));
  } catch (err) {
    console.error('[admin] users failed', err);
    return html(c, (nonce) => unavailable(nonce, err, 'users'), 500);
  }
});

// --- 사용자 상세(읽기 전용) ---

admin.get('/users/:id', async (c) => {
  const now = new Date();
  try {
    const detail = await loadUserDetail(getDB(c.env), c.req.param('id'));
    if (!detail) {
      return html(c, (nonce) =>
        page({
          title: '사용자 없음',
          active: 'users',
          nonce,
          body: `<section class="panel">${emptyState('계정을 찾지 못했어요', '탈퇴했거나 id 가 틀렸어요.', '<a class="btn btn-secondary btn-sm" href="/admin/users">사용자 목록</a>')}</section>`,
        }),
      );
    }
    return html(c, (nonce) => renderUserDetail(nonce, detail, now));
  } catch (err) {
    console.error('[admin] user detail failed', err);
    return html(c, (nonce) => unavailable(nonce, err, 'users'), 500);
  }
});

// --- 광고 보상 대조 (읽기 전용 JSON — `docs/spec/ad-rewards.md` §7) ---
// 장기 미확정 승인 세션·정산 못 한 콜백을 모으고, 한 사람의 승인·콜백·거래·잔액을 나란히 둔다. ⚠ 쓰기(고객 보상 지급·
// 재정산)는 없다 — 후속이다. 붙일 때는 같은 승인 id 에 묶어 이중 적립을 막고 사유·감사 이력을 남긴다.
admin.get('/ad-rewards.json', async (c) => {
  try {
    return c.json(await loadAdRewardReconciliation(getDB(c.env), new Date()));
  } catch (err) {
    console.error('[admin] ad rewards failed', err);
    return jsonError(c, 500, 'INTERNAL_ERROR', '광고 보상 기록을 읽지 못했어요.');
  }
});

admin.get('/users/:id/ad-rewards.json', async (c) => {
  const userId = c.req.param('id').slice(0, 128);
  try {
    return c.json(await loadUserAdRewards(getDB(c.env), userId, new Date()));
  } catch (err) {
    console.error('[admin] user ad rewards failed', err);
    return jsonError(c, 500, 'INTERNAL_ERROR', '광고 보상 기록을 읽지 못했어요.');
  }
});

admin.get('/push', async (c) => {
  const test = (c.req.query('test') ?? '').trim().slice(0, 254);
  try {
    const jobs = await listPushJobs(getDB(c.env));
    return html(c, (nonce) =>
      renderPush(nonce, {
        jobs,
        testEmail: test || c.env.ADMIN_TEST_PUSH_EMAIL || '',
        preset: c.req.query('preset') ?? null,
        adPushEnabled: adPushEnabled(c.env),
      }),
    );
  } catch (err) {
    console.error('[admin] push page failed', err);
    return html(c, (nonce) => unavailable(nonce, err, 'push'), 500);
  }
});

// --- 알림 API(같은 출처 fetch, CSRF 검사를 지난다) ---

async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pushError(c: Context<AppEnv>, err: unknown) {
  if (err instanceof AdminPushError) {
    const status =
      err.code === 'ADMIN_PUSH_JOB_NOT_FOUND' || err.code === 'ADMIN_PUSH_TEST_RECIPIENT_NOT_FOUND'
        ? 404
        : err.code === 'ADMIN_PUSH_COPY_INVALID'
          ? 400
          : 409;
    return jsonError(c, status, err.code, err.message);
  }
  console.error('[admin] push failed', err);
  return jsonError(c, 500, 'ADMIN_PUSH_FAILED', '요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
}

admin.post('/push/preview', async (c) => {
  const body = await jsonBody(c);
  try {
    const kind = body.kind === 'ad' ? 'ad' : 'notice';
    const counts = await countAudience(getDB(c.env), effectiveAudience(kind, parseAudience(body)));
    return c.json(counts);
  } catch (err) {
    return pushError(c, err);
  }
});

admin.post('/push/test', async (c) => {
  const body = await jsonBody(c);
  try {
    const copy = parseCopy(body);
    const result = await sendTestPush(getDB(c.env), c.env, String(body.testEmail ?? ''), copy, Date.now());
    return c.json(result);
  } catch (err) {
    return pushError(c, err);
  }
});

admin.post('/push/jobs', async (c) => {
  const body = await jsonBody(c);
  try {
    const copy = parseCopy(body);
    const estimated = Math.min(Math.max(Math.trunc(Number(body.estimatedTotal) || 0), 0), 1_000_000);
    const id = await createPushJob(getDB(c.env), c.env, copy, parseAudience(body), estimated, Date.now());
    return c.json({ id });
  } catch (err) {
    return pushError(c, err);
  }
});

admin.post('/push/jobs/:id/step', async (c) => {
  try {
    return c.json(await runJobStep(getDB(c.env), c.env, c.req.param('id'), Date.now()));
  } catch (err) {
    return pushError(c, err);
  }
});

admin.post('/push/jobs/:id/cancel', async (c) => {
  const db = getDB(c.env);
  try {
    await cancelPushJob(db, c.req.param('id'));
    return c.json(await runJobStep(db, c.env, c.req.param('id'), Date.now()));
  } catch (err) {
    return pushError(c, err);
  }
});

export default admin;
