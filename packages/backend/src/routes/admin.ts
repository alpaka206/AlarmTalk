import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { authRateLimitMiddleware } from '../middleware/rateLimit';
import { jsonError } from '../lib/api-error';
import { countAudience, parseAudience } from '../lib/admin/audience';
import { listPushJobs, loadOverview, parseRange, searchUsers } from '../lib/admin/metrics';
import { loadStoreDownloads } from '../lib/admin/store-downloads';
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
import { renderGrantConfirm, renderUserDetail } from '../lib/admin/grant-pages';
import { loadUserDetail } from '../lib/admin/user-detail';
import { loadRenderBacklog, loadTtsUsage } from '../lib/admin/tts-ops';
import { isRerenderKind } from '../lib/render-backlog';
import {
  createPlanGrant,
  grantEndFor,
  isPlanGrantReason,
  PLAN_GRANT_MAX_DAYS,
  PlanGrantError,
  revokePlanGrant,
  type PlanGrantLength,
} from '../lib/plan-grants';
import { renderVoicePackDetail, renderVoicePackList } from '../lib/admin/voice-pack-pages';
import {
  deleteVoicePackClip,
  importVoicePackClip,
  isVoicePackTransition,
  listVoicePackClipsFor,
  listVoicePackEvents,
  listVoicePacks,
  loadVoicePack,
  loadVoicePackClips,
  transitionVoicePack,
  updateVoicePackRights,
  upsertDraftVoicePack,
  VoicePackAdminError,
  VOICE_PACK_AUDIO_MIME,
} from '../lib/voice-packs';
import { R2VoiceStorage } from '../lib/r2-storage';

