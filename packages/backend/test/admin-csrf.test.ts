import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import adminRoutes from '../src/routes/admin';

const SECRET = 'admin-secret';
const AUTH = 'Basic ' + Buffer.from('x:' + SECRET).toString('base64');
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

function request(path: string, init: RequestInit) {
  const app = new Hono<AppEnv>();
  app.route('/admin', adminRoutes);
  return app.request(path, init, { ADMIN_SECRET: SECRET } as unknown as AppEnv['Bindings']);
}

beforeEach(() => {
  mockDB.reset();
});

// Basic 인증 콘솔은 브라우저가 자격증명을 자동 첨부하므로, cross-site 폼 POST 로 관리자 몰래
// 상태를 바꾸는 CSRF 가 가능하다. 상태 변경 POST 는 Origin(없으면 Referer)이 콘솔 호스트와
// 일치할 때만 허용해야 한다.
// 상태를 바꾸는 POST 는 이제 로그인·로그아웃뿐이다(프로모 코드 발급·켜기는 2026-10-12 에 없앴다).
describe('admin console CSRF defense', () => {
  it('rejects cross-site POST /admin/logout (Origin mismatch) with 403', async () => {
    const res = await request('http://localhost/admin/logout', {
      method: 'POST',
      headers: { Authorization: AUTH, Origin: 'https://evil.example', ...FORM },
      body: '',
    });
    expect(res.status).toBe(403);
  });

  it('rejects POST with no Origin/Referer with 403', async () => {
    const res = await request('http://localhost/admin/logout', {
      method: 'POST',
      headers: { Authorization: AUTH, ...FORM },
      body: '',
    });
    expect(res.status).toBe(403);
  });

  it('allows same-origin POST (Origin matches host) — passes CSRF, not 403', async () => {
    const res = await request('http://localhost/admin/logout', {
      method: 'POST',
      headers: { Authorization: AUTH, Origin: 'http://localhost', ...FORM },
      body: '',
    });
    expect(res.status).not.toBe(403);
  });
});
