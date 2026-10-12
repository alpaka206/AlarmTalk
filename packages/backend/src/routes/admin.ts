import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { authRateLimitMiddleware } from '../middleware/rateLimit';

// MARK: - 관리자 전용 페이지 (/admin/*)
//
// 사용자 JWT 가 아니라 ADMIN_SECRET(관리자 비밀번호)로 보호한다. 로그인은 비밀번호만
// 입력하는 폼(/admin/login) — 이메일/아이디는 받지 않는다. 성공 시 ADMIN_SECRET 로 서명한
// 세션 쿠키(HttpOnly·Secure·SameSite=Strict)를 발급하고 이후 요청은 그 쿠키로 인증한다.
// curl/스크립트용으로 HTTP Basic(비밀번호=ADMIN_SECRET, 아이디 무시)도 그대로 허용한다.
// ADMIN_SECRET 미설정 시 503. 접속: https://<host>/admin/login
//
// 프로모 코드 **이력**(발급했던 코드와 사용 수)을 읽기 전용으로 보여 준다. 발급·켜기는 없다 —
// 프로모 코드는 2026-10-12 에 없앴다(App Store 3.1.1 반려, `routes/code.ts` 머리말). 서버가 더는
// 받지 않으므로 여기서 새 코드를 만들어도 아무도 쓸 수 없다 — 발급 폼을 되살리지 말 것.

const admin = new Hono<AppEnv>();

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 로그인 세션 12시간

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 배포→마이그레이션 사이 창에서 아직 없는 컬럼을 참조했는지 판별.
 * SELECT 는 "no such column: X", INSERT 컬럼 목록은 "table T has no column named X" 로 온다.
 */
function isMissingColumnError(err: unknown): boolean {
  return /no such column|has no column named/i.test(String(err));
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function renderLoginPage(errorMsg: string | null): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AlarmTalk 관리자 · 로그인</title><style>${PAGE_STYLE}
  form.login { max-width: 320px; margin: 40px auto 0; display: flex; flex-direction: column; gap: 12px; }
  form.login input { padding: 10px; font-size: 15px; }
</style></head><body>
<h1>관리자 로그인</h1>
${errorMsg ? `<div class="msg err">${escapeHtml(errorMsg)}</div>` : ''}
<form class="login" method="post" action="/admin/login">
  <label>비밀번호
    <input name="password" type="password" required autocomplete="current-password" autofocus>
  </label>
  <button type="submit">로그인</button>
</form>
</body></html>`;
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
    return c.redirect('/admin/promo', 302);
  }
  return c.html(renderLoginPage(c.req.query('err') || null));
});

// 비밀번호만 검증(아이디/이메일 없음). 무차별 대입은 authRateLimitMiddleware(IP당 15/분)로 좁힌다.
admin.post('/login', authRateLimitMiddleware, async (c) => {
  const secret = c.env.ADMIN_SECRET!;
  const form = await c.req.parseBody();
  const password = String(form.password ?? '');
  if (!safeEqual(password, secret)) {
    return c.redirect('/admin/login?err=' + encodeURIComponent('비밀번호가 올바르지 않습니다'), 303);
  }
  const token = await makeSessionToken(secret, Date.now());
  return new Response(null, {
    status: 303,
    headers: { Location: '/admin/promo', 'Set-Cookie': sessionCookieHeader(token) },
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
  return c.redirect('/admin/login', 302);
});

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; }
  button { padding: 8px 14px; font-size: 14px; cursor: pointer; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 13px; }
  th, td { border: 1px solid #8883; padding: 6px 8px; text-align: left; }
  code { background: #8882; padding: 1px 5px; border-radius: 4px; }
  .msg { padding: 10px 12px; border-radius: 6px; margin: 12px 0; }
  .msg.err { background: #e74c3c33; }
  .muted { opacity: 0.6; } .off { opacity: 0.45; }
`;

admin.get('/promo', async (c) => {
  const db = getDB(c.env);
  // deploy-backend.yml 이 배포 '후' 마이그레이션을 돌리므로, redemption_group(#72) 컬럼이
  // 아직 없는 창에서도 콘솔이 500 나지 않게 레거시 스키마로 폴백한다.
  // NULL AS redemption_group 으로 렌더러는 그대로 쓴다.
  let codesRes;
  try {
    codesRes = await db.execute({
      sql: `SELECT p.id, p.code, p.duration_days, p.valid_from, p.valid_until,
                   p.max_redemptions, p.is_active, p.note, p.created_at, p.redemption_group,
                   pl.key AS plan_key, pl.name AS plan_name,
                   (SELECT COUNT(*) FROM promo_code_redemptions r WHERE r.promo_code_id = p.id) AS used
            FROM promo_codes p
            LEFT JOIN plans pl ON pl.id = p.plan_id
            ORDER BY p.created_at DESC`,
    });
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    codesRes = await db.execute({
      sql: `SELECT p.id, p.code, p.duration_days, p.valid_from, p.valid_until,
                   p.max_redemptions, p.is_active, p.note, p.created_at, NULL AS redemption_group,
                   pl.key AS plan_key, pl.name AS plan_name,
                   (SELECT COUNT(*) FROM promo_code_redemptions r WHERE r.promo_code_id = p.id) AS used
            FROM promo_codes p
            LEFT JOIN plans pl ON pl.id = p.plan_id
            ORDER BY p.created_at DESC`,
    });
  }

  const rows = codesRes.rows
    .map((r) => {
      const active = Number(r.is_active) === 1;
      const max = r.max_redemptions == null ? '∞' : escapeHtml(r.max_redemptions);
      const from = r.valid_from ? escapeHtml(r.valid_from) : '—';
      const until = r.valid_until ? escapeHtml(r.valid_until) : '—';
      return `<tr class="${active ? '' : 'off'}">
        <td><code>${escapeHtml(r.code)}</code></td>
        <td>${escapeHtml(r.plan_name ?? r.plan_key ?? '?')}</td>
        <td>${escapeHtml(r.duration_days)}일</td>
        <td>${escapeHtml(r.used)} / ${max}</td>
        <td>${from}<br>~ ${until}</td>
        <td>${r.redemption_group ? `<code>${escapeHtml(r.redemption_group)}</code>` : '—'}</td>
        <td>${active ? '✅' : '⛔'}</td>
        <td class="muted">${escapeHtml(r.note ?? '')}</td>
      </tr>`;
    })
    .join('');

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AlarmTalk 관리자 · 프로모 코드 이력</title><style>${PAGE_STYLE}
  .topbar { display: flex; justify-content: space-between; align-items: center; }
</style></head><body>
<div class="topbar">
  <h1>프로모 코드 이력</h1>
  <form method="post" action="/admin/logout" style="margin:0"><button type="submit">로그아웃</button></form>
</div>
<div class="msg err">프로모 코드는 2026-10-12 에 없앴습니다. 앱과 서버가 더는 받지 않으므로 새로 발급하거나 다시 켤 수 없습니다(App Store 심사 지침 3.1.1). 이벤트 혜택은 스토어의 오퍼 코드로 하세요.</div>
<h2>발급했던 코드</h2>
<table>
  <thead><tr><th>코드</th><th>플랜</th><th>기간</th><th>사용/상한</th><th>유효창</th><th>그룹</th><th>활성</th><th>메모</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="8" class="muted">발급했던 코드가 없습니다.</td></tr>'}</tbody>
</table>
</body></html>`;

  return c.html(html);
});

export default admin;