// MARK: - 관리자 전용 페이지 (/admin/*)
//
// 사용자 JWT 가 아니라 ADMIN_SECRET(관리자 비밀번호)로 보호한다. 로그인은 비밀번호만
// 입력하는 폼(/admin/login) — 이메일/아이디는 받지 않는다. 성공 시 ADMIN_SECRET 로 서명한
// 세션 쿠키(HttpOnly·Secure·SameSite=Strict)를 발급하고 이후 요청은 그 쿠키로 인증한다.
// curl/스크립트용으로 HTTP Basic(비밀번호=ADMIN_SECRET, 아이디 무시)도 그대로 허용한다.
// ADMIN_SECRET 미설정 시 503. 접속: https://<host>/admin/login
//
// 사용자 상세에서 **플러스 기간 지급·회수**를 한다(2026-10-26 오너 승인 — 스토어 밖 유일한 운영 예외, 코드 입력 없음).
//
// 화면은 개요 · 사용자 · 알림 보내기 · 음성팩 넷이다(`docs/spec/admin-console.md`, 음성팩은 `docs/spec/voice-packs.md`). 2026-10-23 에 다시 만들면서 프로모 코드
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
function unavailable(nonce: string, err: unknown, active: 'overview' | 'users' | 'push' | 'packs'): string {
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

// --- 사용자 상세 · 플러스 기간 지급 ---

/** 콘솔은 비밀번호 하나로 들어온다 — 사람을 가를 수 없어 지급자는 '콘솔' 로 적는다. */
const ADMIN_ACTOR = 'admin-console';

const FLASH: Record<string, { tone: 'good' | 'bad'; text: string }> = {
  granted: { tone: 'good', text: '플러스를 지급했어요. 앱은 다음 갱신 때 반영해요.' },
  again: { tone: 'good', text: '이미 처리한 지급이에요. 다시 주지 않았어요.' },
  revoked: { tone: 'good', text: '지급을 회수했어요. 다른 권한이 없으면 지금부터 3일 뒤 목소리를 지워요.' },
};

function grantFlash(code: string | undefined, err: string | undefined): { tone: 'good' | 'bad'; text: string } | null {
  if (err) return { tone: 'bad', text: err.slice(0, 120) };
  return code ? (FLASH[code] ?? null) : null;
}

function grantErrorRedirect(c: Context<AppEnv>, userId: string, err: unknown) {
  const text =
    err instanceof PlanGrantError ? err.message : '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  if (!(err instanceof PlanGrantError)) console.error('[admin] grant failed', err);
  return c.redirect(`/admin/users/${encodeURIComponent(userId)}?err=${encodeURIComponent(text)}`, 303);
}

admin.get('/users/:id', async (c) => {
  const now = new Date();
  try {
    const detail = await loadUserDetail(getDB(c.env), c.req.param('id'), now);
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
    const flash = grantFlash(c.req.query('done'), c.req.query('err'));
    return html(c, (nonce) => renderUserDetail(nonce, detail, now, flash));
  } catch (err) {
    console.error('[admin] user detail failed', err);
    return html(c, (nonce) => unavailable(nonce, err, 'users'), 500);
  }
});

admin.post('/users/:id/grants/preview', async (c) => {
  const userId = c.req.param('id');
  const now = new Date();
  const form = await c.req.parseBody();
  const lengthKey = String(form.length ?? '');
  const reason = String(form.reason ?? '');
  const note = String(form.note ?? '').trim().slice(0, 200);
  try {
    if (!isPlanGrantReason(reason)) throw new PlanGrantError('ADMIN_GRANT_INVALID', '지급 사유를 골라 주세요.');
    const length: PlanGrantLength =
      lengthKey === '1m'
        ? { kind: 'months', months: 1 }
        : lengthKey === 'until'
          ? { kind: 'until', date: String(form.until ?? '') }
          : { kind: 'days', days: 7 };
    const endsAt = grantEndFor(length, now);
    const detail = await loadUserDetail(getDB(c.env), userId, now);
    if (!detail || detail.deletionStatus !== 'active' || detail.isSystem) {
      throw new PlanGrantError('ADMIN_GRANT_USER_NOT_FOUND', '지급할 계정을 찾지 못했어요. 탈퇴 대기 계정에는 줄 수 없어요.');
    }
    const lengthLabel =
      length.kind === 'months' ? '1개월 (한국 달력 기준)' : length.kind === 'days' ? '7일' : `${length.date} 끝까지`;
    const requestKey = crypto.randomUUID().replace(/-/g, '');
    return html(c, (nonce) => renderGrantConfirm(nonce, detail, { endsAt, lengthLabel, reason, note, requestKey }, now));
  } catch (err) {
    return grantErrorRedirect(c, userId, err);
  }
});

admin.post('/users/:id/grants', async (c) => {
  const userId = c.req.param('id');
  const now = new Date();
  const form = await c.req.parseBody();
  try {
    const endsAt = new Date(String(form.ends_at ?? ''));
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() - now.getTime() > PLAN_GRANT_MAX_DAYS * 24 * 60 * 60 * 1000) {
      throw new PlanGrantError('ADMIN_GRANT_INVALID', '확인 화면을 다시 열어 주세요.');
    }
    const reason = String(form.reason ?? '');
    if (!isPlanGrantReason(reason)) throw new PlanGrantError('ADMIN_GRANT_INVALID', '지급 사유를 골라 주세요.');
    const { created } = await createPlanGrant(
      getDB(c.env),
      c.env,
      {
        userPk: userId,
        endsAt,
        reason,
        note: String(form.note ?? ''),
        actor: ADMIN_ACTOR,
        requestKey: String(form.request_key ?? ''),
      },
      now,
    );
    return c.redirect(`/admin/users/${encodeURIComponent(userId)}?done=${created ? 'granted' : 'again'}`, 303);
  } catch (err) {
    return grantErrorRedirect(c, userId, err);
  }
});

