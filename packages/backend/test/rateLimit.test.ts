import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { rateLimitMiddleware } from '../src/middleware/rateLimit';

function buildApp() {
  const app = new Hono();
  app.use('*', rateLimitMiddleware);
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

// 비인증 요청의 키는 위조 불가능한 cf-connecting-ip 로만 정한다(x-forwarded-for 무시).
function makeReq(ip = '1.2.3.4') {
  return new Request('http://localhost/test', {
    headers: { 'cf-connecting-ip': ip },
  });
}

describe('rateLimitMiddleware', () => {
  it('정상 요청은 200 + 헤더 포함', async () => {
    const app = buildApp();
    const res = await app.request(makeReq('10.0.0.1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(res.headers.has('X-RateLimit-Remaining')).toBe(true);
    expect(res.headers.has('X-RateLimit-Reset')).toBe(true);
  });

  it('61번째 요청은 429', async () => {
    const app = buildApp();
    const ip = '10.0.0.2';
    for (let i = 0; i < 60; i++) {
      const res = await app.request(makeReq(ip));
      expect(res.status).toBe(200);
    }
    const res61 = await app.request(makeReq(ip));
    expect(res61.status).toBe(429);
    const body = await res61.json();
    expect(body.error).toContain('Too many');
    expect(res61.headers.has('Retry-After')).toBe(true);
  });

  it('다른 IP는 독립 카운트', async () => {
    const app = buildApp();
    for (let i = 0; i < 60; i++) {
      await app.request(makeReq('10.0.0.3'));
    }
    const res429 = await app.request(makeReq('10.0.0.3'));
    expect(res429.status).toBe(429);

    const resOther = await app.request(makeReq('10.0.0.4'));
    expect(resOther.status).toBe(200);
  });

  it('Remaining 헤더가 감소', async () => {
    const app = buildApp();
    const ip = '10.0.0.5';
    const res1 = await app.request(makeReq(ip));
    const rem1 = Number(res1.headers.get('X-RateLimit-Remaining'));

    const res2 = await app.request(makeReq(ip));
    const rem2 = Number(res2.headers.get('X-RateLimit-Remaining'));

    expect(rem2).toBe(rem1 - 1);
  });

  it('인증된 요청은 userId 를 키로 사용한다', async () => {
    const app = new Hono();
    const uid = `user-${Math.floor(performance.now())}-a`;
    app.use('*', async (c, next) => {
      c.set('userId', uid);
      await next();
    });
    app.use('*', rateLimitMiddleware);
    app.get('/test', (c) => c.json({ ok: true }));

    for (let i = 0; i < 60; i++) {
      await app.request('http://localhost/test');
    }
    const res = await app.request('http://localhost/test');
    expect(res.status).toBe(429);
  });

  it('위조 가능한 x-forwarded-for 는 키로 쓰지 않는다', async () => {
    // x-forwarded-for 만 바꿔도 같은 unknown 버킷을 공유 → 헤더 위조로 한도 우회 불가.
    const app = buildApp();
    for (let i = 0; i < 60; i++) {
      await app.request(
        new Request('http://localhost/test', {
          headers: { 'x-forwarded-for': `7.7.7.${i}` },
        }),
      );
    }
    const res = await app.request(
      new Request('http://localhost/test', {
        headers: { 'x-forwarded-for': '9.9.9.9' },
      }),
    );
    expect(res.status).toBe(429);
  });
});
