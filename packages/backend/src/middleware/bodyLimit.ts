import type { Context, Next } from 'hono';

const MAX_BODY_BYTES = 25 * 1024 * 1024; // 25 MB (음성 파일 업로드 지원)

export async function bodyLimitMiddleware(c: Context, next: Next) {
  const contentLength = c.req.header('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return c.json({ error: 'Request body too large', error_code: 'REQUEST_BODY_TOO_LARGE' }, 413);
  }
  // Content-Length 는 없을 수도 있고 거짓일 수도 있다. 실제 스트림도 같은 상한으로 센다.
  const body = c.req.raw.body;
  if (body) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => undefined);
          return c.json(
            { error: 'Request body too large', error_code: 'REQUEST_BODY_TOO_LARGE' },
            413,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    // 제한 안의 바디는 그대로 다시 공급한다(JSON·multipart·바이너리 공통).
    c.req.raw = new Request(c.req.raw, {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
  }
  await next();
}
