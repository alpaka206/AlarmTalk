import type { Context, Next } from 'hono';

const MAX_BODY_BYTES = 25 * 1024 * 1024; // 25 MB (음성 파일 업로드 지원)

export async function bodyLimitMiddleware(c: Context, next: Next) {
  const contentLength = c.req.header('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return c.json({ error: 'Request body too large', error_code: 'REQUEST_BODY_TOO_LARGE' }, 413);
  }
  await next();
}
