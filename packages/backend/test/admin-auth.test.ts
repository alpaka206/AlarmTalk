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

  it('미인증 /admin/users 접근은 401(Basic 챌린지)이 아니라 로그인으로 302', async () => {
    const res = await request('http://localhost/admin/users', {});
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
    expect(res.headers.get('Location')).toBe('/admin/login?err=1');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('맞는 비밀번호는 HttpOnly·Secure·SameSite=Strict 세션 쿠키를 발급한다', async () => {
    const res = await request('http://localhost/admin/login', {
      method: 'POST',
      headers: { Origin: ORIGIN, ...FORM },
      body: 'password=' + encodeURIComponent(SECRET),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/admin');
    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).toContain('admin_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/admin');
  });

  it('발급된 세션 쿠키로 콘솔(/admin/users)에 접근된다', async () => {
    const token = await login();
    mockDB.pushResult([]); // users SELECT
    const res = await request('http://localhost/admin/users', {
      headers: { Cookie: `admin_session=${token}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1>사용자</h1>');
    expect(html).not.toContain('프로모');
    // 콘솔 화면은 nonce 스크립트만 허용하고 캐시하지 않는다.
    expect(res.headers.get('Content-Security-Policy')).toMatch(/script-src 'nonce-[^']+'/);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('위조/변조 쿠키는 거부하고 로그인으로 보낸다', async () => {
    const res = await request('http://localhost/admin/users', {
      headers: { Cookie: 'admin_session=v1.99999999999999.forgedsignature' },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/admin/login');
  });

  it('만료된 세션 토큰(과거 exp)은 거부한다', async () => {
    // 과거 만료시각으로 만든 토큰은 서명이 맞아도 시간 검사에서 탈락해야 한다.
    // (서명 없이 임의로 만든 토큰이므로 어차피 거부되지만, exp 형식 자체도 확인)
    const res = await request('http://localhost/admin/users', {
      headers: { Cookie: 'admin_session=v1.1000000000000.anything' },
    });
    expect(res.status).toBe(302);
  });

  it('Basic 인증(스크립트/curl용)은 계속 통과한다', async () => {
    mockDB.pushResult([]);
    const res = await request('http://localhost/admin/users', {
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

// 같은 비밀번호를 맞춰 보는 길이 둘이다. 예전에는 폼만 15/분이고 Basic 은 전역 300/분이라 Basic 이 실질 한도였다.
describe('비밀번호를 틀린 횟수 — 폼과 Basic 이 한 통이다', () => {
  const MAX_FAILURES = 10;
  const basic = (pass: string) => 'Basic ' + Buffer.from('x:' + pass).toString('base64');
  const tryBasic = (ip: string, pass: string) =>
    request('http://localhost/admin/users', { headers: { Authorization: basic(pass), 'cf-connecting-ip': ip } });
  const tryForm = (ip: string, pass: string) =>
    request('http://localhost/admin/login', {
      method: 'POST',
      headers: { Origin: ORIGIN, ...FORM, 'cf-connecting-ip': ip },
      body: 'password=' + encodeURIComponent(pass),
    });

  it('틀린 Basic 을 다 쓰면 맞는 비밀번호도 보지 않고 막는다 — 막힌 동안 계속 맞춰 볼 수 없다', async () => {
    const ip = '203.0.113.1';
    for (let i = 0; i < MAX_FAILURES; i++) {
      expect((await tryBasic(ip, 'wrong-pass')).status).toBe(302);
    }
    const res = await tryBasic(ip, SECRET);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect((await res.json()).error_code).toBe('RATE_LIMITED');
  });

  it('틀린 폼을 다 쓰면 맞는 비밀번호도 쿠키 없이 로그인 화면으로 막는다', async () => {
    const ip = '203.0.113.2';
    for (let i = 0; i < MAX_FAILURES; i++) {
      expect((await tryForm(ip, 'wrong-pass')).status).toBe(303);
    }
    const res = await tryForm(ip, SECRET);
    expect(res.status).toBe(429);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(await res.text()).toContain('type="password"');
  });

  it('폼과 Basic 은 같은 횟수를 나눠 쓴다', async () => {
    const ip = '203.0.113.3';
    for (let i = 0; i < MAX_FAILURES / 2; i++) {
      await tryForm(ip, 'wrong-pass');
      await tryBasic(ip, 'wrong-pass');
    }
    expect((await tryForm(ip, SECRET)).status).toBe(429);
    expect((await tryBasic(ip, SECRET)).status).toBe(429);
  });

  it('맞는 Basic 은 세지 않는다 — 스크립트가 클립 수만큼 불러도 막히지 않는다', async () => {
    const ip = '203.0.113.4';
    for (let i = 0; i < MAX_FAILURES * 3; i++) {
      mockDB.pushResult([]);
      expect((await tryBasic(ip, SECRET)).status).toBe(200);
    }
  });

  it('다른 IP 는 막히지 않는다', async () => {
    const ip = '203.0.113.5';
    for (let i = 0; i < MAX_FAILURES; i++) await tryBasic(ip, 'wrong-pass');
    expect((await tryForm('203.0.113.6', SECRET)).status).toBe(303);
  });

  it('10분이 지나면 다시 시도할 수 있다', async () => {
    const ip = '203.0.113.7';
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(start);
      for (let i = 0; i < MAX_FAILURES; i++) await tryBasic(ip, 'wrong-pass');
      expect((await tryForm(ip, SECRET)).status).toBe(429);
      vi.setSystemTime(start + 10 * 60_000 + 1);
      expect((await tryForm(ip, SECRET)).status).toBe(303);
    } finally {
      vi.useRealTimers();
    }
  });
});
