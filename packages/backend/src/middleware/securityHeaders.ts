import type { Context, Next } from 'hono';

export async function securityHeadersMiddleware(c: Context, next: Next) {
  await next();

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  // 관리자 콘솔 화면은 자기 정책(nonce 스크립트·connect-src 'self'·same-origin)을 직접 싣는다
  // (`lib/admin/ui.ts` 의 `securityHeaders`). 덮어쓰면 화면 안의 fetch 가 전부 막힌다 — 이미 있으면 둔다.
  const isAdminConsole = c.req.path.startsWith('/admin');
  const keepRoutePolicy = isAdminConsole && c.res.headers.has('Content-Security-Policy');
  if (!keepRoutePolicy) c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-DNS-Prefetch-Control', 'off');
  c.header('X-Download-Options', 'noopen');
  c.header('X-Permitted-Cross-Domain-Policies', 'none');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  // API 는 검색 결과에 나오지 않는다 — 공개 페이지는 랜딩(alarm-talk.com)이다(2026-10-16, Search Console 이 API 루트를 크롤링).
  c.header('X-Robots-Tag', 'noindex, nofollow');
  if (keepRoutePolicy) return;
  // 그 밖의 /admin 응답(리다이렉트·JSON 오류)과 API 는 스크립트가 없다.
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
}
