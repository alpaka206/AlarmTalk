import type { Context, Next } from 'hono';

const SLOW_THRESHOLD_MS = 1000;
const VERY_SLOW_THRESHOLD_MS = 3000;

function perfCategory(ms: number): 'fast' | 'normal' | 'slow' | 'very_slow' {
  if (ms >= VERY_SLOW_THRESHOLD_MS) return 'very_slow';
  if (ms >= SLOW_THRESHOLD_MS) return 'slow';
  if (ms < 100) return 'fast';
  return 'normal';
}

export async function loggerMiddleware(c: Context, next: Next) {
  const requestId = crypto.randomUUID().slice(0, 8);
  c.set('requestId', requestId);
  c.header('X-Request-Id', requestId);

  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;
  const reqContentLength =
    parseInt(c.req.header('content-length') || '0', 10) || undefined;

  await next();

  const duration_ms = Date.now() - start;
  const status = c.res.status;
  const route = c.req.routePath || path;
  const resContentLength =
    parseInt(c.res.headers.get('content-length') || '0', 10) || undefined;
  const perf = perfCategory(duration_ms);

  const isSlow = duration_ms >= SLOW_THRESHOLD_MS;
  const isError = status >= 500;
  const isClientError = status >= 400 && status < 500;
  // eslint-disable-next-line no-console
  const logFn = isError || isSlow ? console.error : isClientError ? console.warn : console.log;

  logFn(
    JSON.stringify({
      rid: requestId,
      method,
      path,
      route,
      status,
      duration_ms,
      perf,
      req_bytes: reqContentLength,
      res_bytes: resContentLength,
      uid: (c.get('userId') as string | undefined) || undefined,
    }),
  );
}
