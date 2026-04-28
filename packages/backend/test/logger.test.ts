import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { loggerMiddleware } from '../src/middleware/logger';

function buildApp(_status = 200) {
  const app = new Hono();
  app.use('*', loggerMiddleware);
  app.get('/ok', (c) => c.json({ ok: true }));
  app.get('/slow', async (c) => {
    await new Promise((r) => setTimeout(r, 5));
    return c.json({ ok: true });
  });
  app.get('/error', (c) => c.json({ error: 'fail' }, 500));
  app.get('/not-found', (c) => c.json({ error: 'not found' }, 404));
  return app;
}

function req(path: string) {
  return new Request(`http://localhost${path}`);
}

describe('loggerMiddleware', () => {
  /* eslint-disable no-console */
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  let logSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logSpy = vi.fn();
    warnSpy = vi.fn();
    errorSpy = vi.fn();
    console.log = logSpy;
    console.warn = warnSpy;
    console.error = errorSpy;
  });

  afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  });
  /* eslint-enable no-console */

  it('X-Request-Id 헤더 설정', async () => {
    const app = buildApp();
    const res = await app.request(req('/ok'));
    expect(res.status).toBe(200);
    const rid = res.headers.get('X-Request-Id');
    expect(rid).toBeTruthy();
    expect(rid!.length).toBe(8);
  });

  it('200 응답은 console.log 로 기록', async () => {
    const app = buildApp();
    await app.request(req('/ok'));
    expect(logSpy).toHaveBeenCalled();
    const logged = JSON.parse(logSpy.mock.calls[0][0]);
    expect(logged.status).toBe(200);
    expect(logged.method).toBe('GET');
    expect(logged.path).toBe('/ok');
    expect(logged.rid).toBeTruthy();
    expect(logged.duration_ms).toBeTypeOf('number');
  });

  it('500 응답은 console.error 로 기록', async () => {
    const app = buildApp();
    await app.request(req('/error'));
    expect(errorSpy).toHaveBeenCalled();
    const logged = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(logged.status).toBe(500);
  });

  it('404 응답은 console.warn 으로 기록', async () => {
    const app = buildApp();
    await app.request(req('/not-found'));
    expect(warnSpy).toHaveBeenCalled();
    const logged = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(logged.status).toBe(404);
  });

  it('perf 카테고리가 fast 로 분류 (빠른 응답)', async () => {
    const app = buildApp();
    await app.request(req('/ok'));
    const logged = JSON.parse(logSpy.mock.calls[0][0]);
    expect(logged.perf).toBe('fast');
  });
});
