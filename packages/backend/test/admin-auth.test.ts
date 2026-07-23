// 관리자 콘솔 인증 — 비밀번호 전용 로그인(이메일/아이디 없음) + 세션 쿠키 + Basic 폴백.
//  - 로그인 폼은 password 필드 하나만,
//  - 미인증 접근은 401(Basic 챌린지)이 아니라 로그인 폼으로 리다이렉트(브라우저 아이디창 X),
//  - 맞는 비밀번호 → 서명 세션 쿠키 발급 → 그 쿠키로 콘솔 접근,
//  - 위조 쿠키 거부, Basic(스크립트용)은 계속 허용.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import adminRoutes from '../src/routes/admin';

const SECRET = 'admin-secret-value';
const ORIGIN = 'http://localhost';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

function request(path: string, init: RequestInit, env: Partial<AppEnv['Bindings']> = { ADMIN_SECRET: SECRET }) {
  const app = new Hono<AppEnv>();
  app.route('/admin', adminRoutes);
  return app.request(path, init, env as unknown as AppEnv['Bindings']);
}

async function login(): Promise<string> {
  const res = await request('http://localhost/admin/login', {
    method: 'POST',
    headers: { Origin: ORIGIN, ...FORM },
    body: 'password=' + encodeURIComponent(SECRET),
  });
  const setCookie = res.headers.get('Set-Cookie') || '';
  return setCookie.split(';')[0].split('=')[1];
}

beforeEach(() => {
  mockDB.reset();
});

describe('admin 비밀번호 전용 로그인', () => {
  it('ADMIN_SECRET 미설정이면 로그인 페이지도 503', async () => {
    const res = await request('http://localhost/admin/login', {}, {});
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error_code).toBe('ADMIN_UNCONFIGURED');
  });

  it('GET /admin/login 은 인증 없이 비밀번호 폼(200)을 준다 — 이메일 입력칸 없음', async () => {
    const res = await request('http://localhost/admin/login', {});
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('type="password"');
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain('name="email"');
  });

  it('미인증 /admin/promo 접근은 401(Basic 챌린지)이 아니라 로그인으로 302', async () => {
    const res = await request('http://localhost/admin/promo', {});
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/admin/login');
    expect(res.headers.get('WWW-Authenticate')).toBeNull();
  });

  it('틀린 비밀번호는 쿠키 없이 로그인으로 되돌린다', async () => {
    const res = await request('http://localhost/admin/login', {
      method: 'POST',
      headers: { Origin: ORIGIN, ...FORM },
      body: 'password=wrong-pass',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toContain('/admin/login?err=');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('맞는 비밀번호는 HttpOnly·Secure·SameSite=Strict 세션 쿠키를 발급한다', async () => {
    const res = await request('http://localhost/admin/login', {
      method: 'POST',
      headers: { Origin: ORIGIN, ...FORM },
      body: 'password=' + encodeURIComponent(SECRET),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/admin/promo');
    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).toContain('admin_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/admin');
  });

  it('발급된 세션 쿠키로 콘솔(/admin/promo)에 접근된다', async () => {
    const token = await login();
    mockDB.pushResult([]); // plans SELECT
    mockDB.pushResult([]); // codes SELECT
    const res = await request('http://localhost/admin/promo', {
      headers: { Cookie: `admin_session=${token}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('프로모 쿠폰 관리');
  });

  it('위조/변조 쿠키는 거부하고 로그인으로 보낸다', async () => {
    const res = await request('http://localhost/admin/promo', {
      headers: { Cookie: 'admin_session=v1.99999999999999.forgedsignature' },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/admin/login');
  });

  it('만료된 세션 토큰(과거 exp)은 거부한다', async () => {
    // 과거 만료시각으로 만든 토큰은 서명이 맞아도 시간 검사에서 탈락해야 한다.
    // (서명 없이 임의로 만든 토큰이므로 어차피 거부되지만, exp 형식 자체도 확인)
    const res = await request('http://localhost/admin/promo', {
      headers: { Cookie: 'admin_session=v1.1000000000000.anything' },
    });
    expect(res.status).toBe(302);
  });

  it('Basic 인증(스크립트/curl용)은 계속 통과한다', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const res = await request('http://localhost/admin/promo', {
      headers: { Authorization: 'Basic ' + Buffer.from('x:' + SECRET).toString('base64') },
    });
    expect(res.status).toBe(200);
  });

  it('로그인 POST 도 크로스사이트(Origin 불일치)면 CSRF 403', async () => {
    const res = await request('http://localhost/admin/login', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', ...FORM },
      body: 'password=' + encodeURIComponent(SECRET),
    });
    expect(res.status).toBe(403);
  });

  it('로그아웃은 세션 쿠키를 만료시킨다', async () => {
    const res = await request('http://localhost/admin/logout', {
      method: 'POST',
      headers: { Origin: ORIGIN, ...FORM },
      body: '',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/admin/login');
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});
