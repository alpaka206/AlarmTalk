import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { bodyLimitMiddleware } from '../src/middleware/bodyLimit';

function buildApp() {
  const app = new Hono();
  app.use('*', bodyLimitMiddleware);
  app.post('/upload', (c) => c.json({ ok: true }));
  return app;
}

describe('bodyLimitMiddleware', () => {
  it.each([undefined, '1'])(
    'Content-Length=%s 여도 실제 25 MiB 초과는 거절한다',
    async (length) => {
      let reached = false;
      let cancelled = false;
      let chunks = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (++chunks <= 26) controller.enqueue(new Uint8Array(1024 * 1024));
          else controller.close();
        },
        cancel() {
          cancelled = true;
        },
      });
      const app = new Hono();
      app.use('*', bodyLimitMiddleware);
      app.post('/upload', (c) => {
        reached = true;
        return c.json({ ok: true });
      });
      const res = await app.request(
        new Request('http://localhost/upload', {
          method: 'POST',
          body: stream,
          duplex: 'half',
          headers: length ? { 'Content-Length': length } : {},
        } as RequestInit),
      );
      expect(res.status).toBe(413);
      expect((await res.json()).error_code).toBe('REQUEST_BODY_TOO_LARGE');
      expect(reached).toBe(false);
      expect(cancelled).toBe(true);
    },
  );
  it('크기 검사 후에도 JSON 바이트와 요청 헤더를 그대로 라우트에 전달한다', async () => {
    const app = new Hono();
    app.use('*', bodyLimitMiddleware);
    app.post('/upload', async (c) =>
      c.json({ body: await c.req.json(), header: c.req.header('x-test') }),
    );
    const res = await app.request('/upload', {
      method: 'POST',
      body: '{"name":"한글"}',
      headers: { 'Content-Type': 'application/json', 'x-test': 'kept' },
    });
    expect(await res.json()).toEqual({ body: { name: '한글' }, header: 'kept' });
  });
  it('Content-Length 미포함 시 통과', async () => {
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/upload', { method: 'POST' }));
    expect(res.status).toBe(200);
  });

  it('25MB 이하 요청 통과', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/upload', {
        method: 'POST',
        headers: { 'Content-Length': String(25 * 1024 * 1024) },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('25MB 초과 시 413', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/upload', {
        method: 'POST',
        headers: { 'Content-Length': String(25 * 1024 * 1024 + 1) },
      }),
    );
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toContain('too large');
  });
});
