import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { securityHeadersMiddleware } from './securityHeaders';

function createApp() {
  const app = new Hono();
  app.use('*', securityHeadersMiddleware);
  app.get('/test', (c) => c.json({ ok: true }));
  app.post('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('securityHeadersMiddleware', () => {
  it('sets X-Content-Type-Options to nosniff', async () => {
    const res = await createApp().request('/test');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sets X-Frame-Options to DENY', async () => {
    const res = await createApp().request('/test');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('sets Referrer-Policy', async () => {
    const res = await createApp().request('/test');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets X-DNS-Prefetch-Control to off', async () => {
    const res = await createApp().request('/test');
    expect(res.headers.get('x-dns-prefetch-control')).toBe('off');
  });

  it('sets X-Download-Options to noopen', async () => {
    const res = await createApp().request('/test');
    expect(res.headers.get('x-download-options')).toBe('noopen');
  });

  it('sets X-Permitted-Cross-Domain-Policies to none', async () => {
    const res = await createApp().request('/test');
    expect(res.headers.get('x-permitted-cross-domain-policies')).toBe('none');
  });

  it('sets Permissions-Policy to deny camera/mic/geo', async () => {
    const res = await createApp().request('/test');
    expect(res.headers.get('permissions-policy')).toBe(
      'camera=(), microphone=(), geolocation=()',
    );
  });

  it('sets Strict-Transport-Security with 2-year max-age', async () => {
    const res = await createApp().request('/test');
    const hsts = res.headers.get('strict-transport-security');
    expect(hsts).toContain('max-age=63072000');
    expect(hsts).toContain('includeSubDomains');
  });

  it('sets Content-Security-Policy to deny all', async () => {
    const res = await createApp().request('/test');
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('applies headers to POST responses', async () => {
    const res = await createApp().request('/test', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('preserves original response status and body', async () => {
    const res = await createApp().request('/test');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
  });

  it('applies all 9 security headers simultaneously', async () => {
    const res = await createApp().request('/test');
    const securityHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'referrer-policy',
      'x-dns-prefetch-control',
      'x-download-options',
      'x-permitted-cross-domain-policies',
      'permissions-policy',
      'strict-transport-security',
      'content-security-policy',
    ];
    for (const header of securityHeaders) {
      expect(res.headers.has(header)).toBe(true);
    }
  });
});
