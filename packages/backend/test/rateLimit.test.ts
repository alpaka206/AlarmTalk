import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  rateLimitMiddleware,
  ipRateLimitMiddleware,
  ipRateLimitRefundMiddleware,
  audioDownloadRateLimitMiddleware,
} from '../src/middleware/rateLimit';

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

  function pathReq(path: string, ip: string) {
    return new Request(`http://localhost${path}`, {
      headers: { 'cf-connecting-ip': ip },
    });
  }

  it('인증 성공한 요청은 refund 로 IP 버킷을 소모하지 않는다', async () => {
    // NAT 뒤 여러 기기의 인증 트래픽이 300/분 IP 한도를 나눠 쓰다 집단 429 를 맞던 회귀 방지 —
    // 실제 index.ts 구성처럼 전역 IP 버킷 → (인증 성공) → refund → 사용자 버킷 순으로 겹친다.
    const app = new Hono();
    app.use('*', ipRateLimitMiddleware);
    app.use('*', async (c, next) => {
      // authMiddleware 대역: 항상 인증 성공. 사용자 키를 매번 바꿔 사용자 버킷엔 안 걸리게.
      c.set('userId', `user-${Math.floor(performance.now())}-${Math.random()}`);
      await next();
    });
    app.use('*', ipRateLimitRefundMiddleware);
    app.use('*', rateLimitMiddleware);
    app.all('*', (c) => c.json({ ok: true }));

    const ip = '10.0.9.11';
    for (let i = 0; i < 301; i++) {
      const r = await app.request(pathReq('/api/alarm', ip));
      expect(r.status).toBe(200);
    }

    // 환불이 쌓여 IP 버킷은 비어 있어야 한다 — refund 없는 앱(비인증 표면)에서 같은 IP 로
    // 확인하면 신선한 300 한도에서 시작한다.
    const ipOnly = new Hono();
    ipOnly.use('*', ipRateLimitMiddleware);
    ipOnly.all('*', (c) => c.json({ ok: true }));
    const fresh = await ipOnly.request(pathReq('/api/auth/login', ip));
    expect(fresh.headers.get('X-RateLimit-Remaining')).toBe('299');
  });

  it('인증이 성공하지 못한 요청(위조 Bearer 포함)은 환불 없이 IP 버킷에 누적된다', async () => {
    // authMiddleware 가 401 로 끊으면 refund 미들웨어까지 도달하지 못한다 — 위조 Bearer 로
    // IP 한도를 우회할 수 없고, 공개 /api 라우트(presets/app-version 등)도 항상 IP 버킷 적용.
    const app = new Hono();
    app.use('*', ipRateLimitMiddleware);
    app.use('*', async (c) => c.json({ error: 'Unauthorized' }, 401)); // authMiddleware 실패 대역
    const ip = '10.0.9.12';
    for (let i = 0; i < 300; i++) {
      const r = await app.request(
        new Request('http://localhost/api/alarm', {
          headers: { 'cf-connecting-ip': ip, authorization: 'Bearer junk' },
        }),
      );
      expect(r.status).toBe(401);
    }
    const over = await app.request(
      new Request('http://localhost/api/alarm', {
        headers: { 'cf-connecting-ip': ip, authorization: 'Bearer junk' },
      }),
    );
    expect(over.status).toBe(429);
  });

  it('refund 는 카운트를 0 아래로 내리지 않는다', async () => {
    // 윈도 경계에서 카운트 전에 환불이 실행돼도(엔트리 없음/0) 음수로 내려가 한도가
    // 부풀지 않아야 한다.
    const app = new Hono();
    app.use('*', ipRateLimitRefundMiddleware);
    app.use('*', ipRateLimitMiddleware);
    app.all('*', (c) => c.json({ ok: true }));
    const ip = '10.0.9.13';
    const r1 = await app.request(pathReq('/x', ip));
    // 환불(무시됨) 후 카운트 1 → Remaining 299. 음수였다면 300 이상으로 표시된다.
    expect(r1.headers.get('X-RateLimit-Remaining')).toBe('299');
  });
});


// ── 오디오 내려받기는 일반 버킷을 쓰지 않는다 ─────────────────────────────────
//
// 기본 목소리 선다운로드가 한 번에 76개를 받고, 목소리를 등록하면 그 클론 클립까지
// 이어 받는다. 그 내려받기가 일반 버킷(120/분)을 먹으면 **같은 창의 등록·동기화 요청이**
// 429 를 맞는다 — 실기기에서 "요청이 너무 많아요" 로 드러난 자리다(2026-09-17).
function buildAudioApp() {
  const app = new Hono();
  app.use('/api/tts/messages/:id/audio', audioDownloadRateLimitMiddleware);
  app.use('*', rateLimitMiddleware);
  app.get('/api/tts/messages/:id/audio', (c) => c.json({ ok: true }));
  app.get('/api/alarm', (c) => c.json({ ok: true }));
  return app;
}

function audioReq(ip: string, id = 'm1') {
  return new Request(`http://localhost/api/tts/messages/${id}/audio`, {
    headers: { 'cf-connecting-ip': ip },
  });
}

describe('오디오 내려받기 버킷', () => {
  it('내려받기 200개를 받아도 다른 요청의 일반 한도는 그대로다', async () => {
    const app = buildAudioApp();
    const ip = '10.0.9.1';
    for (let i = 0; i < 200; i++) {
      const res = await app.request(audioReq(ip, `m${i}`));
      expect(res.status).toBe(200);
    }
    // 일반 버킷은 한 번도 안 셌으므로 첫 요청의 남은 수가 119 여야 한다.
    const other = await app.request(
      new Request('http://localhost/api/alarm', { headers: { 'cf-connecting-ip': ip } }),
    );
    expect(other.status).toBe(200);
    expect(other.headers.get('X-RateLimit-Remaining')).toBe('119');
  });

  it('내려받기도 자기 버킷(600/분)을 넘으면 429', async () => {
    const app = buildAudioApp();
    const ip = '10.0.9.2';
    for (let i = 0; i < 600; i++) {
      expect((await app.request(audioReq(ip, `m${i}`))).status).toBe(200);
    }
    const res = await app.request(audioReq(ip, 'm600'));
    expect(res.status).toBe(429);
    expect((await res.json()).error_code).toBe('RATE_LIMITED');
  });

  it('POST 는 내려받기가 아니다 — 일반 버킷이 센다', async () => {
    const app = new Hono();
    app.use('*', rateLimitMiddleware);
    app.post('/api/tts/messages/:id/audio', (c) => c.json({ ok: true }));
    const res = await app.request(
      new Request('http://localhost/api/tts/messages/m1/audio', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '10.0.9.3' },
      }),
    );
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('119');
  });
});
