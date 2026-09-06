import { describe, expect, it, vi, beforeEach } from 'vitest';
import { logRouteError } from '../src/lib/logger';

function makeContext(overrides?: { userId?: string; sentry?: { captureException: ReturnType<typeof vi.fn> } }) {
  const vars = new Map<string, unknown>();
  return {
    req: { method: 'POST', path: '/api/friend' },
    get: (key: string) => {
      if (key === 'userId') return overrides?.userId;
      if (key === 'sentry') return overrides?.sentry;
      return vars.get(key);
    },
    // logRouteError 는 '이미 보고했다' 는 표시를 컨텍스트에 남긴다(errorCode 미들웨어가
    // 같은 5xx 를 두 번 올리지 않도록). 목이 set 을 갖고 있어야 실제 동작과 같아진다.
    set: (key: string, value: unknown) => vars.set(key, value),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('logRouteError', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('outputs structured JSON for Error instances', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = makeContext({ userId: 'user-1' });
    logRouteError(c, new Error('DB connection failed'));

    expect(spy).toHaveBeenCalledOnce();
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.level).toBe('error');
    expect(logged.method).toBe('POST');
    expect(logged.path).toBe('/api/friend');
    expect(logged.uid).toBe('user-1');
    expect(logged.error).toBe('DB connection failed');
    expect(logged.stack).toBeDefined();
  });

  it('outputs structured JSON for non-Error values', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = makeContext();
    logRouteError(c, 'string error');

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.error).toBe('string error');
    expect(logged.stack).toBeUndefined();
    expect(logged.uid).toBeUndefined();
  });

  it('omits uid when userId is not set', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = makeContext();
    logRouteError(c, new Error('oops'));

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.uid).toBeUndefined();
  });

  it('captures to Sentry when available', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const captureException = vi.fn();
    const c = makeContext({ sentry: { captureException } });
    const err = new Error('boom');
    logRouteError(c, err);

    expect(captureException).toHaveBeenCalledWith(err);
  });

  it('does not throw when sentry is unavailable', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = makeContext();
    expect(() => logRouteError(c, new Error('boom'))).not.toThrow();
  });

  it('truncates stack to 5 lines', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('deep');
    err.stack = Array.from({ length: 10 }, (_, i) => `  at fn${i} (file.ts:${i}:0)`).join('\n');
    const c = makeContext();
    logRouteError(c, err);

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.stack.split(' | ')).toHaveLength(5);
  });
});
