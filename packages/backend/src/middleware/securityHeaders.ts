import type { Context, Next } from 'hono';

export async function securityHeadersMiddleware(c: Context, next: Next) {
  await next();

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-DNS-Prefetch-Control', 'off');
  c.header('X-Download-Options', 'noopen');
  c.header('X-Permitted-Cross-Domain-Policies', 'none');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  // 관리자 콘솔(/admin)은 폼 유효기간 변환용 인라인 script 와 페이지 style 을 쓴다.
  // Basic 인증으로 보호되고 렌더링 데이터는 escapeHtml 로 이스케이프하므로, 이 경로에만
  // inline script/style 을 허용한다(그 외 API 응답은 default-src 'none' 유지).
  const isAdminConsole = c.req.path.startsWith('/admin');
  c.header(
    'Content-Security-Policy',
    isAdminConsole
      ? "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'"
      : "default-src 'none'; frame-ancestors 'none'",
  );
}
