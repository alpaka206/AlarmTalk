import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { rateLimitMiddleware, ipRateLimitMiddleware } from '../src/middleware/rateLimit';

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

describe('rateLimitMiddleware (사용자/기본 버킷 120req/분)', () => {
  it('정상 요청은 200 + 헤더 포함', async () => {
    const app = buildApp();
    const res = await app.request(makeReq('10.0.0.1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('120');
    expect(res.headers.has('X-RateLimit-Remaining')).toBe(true);
    expect(res.headers.has('X-RateLimit-Reset')).toBe(true);
  });

  it('121번째 요청은 429', async () => {
    const app = buildApp();
    const ip = '10.0.0.2';
    for (let i = 0; i < 120; i++) {
      const res = await app.request(makeReq(ip));
      expect(res.status).toBe(200);
    }
    const res121 = await app.request(makeReq(ip));
    expect(res121.status).toBe(429);
    const body = await res121.json();
    expect(body.error).toContain('Too many');
    expect(res121.headers.has('Retry-After')).toBe(true);
  });

  it('다른 IP는 독립 카운트', async () => {
    const app = buildApp();
    for (let i = 0; i < 120; i++) {
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

    for (let i = 0; i < 120; i++) {
      await app.request('http://localhost/test');
    }
    const res = await app.request('http://localhost/test');
    expect(res.status).toBe(429);
  });

  it('위조 가능한 x-forwarded-for 는 키로 쓰지 않는다', async () => {
    // x-forwarded-for 만 바꿔도 같은 unknown 버킷을 공유 → 헤더 위조로 한도 우회 불가.
    const app = buildApp();
    for (let i = 0; i < 120; i++) {
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

describe('ipRateLimitMiddleware (인증 전 전역 IP 버킷 300req/분)', () => {
  it('한도가 300이고 prefix 버킷이라 기본 버킷과 이중 카운트되지 않는다', async () => {
    // 전역(인증 전 IP)·api(사용자) 리미터를 실제 index.ts 처럼 겹쳐 걸었을 때, 같은 요청이
    // 두 버킷에 각각 카운트돼 실효 한도가 반토막 나던 회귀를 방지한다 — 각 버킷의 Remaining
    // 이 독립적으로 줄어야 한다.
    const app = new Hono();
    app.use('*', ipRateLimitMiddleware);
    app.use('*', async (c, next) => {
      c.set('userId', `user-${Math.floor(performance.now())}-b`);
      await next();
    });
    app.use('*', rateLimitMiddleware);
    app.get('/test', (c) => c.json({ ok: true }));

    const ip = '10.0.9.9';
    const res = await app.request(makeReq(ip));
    expect(res.status).toBe(200);
    // 마지막 미들웨어(사용자 버킷)의 헤더가 남는다 — 120 한도에서 1개 소비.
    expect(res.headers.get('X-RateLimit-Limit')).toBe('120');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('119');

    // 전역 IP 버킷 단독 한도는 300 — 121번째 요청도 아직 통과해야 한다(사용자 키가 매번
    // 달라 사용자 버킷에는 안 걸리는 구성으로 확인).
    const ipOnly = new Hono();
    ipOnly.use('*', ipRateLimitMiddleware);
    ipOnly.get('/test', (c) => c.json({ ok: true }));
    const ip2 = '10.0.9.10';
    for (let i = 0; i < 300; i++) {
      const r = await ipOnly.request(makeReq(ip2));
      expect(r.status).toBe(200);
    }
    const over = await ipOnly.request(makeReq(ip2));
    expect(over.status).toBe(429);
  });

  function buildIpOnlyApp() {
    const app = new Hono();
    app.use('*', ipRateLimitMiddleware);
    app.all('*', (c) => c.json({ ok: true }));
    return app;
  }

  function pathReq(path: string, ip: string, bearer = false) {
    return new Request(`http://localhost${path}`, {
      headers: {
        'cf-connecting-ip': ip,
        ...(bearer ? { authorization: 'Bearer some-token' } : {}),
      },
    });
  }

  it('Bearer 를 든 인증 대상 /api/* 요청은 IP 버킷을 소모하지 않는다', async () => {
    // NAT 뒤 여러 기기의 인증 트래픽이 300/분 IP 한도를 나눠 쓰다 집단 429 를 맞던 회귀 방지 —
    // 이 요청들은 authMiddleware 뒤 사용자 버킷(120/분)이 담당한다.
    const app = buildIpOnlyApp();
    const ip = '10.0.9.11';
    for (let i = 0; i < 301; i++) {
      const r = await app.request(pathReq('/api/alarm', ip, true));
      expect(r.status).toBe(200);
    }
    // 같은 IP 의 비인증 표면은 여전히 신선한 300 한도에서 시작해야 한다(위에서 소모 0).
    const fresh = await app.request(pathReq('/api/auth/login', ip));
    expect(fresh.headers.get('X-RateLimit-Remaining')).toBe('299');
  });

  it('Bearer 없는 /api/* 요청은 여전히 IP 버킷으로 제한된다', async () => {
    const app = buildIpOnlyApp();
    const ip = '10.0.9.12';
    for (let i = 0; i < 300; i++) {
      await app.request(pathReq('/api/alarm', ip));
    }
    const over = await app.request(pathReq('/api/alarm', ip));
    expect(over.status).toBe(429);
  });

  it('인증 전 표면(/api/auth 등)은 Bearer 가 있어도 IP 버킷으로 제한된다', async () => {
    // 사용자 버킷의 보호를 받지 못하는 경로 — Bearer 만 붙여 무차별 대입 한도를 우회하지 못하게.
    const app = buildIpOnlyApp();
    const ip = '10.0.9.13';
    for (let i = 0; i < 300; i++) {
      await app.request(pathReq('/api/auth/login', ip, true));
    }
    const over = await app.request(pathReq('/api/auth/login', ip, true));
    expect(over.status).toBe(429);
  });
});
