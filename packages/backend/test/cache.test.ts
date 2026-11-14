import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { publicCache, privateCache, noStore } from '../src/middleware/cache';

function buildApp(mw: Parameters<typeof Hono.prototype.use>[1], status = 200) {
  const app = new Hono();
  app.use('*', mw);
  app.get('/ok', (c) => c.json({ ok: true }, status as 200));
  return app;
}

function req() {
  return new Request('http://localhost/ok');
}

describe('publicCache', () => {
  it('200 응답에 Cache-Control public 설정', async () => {
    const app = buildApp(publicCache);
    const res = await app.request(req());
    expect(res.headers.get('Cache-Control')).toContain('public');
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
    expect(res.headers.get('Vary')).toBeNull();
  });
});

describe('privateCache', () => {
  it('200 응답에 Cache-Control private + Vary: Authorization', async () => {
    const app = buildApp(privateCache);
    const res = await app.request(req());
    expect(res.headers.get('Cache-Control')).toContain('private');
    expect(res.headers.get('Vary')).toBe('Authorization');
  });
});

describe('noStore', () => {
  it('200 응답에 Cache-Control no-store', async () => {
    const app = buildApp(noStore);
    const res = await app.request(req());
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('경로별 noStore 가 전역 privateCache 를 이긴다', () => {
  // index.ts 는 한도·광고 보상 현황에 noStore 를 전역 캐시보다 먼저 건다(코덱스 #959). 먼저 건 쪽이 바깥이라
  // 헤더를 마지막에 쓴다 — 순서가 뒤집히면 30초 캐시가 붙어 보상 확인이 정산 전 응답을 계속 읽는다.
  it('먼저 건 noStore 가 이긴다', async () => {
    const app = new Hono();
    app.use('/tts/manual-quota', noStore);
    app.use('*', privateCache);
    app.get('/tts/manual-quota', (c) => c.json({ ok: true }));
    app.get('/other', (c) => c.json({ ok: true }));
    const quota = await app.request(new Request('http://localhost/tts/manual-quota'));
    expect(quota.headers.get('Cache-Control')).toBe('no-store');
    const other = await app.request(new Request('http://localhost/other'));
    expect(other.headers.get('Cache-Control')).toContain('private');
  });

  it('index.ts 가 전역 캐시보다 먼저 건다', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
    const global = src.indexOf("c.req.method === 'GET' ? privateCache : noStore");
    for (const route of ["api.use('/tts/manual-quota', noStore)", "api.use('/ad-rewards/*', noStore)"]) {
      const at = src.indexOf(route);
      expect(at, route).toBeGreaterThan(-1);
      expect(at, route).toBeLessThan(global);
    }
  });
});

describe('에러 응답 시 캐시 헤더 미설정', () => {
  it('500 응답에는 Cache-Control 미설정', async () => {
    const app = new Hono();
    app.use('*', publicCache);
    app.get('/ok', (c) => c.json({ error: 'fail' }, 500));
    const res = await app.request(req());
    expect(res.headers.get('Cache-Control')).toBeNull();
  });
});
