import { createMiddleware } from 'hono/factory';
import { Toucan } from 'toucan-js';
import type { AppEnv } from '../types';

export const sentryMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const dsn = c.env.SENTRY_DSN;
  if (!dsn) {
    await next();
    return;
  }

  // RTDN 웹훅 등은 ?token=<secret> 쿼리로 인증한다. Toucan 에 원본 요청을 그대로 넘기면
  // 500 발생 시 쿼리스트링(=시크릿)이 Sentry 로 전송된다. 요청 URL 에서 쿼리스트링을 제거한
  // 사본을 넘기고, allowedSearchParams 도 명시적으로 비활성화해 어떤 쿼리 파라미터도 캡처되지
  // 않게 한다(인증 메커니즘 자체는 건드리지 않음 — 라우트 핸들러는 원본 c.req 를 그대로 사용).
  const sanitizedUrl = new URL(c.req.raw.url);
  sanitizedUrl.search = '';
  const sanitizedRequest = new Request(sanitizedUrl.toString(), c.req.raw);

  const sentry = new Toucan({
    dsn,
    request: sanitizedRequest,
    context: c.executionCtx,
    environment: c.env.ENVIRONMENT || 'production',
    requestDataOptions: {
      allowedSearchParams: false,
    },
  });

  c.set('sentry', sentry);
  await next();
});
