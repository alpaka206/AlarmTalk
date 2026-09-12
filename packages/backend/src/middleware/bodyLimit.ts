import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { jsonError } from '../lib/api-error';

const MAX_BODY_BYTES = 25 * 1024 * 1024; // 25 MiB (음성 파일 업로드 지원)

export async function bodyLimitMiddleware(c: Context, next: Next) {
  const tooLarge = () => jsonError(c, 413, 'REQUEST_BODY_TOO_LARGE', 'Request body too large');
  const contentLength = c.req.header('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    void c.req.raw.body?.cancel().catch(() => undefined);
    return tooLarge();
  }
  const body = c.req.raw.body;
  if (!body) return next();

  const reader = body.getReader();
  let size = 0;
  let finished = false;
  let exceeded = false;
  // 취소가 느리거나 실패해도 401/413 응답을 붙잡지 않는다. 미소비 입력을 비우지도 않는다.
  const cancel = (reason?: unknown) => {
    if (finished) return;
    finished = true;
    void reader
      .cancel(reason)
      .catch(() => undefined)
      .finally(() => reader.releaseLock());
  };
  const limited = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (finished) return;
          if (done) {
            finished = true;
            reader.releaseLock();
            controller.close();
            return;
          }
          size += value.byteLength;
          if (size > MAX_BODY_BYTES) {
            exceeded = true;
            c.set('requestBodyLimitExceeded', true);
            const error = new HTTPException(413, { res: tooLarge() });
            controller.error(error);
            cancel(error);
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          if (finished) return;
          finished = true;
          reader.releaseLock();
          controller.error(error);
        }
      },
      cancel,
    },
    // 인증 전 선행 읽기를 막는다. 소비자가 read할 때만 청크 하나를 전달한다.
    { highWaterMark: 0 },
  );
  try {
    // Content-Length의 누락·위조와 무관하게 JSON/multipart/raw의 실제 읽기를 제한한다.
    c.req.raw = new Request(c.req.raw, { body: limited, duplex: 'half' } as RequestInit);
    await next();
    if (exceeded) {
      // 파서/라우트의 catch가 크기 예외를 400/500으로 바꿔도 최종 계약은 413이다.
      c.res = tooLarge();
    }
  } finally {
    cancel();
  }
}
