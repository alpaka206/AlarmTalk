import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';

const captureExceptionMock = vi.hoisted(() => vi.fn());
const toucanCtorMock = vi.hoisted(() => vi.fn());

vi.mock('toucan-js', () => ({
  Toucan: class {
    captureException = captureExceptionMock;
    constructor(opts: unknown) {
      toucanCtorMock(opts);
    }
  },
}));

import { sentryMiddleware } from '../src/middleware/sentry';

beforeEach(() => {
  vi.clearAllMocks();
});

const fakeEnv = {
  SENTRY_DSN: '',
  ENVIRONMENT: 'test',
  TURSO_DATABASE_URL: '',
  TURSO_AUTH_TOKEN: '',
} as unknown as AppEnv['Bindings'];

const fakeCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};

function buildApp(dsn: string) {
  const app = new Hono<AppEnv>();
  app.use('*', sentryMiddleware);
  return { app, env: { ...fakeEnv, SENTRY_DSN: dsn } };
}

describe('sentryMiddleware', () => {
  it('passes through when DSN is not set', async () => {
    const { app, env } = buildApp('');
    app.get('/ok', (c) => c.json({ ok: true }));

    const req = new Request('http://localhost/ok');
    const res = await app.fetch(req, env, fakeCtx as never);
    expect(res.status).toBe(200);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('sets sentry on context when DSN is present', async () => {
    const { app, env } = buildApp('https://key@sentry.io/123');
    let hasSentry = false;
    app.get('/check', (c) => {
      hasSentry = c.get('sentry') != null;
      return c.json({ ok: true });
    });

    const req = new Request('http://localhost/check');
    const res = await app.fetch(req, env, fakeCtx as never);
    expect(res.status).toBe(200);
    expect(hasSentry).toBe(true);
  });

  it('does not capture when DSN absent and handler throws', async () => {
    const { app, env } = buildApp('');
    app.get('/fail', () => {
      throw new Error('no sentry');
    });

    const req = new Request('http://localhost/fail');
    const res = await app.fetch(req, env, fakeCtx as never);
    expect(res.status).toBe(500);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('captures exception via onError when DSN is present', async () => {
    const { app, env } = buildApp('https://key@sentry.io/123');
    const testError = new Error('boom');
    app.get('/fail', () => {
      throw testError;
    });
    app.onError((err, c) => {
      const sentry = c.get('sentry');
      if (sentry) sentry.captureException(err);
      return c.json({ error: err.message }, 500);
    });

    const req = new Request('http://localhost/fail');
    const res = await app.fetch(req, env, fakeCtx as never);
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(testError);
  });

  it('query string secrets are stripped before reaching Toucan', async () => {
    const { app, env } = buildApp('https://key@sentry.io/123');
    app.get('/api/billing/google', (c) => c.json({ ok: true }));

    const req = new Request('http://localhost/api/billing/google?token=super-secret');
    const res = await app.fetch(req, env, fakeCtx as never);
    expect(res.status).toBe(200);

    expect(toucanCtorMock).toHaveBeenCalled();
    const opts = toucanCtorMock.mock.calls[0][0] as {
      request: Request;
      requestDataOptions?: { allowedSearchParams?: unknown };
    };
    // Toucan 으로 넘어가는 요청 URL 에 쿼리스트링(시크릿)이 없어야 한다.
    expect(opts.request.url).not.toContain('token');
    expect(opts.request.url).not.toContain('super-secret');
    expect(new URL(opts.request.url).search).toBe('');
    // 어떤 쿼리 파라미터도 캡처되지 않도록 명시적으로 비활성화한다.
    expect(opts.requestDataOptions?.allowedSearchParams).toBe(false);
  });

  it('sanitized request preserves method and path for Toucan', async () => {
    const { app, env } = buildApp('https://key@sentry.io/123');
    app.get('/api/x', (c) => c.json({ ok: true }));

    const req = new Request('http://localhost/api/x?a=1');
    await app.fetch(req, env, fakeCtx as never);

    const opts = toucanCtorMock.mock.calls[0][0] as { request: Request };
    expect(opts.request.method).toBe('GET');
    expect(new URL(opts.request.url).pathname).toBe('/api/x');
  });

  it('onError without DSN does not call captureException', async () => {
    const { app, env } = buildApp('');
    app.get('/fail', () => {
      throw new Error('no dsn');
    });
    app.onError((err, c) => {
      const sentry = c.get('sentry');
      if (sentry) sentry.captureException(err);
      return c.json({ error: err.message }, 500);
    });

    const req = new Request('http://localhost/fail');
    const res = await app.fetch(req, env, fakeCtx as never);
    expect(res.status).toBe(500);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
