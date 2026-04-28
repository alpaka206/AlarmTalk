import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const ALLOWED_ORIGINS = [
  'http://localhost:8081',
  'exp://localhost:8081',
];

function createApp() {
  const app = new Hono();
  app.use(
    '*',
    cors({
      origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    }),
  );
  app.get('/test', (c) => c.json({ ok: true }));
  app.post('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('CORS configuration', () => {
  it('returns correct headers for allowed origin', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      method: 'GET',
      headers: { Origin: 'http://localhost:8081' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8081');
  });

  it('returns correct headers for expo origin', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      method: 'GET',
      headers: { Origin: 'exp://localhost:8081' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('exp://localhost:8081');
  });

  it('falls back to first allowed origin for unknown origin', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      method: 'GET',
      headers: { Origin: 'https://evil.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8081');
  });

  it('handles preflight OPTIONS with allowed methods', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:8081',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization',
      },
    });
    expect(res.status).toBe(204);
    const allow = res.headers.get('Access-Control-Allow-Methods');
    expect(allow).toContain('POST');
    expect(allow).toContain('DELETE');
    expect(allow).toContain('PATCH');
  });

  it('includes Authorization in allowed headers', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:8081',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    const headers = res.headers.get('Access-Control-Allow-Headers');
    expect(headers).toContain('Authorization');
    expect(headers).toContain('Content-Type');
  });

  it('sets max-age to 86400', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:8081',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });
});
