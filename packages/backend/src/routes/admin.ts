import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { authRateLimitMiddleware } from '../middleware/rateLimit';
import { jsonError } from '../lib/api-error';
import { countAudience, parseAudience } from '../lib/admin/audience';
import { listPushJobs, loadOverview, parseRange, searchUsers } from '../lib/admin/metrics';
import { renderLogin, renderOverview, renderPush, renderUsers } from '../lib/admin/pages';
import {
  AdminPushError,
  cancelPushJob,
  createPushJob,
  effectiveAudience,
  parseCopy,
  runJobStep,
  sendTestPush,
} from '../lib/admin/push-jobs';
import { emptyState, newNonce, page, securityHeaders } from '../lib/admin/ui';

// MARK: - 관리자 전용 페이지 (/admin/*)
//
// 사용자 JWT 가 아니라 ADMIN_SECRET(관리자 비밀번호)로 보호한다. 로그인은 비밀번호만
// 입력하는 폼(/admin/login) — 이메일/아이디는 받지 않는다. 성공 시 ADMIN_SECRET 로 서명한
// 세션 쿠키(HttpOnly·Secure·SameSite=Strict)를 발급하고 이후 요청은 그 쿠키로 인증한다.
// curl/스크립트용으로 HTTP Basic(비밀번호=ADMIN_SECRET, 아이디 무시)도 그대로 허용한다.
// ADMIN_SECRET 미설정 시 503. 접속: https://<host>/admin/login
//
// 화면은 개요 · 사용자 · 알림 보내기 셋이다(`docs/spec/admin-console.md`). 2026-10-23 에 다시 만들면서 프로모 코드
// 이력 화면은 지웠다 — 프로모 코드는 2026-10-12 에 없앴고(App Store 3.1.1), 코드를 쳐서 유료 기능을 여는 길을
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

// 비밀번호만 검증(아이디/이메일 없음). 무차별 대입은 authRateLimitMiddleware(IP당 15/분)로 좁힌다.
admin.post('/login', authRateLimitMiddleware, async (c) => {
  const secret = c.env.ADMIN_SECRET!;
  const form = await c.req.parseBody();
  const password = String(form.password ?? '');
  if (!safeEqual(password, secret)) {
    return c.redirect('/admin/login?err=1', 303);
  }
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
    try {
      const decoded = atob(header.slice(6));
      const pass = decoded.slice(decoded.indexOf(':') + 1);
      if (safeEqual(pass, secret)) return next();
    } catch {
      /* 잘못된 Basic 헤더 → 아래 로그인 리다이렉트로 폴백 */
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
function unavailable(nonce: string, err: unknown, active: 'overview' | 'users' | 'push'): string {
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
    const overview = await loadOverview(getDB(c.env), parseRange(c.req.query('range')), nowMs);
    return html(c, (nonce) => renderOverview(nonce, overview, nowMs));
  } catch (err) {
    console.error('[admin] overview failed', err);
    return html(c, (nonce) => unavailable(nonce, err, 'overview'), 500);
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

admin.get('/push', async (c) => {
  const test = (c.req.query('test') ?? '').trim().slice(0, 254);
  try {
    const jobs = await listPushJobs(getDB(c.env));
    return html(c, (nonce) =>
      renderPush(nonce, { jobs, testEmail: test || c.env.ADMIN_TEST_PUSH_EMAIL || '', preset: c.req.query('preset') ?? null }),
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
    const result = await sendTestPush(getDB(c.env), c.env, String(body.testEmail ?? ''), copy);
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
    const id = await createPushJob(getDB(c.env), copy, parseAudience(body), estimated, Date.now());
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