admin.post('/grants/:id/revoke', async (c) => {
  const form = await c.req.parseBody();
  const userId = String(form.user ?? '');
  try {
    if (form.confirm !== '1') throw new PlanGrantError('ADMIN_GRANT_INVALID', '회수 확인을 체크해 주세요.');
    const grant = await revokePlanGrant(getDB(c.env), c.env, c.req.param('id'), ADMIN_ACTOR, new Date());
    return c.redirect(`/admin/users/${encodeURIComponent(grant.userId)}?done=revoked`, 303);
  } catch (err) {
    return grantErrorRedirect(c, userId, err);
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

// --- 추가 음성팩 검수·게시(`docs/spec/voice-packs.md` §4·§6) ---
//
// 화면(폼)은 검수·권리·전이를 하고, 가져오기(JSON)는 스크립트(`scripts/import-voice-pack.ts`, Basic)가 한다. 모든 쓰기는
// `voice_pack_events` 에 감사 기록을 남긴다(lib/voice-packs.ts 의 쓰기 함수들이 같은 트랜잭션에서 적는다).

/** 스크립트로 부른 쓰기의 행위자. 화면 쓰기는 `ADMIN_ACTOR`. */
const ADMIN_SCRIPT_ACTOR = 'admin-script';

const PACK_FLASH: Record<string, string> = {
  rights: '권리를 저장했어요.',
  submit: '검수를 요청했어요.',
  reject: '반려했어요. 다시 draft 예요.',
  publish: '게시했어요. 앱은 다음 목록 조회부터 보여요.',
  suspend: '게시를 중단했어요. 기존 알람은 허락된 기한까지 울고, 그 뒤 미나로 바뀌어요.',
  republish: '다시 게시했어요.',
  revise: 'draft 로 되돌렸어요. 앱에는 계속 게시 끝남으로 보여요.',
  clip_deleted: '클립을 지웠어요.',
};

function packRedirect(c: Context<AppEnv>, packId: string, done: string | null, err?: unknown) {
  const base = `/admin/voice-packs/${encodeURIComponent(packId)}`;
  if (err !== undefined) {
    const text = err instanceof VoicePackAdminError ? err.message : '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    if (!(err instanceof VoicePackAdminError)) console.error('[admin] voice pack write failed', err);
    return c.redirect(`${base}?err=${encodeURIComponent(text)}`, 303);
  }
  return c.redirect(`${base}${done ? `?done=${encodeURIComponent(done)}` : ''}`, 303);
}

function packJsonError(c: Context<AppEnv>, err: unknown) {
  if (err instanceof VoicePackAdminError) {
    const status = err.code === 'ADMIN_VOICE_PACK_NOT_FOUND' ? 404 : err.code === 'ADMIN_VOICE_PACK_LOCKED' ? 409 : 400;
    return jsonError(c, status, err.code, err.message);
  }
  console.error('[admin] voice pack import failed', err);
  return jsonError(c, 500, 'INTERNAL_ERROR', '요청을 처리하지 못했어요.');
}

admin.get('/voice-packs', async (c) => {
  const now = new Date();
  try {
    const db = getDB(c.env);
    const packs = await listVoicePacks(db);
    const clips = await listVoicePackClipsFor(
      db,
      packs.map((p) => p.id),
    );
    const rows = packs.map((pack) => {
      const list = clips.get(pack.id) ?? [];
      return { pack, clipCount: list.length, totalBytes: list.reduce((sum, clip) => sum + Number(clip.size_bytes), 0) };
    });
    return html(c, (nonce) => renderVoicePackList(nonce, rows, now));
  } catch (err) {
    console.error('[admin] voice packs failed', err);
    return html(c, (nonce) => unavailable(nonce, err, 'packs'), 500);
  }
});

admin.get('/voice-packs/:packId', async (c) => {
  const now = new Date();
  try {
    const db = getDB(c.env);
    const pack = await loadVoicePack(db, c.req.param('packId'));
    if (!pack) {
      return html(c, (nonce) =>
        page({
          title: '팩 없음',
          active: 'packs',
          nonce,
          body: `<section class="panel">${emptyState('팩을 찾지 못했어요', 'id 가 틀렸거나 아직 만들지 않았어요.', '<a class="btn btn-secondary btn-sm" href="/admin/voice-packs">팩 목록</a>')}</section>`,
        }),
      );
    }
    const [clips, events] = await Promise.all([loadVoicePackClips(db, pack.id), listVoicePackEvents(db, pack.id)]);
    const err = c.req.query('err');
    const done = c.req.query('done');
    const flash = err
      ? { tone: 'bad' as const, text: err.slice(0, 200) }
      : done && PACK_FLASH[done]
        ? { tone: 'good' as const, text: PACK_FLASH[done]! }
        : null;
    return html(c, (nonce) => renderVoicePackDetail(nonce, pack, clips, events, now, flash));
  } catch (err) {
    console.error('[admin] voice pack detail failed', err);
    return html(c, (nonce) => unavailable(nonce, err, 'packs'), 500);
  }
});

/** 검수용 듣기 — 상태와 무관하게 콘솔만 듣는다(앱 API 는 게시된 팩만 준다). */
admin.get('/voice-packs/:packId/clips/:clipId/audio', async (c) => {
  const db = getDB(c.env);
  const res = await db.execute({
    sql: 'SELECT audio_key, audio_format FROM voice_pack_clips WHERE id = ? AND pack_id = ?',
    args: [c.req.param('clipId'), c.req.param('packId')],
  });
  const row = res.rows[0];
  const bucket = c.env.VOICE_BUCKET;
  const stored = row && bucket ? await new R2VoiceStorage(bucket).get(String(row.audio_key)) : null;
  if (!row || !stored) return c.text('Not found', 404);
  return new Response(stored.bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      'Content-Type': VOICE_PACK_AUDIO_MIME[String(row.audio_format)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

admin.post('/voice-packs/import', async (c) => {
  const body = await jsonBody(c);
  try {
    const { created, pack } = await upsertDraftVoicePack(
      getDB(c.env),
      {
        packId: String(body.pack_id ?? ''),
        speakerName: String(body.speaker_name ?? ''),
        description: typeof body.description === 'string' ? body.description : '',
        usageNote: typeof body.usage_note === 'string' ? body.usage_note : '',
        language: String(body.language ?? ''),
        minAndroidBuild: Number(body.min_android_build ?? 0),
        minIosBuild: Number(body.min_ios_build ?? 0),
      },
      ADMIN_SCRIPT_ACTOR,
    );
    return c.json({ created, pack_id: pack.id, voice_id: pack.voice_id, status: pack.status });
  } catch (err) {
    return packJsonError(c, err);
  }
});

admin.post('/voice-packs/:packId/clips', async (c) => {
  const body = await jsonBody(c);
  try {
    const clip = await importVoicePackClip(
      getDB(c.env),
      c.env.VOICE_BUCKET,
      c.req.param('packId'),
      {
        category: String(body.category ?? ''),
        variant: Number(body.variant),
        text: String(body.text ?? ''),
        audioBase64: String(body.audio_base64 ?? ''),
        audioFormat: String(body.audio_format ?? ''),
      },
      ADMIN_SCRIPT_ACTOR,
    );
    return c.json({ clip_id: clip.id, sha256: clip.sha256, size_bytes: clip.size_bytes });
  } catch (err) {
    return packJsonError(c, err);
  }
});

admin.post('/voice-packs/:packId/clips/:clipId/delete', async (c) => {
  const packId = c.req.param('packId');
  const form = await c.req.parseBody();
  try {
    if (form.confirm !== '1') throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '삭제 확인을 체크해 주세요.');
    await deleteVoicePackClip(getDB(c.env), c.env.VOICE_BUCKET, packId, c.req.param('clipId'), ADMIN_ACTOR);
    return packRedirect(c, packId, 'clip_deleted');
  } catch (err) {
    return packRedirect(c, packId, null, err);
  }
});

admin.post('/voice-packs/:packId/rights', async (c) => {
  const packId = c.req.param('packId');
  const form = await c.req.parseBody();
  try {
    await updateVoicePackRights(
      getDB(c.env),
      packId,
      {
        rightsStatus: String(form.rights_status ?? ''),
        evidenceRef: String(form.evidence_ref ?? ''),
        validFrom: String(form.valid_from ?? ''),
        validUntil: String(form.valid_until ?? ''),
        allowedText: String(form.allowed_text ?? ''),
        allowedRegions: String(form.allowed_regions ?? ''),
        existingFileTerms: String(form.file_terms ?? ''),
        existingPlaybackUntil: String(form.playback_until ?? ''),
        note: String(form.note ?? ''),
      },
      ADMIN_ACTOR,
      new Date(),
    );
    return packRedirect(c, packId, 'rights');
  } catch (err) {
    return packRedirect(c, packId, null, err);
  }
});

admin.post('/voice-packs/:packId/transition', async (c) => {
  const packId = c.req.param('packId');
  const form = await c.req.parseBody();
  const action = String(form.action ?? '');
  try {
    if (!isVoicePackTransition(action)) throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '할 일을 골라 주세요.');
    if ((action === 'publish' || action === 'suspend' || action === 'republish') && form.confirm !== '1') {
      throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '확인을 체크해 주세요.');
    }
    await transitionVoicePack(getDB(c.env), packId, action, String(form.note ?? ''), ADMIN_ACTOR, new Date());
    return packRedirect(c, packId, action);
  } catch (err) {
    return packRedirect(c, packId, null, err);
  }
});

export default admin;
