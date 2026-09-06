import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorCodeMiddleware } from '../src/middleware/errorCode';

function makeApp(sentry?: { captureException: ReturnType<typeof vi.fn> }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    if (sentry) c.set('sentry', sentry);
    c.set('userId', 'user-1');
    await next();
  });
  app.use('*', errorCodeMiddleware);
  return app;
}

function makeSentry() {
  return { captureException: vi.fn(), setTag: vi.fn(), setTags: vi.fn() };
}

describe('errorCodeMiddleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('본문을 소비하지 않는다 — 응답은 그대로 나간다', async () => {
    // ⚠ 이게 이 미들웨어의 가장 큰 위험이다. clone() 없이 읽으면 클라이언트가 받을 스트림이
    //    비어 **모든 에러 응답이 빈 몸통**으로 나간다.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = makeApp();
    app.get('/x', (c) => c.json({ error: 'nope', error_code: 'ALARM_NOT_FOUND' }, 404));

    const res = await app.request('/x');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'nope', error_code: 'ALARM_NOT_FOUND' });
  });

  it('4xx 는 코드와 함께 기록된다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = makeApp();
    app.get('/x', (c) => c.json({ error: 'nope', error_code: 'ALARM_NOT_FOUND' }, 404));
    await app.request('/x');

    const logged = JSON.parse(warn.mock.calls.at(-1)![0] as string);
    expect(logged).toMatchObject({
      level: 'warn',
      at: 'api_error',
      status: 404,
      code: 'ALARM_NOT_FOUND',
      method: 'GET',
      path: '/x',
      uid: 'user-1',
    });
  });

  it('다른 미들웨어가 낸 응답도 걸린다 — 라우트만 보는 게 아니다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = makeApp();
    // rateLimit·bodyLimit 처럼 라우트에 닿기 전에 끝나는 경우.
    app.use('/y', async (c) => c.json({ error: 'too many', error_code: 'RATE_LIMITED' }, 429));
    app.get('/y', (c) => c.json({ ok: true }));
    await app.request('/y');

    expect(JSON.parse(warn.mock.calls.at(-1)![0] as string).code).toBe('RATE_LIMITED');
  });

  it('평범한 4xx 는 경보로 보내지 않는다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sentry = makeSentry();
    const app = makeApp(sentry);
    app.get('/x', (c) => c.json({ error: 'bad', error_code: 'INVALID_JSON' }, 400));
    await app.request('/x');

    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('경보 목록에 있는 4xx 는 보낸다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sentry = makeSentry();
    const app = makeApp(sentry);
    app.get('/x', (c) =>
      c.json({ error: 'quota', error_code: 'MANUAL_TTS_QUOTA_EXCEEDED' }, 429),
    );
    await app.request('/x');

    expect(sentry.captureException).toHaveBeenCalledOnce();
    expect(String(sentry.captureException.mock.calls[0][0])).toContain('MANUAL_TTS_QUOTA_EXCEEDED');
  });

  it('5xx 는 보낸다 — 단 이미 보고했으면 두 번 보내지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sentry = makeSentry();
    const app = makeApp(sentry);
    app.get('/raw', (c) => c.json({ error: 'boom', error_code: 'INTERNAL_ERROR' }, 500));
    app.get('/reported', (c) => {
      // logRouteError 가 스택까지 붙여 이미 올린 상태를 흉내낸다.
      c.set('errorReported', true);
      return c.json({ error: 'boom', error_code: 'INTERNAL_ERROR' }, 500);
    });

    await app.request('/raw');
    expect(sentry.captureException).toHaveBeenCalledOnce();

    sentry.captureException.mockClear();
    await app.request('/reported');
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('throw 된 에러(onError 응답)도 기록된다', async () => {
    // ⚠ 여기가 무너지기 쉬운 자리다. 라우트가 throw 하면 `await next()` 가 던지므로
    //    미들웨어의 뒷부분이 안 돌 것처럼 보이지만, Hono 는 compose 안에서 onError 를
    //    불러 **응답으로 바꿔** 돌려준다. 그래서 여기서도 걸린다 — 실제로 확인한다.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = makeApp();
    app.get('/boom', () => {
      throw new Error('boom');
    });
    app.onError((_err, c) =>
      c.json({ error: 'Internal server error', error_code: 'INTERNAL_ERROR' }, 500),
    );

    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    const lines = error.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes('api_error') && line.includes('INTERNAL_ERROR'))).toBe(
      true,
    );
  });

  it('정상 응답에는 아무 기록도 남기지 않는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = makeApp();
    app.get('/ok', (c) => c.json({ ok: true }));
    await app.request('/ok');

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('JSON 이 아닌 에러 응답도 상태는 남긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = makeApp();
    app.get('/t', (c) => c.text('nope', 400));
    await app.request('/t');

    const logged = JSON.parse(warn.mock.calls.at(-1)![0] as string);
    expect(logged.status).toBe(400);
    expect(logged.code).toBeUndefined();
  });
});
