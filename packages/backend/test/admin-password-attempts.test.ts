// 관리자 비밀번호를 맞춰 본 횟수 — IP 당 10분 10번, 폼·Basic 한 통(`docs/spec/admin-console.md`).
//
// 실제 SQLite 에 마이그레이션을 올리고 돌린다. 이 한도는 **SQL 의 의미**가 전부고, 2026-11-02 에 워커 메모리로 만든 판은 테스트를 통과하고도
// dev 에서 막지 못했다(연결마다 다른 서버로 간다). 그 회귀는 '서버가 달라도 같이 센다' 가 잡는다.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const holder: { db: Client | null } = { db: null };
vi.mock('../src/lib/db', () => ({
  getDB: () => holder.db,
}));

import adminRoutes from '../src/routes/admin';

const DB_PATH = join(tmpdir(), 'alarmtalk-admin-password-attempts.db');
for (const suffix of ['', '-shm', '-wal']) rmSync(`${DB_PATH}${suffix}`, { force: true });

const SECRET = 'admin-secret-value';
const ORIGIN = 'http://localhost';
const MAX_ATTEMPTS = 10;
const ENV = { ADMIN_SECRET: SECRET } as unknown as AppEnv['Bindings'];

function appWith(routes: typeof adminRoutes) {
  const app = new Hono<AppEnv>();
  app.route('/admin', routes);
  return app;
}
const app = appWith(adminRoutes);

const basicRequest = (ip: string, pass: string) =>
  new Request('http://localhost/admin/users', {
    headers: { Authorization: 'Basic ' + Buffer.from('x:' + pass).toString('base64'), 'cf-connecting-ip': ip },
  });
const tryBasic = (ip: string, pass: string) => app.request(basicRequest(ip, pass), undefined, ENV);
const tryForm = (ip: string, pass: string) =>
  app.request(
    'http://localhost/admin/login',
    {
      method: 'POST',
      headers: { Origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip },
      body: 'password=' + encodeURIComponent(pass),
    },
    ENV,
  );

beforeAll(async () => {
  holder.db = createClient({ url: `file:${DB_PATH}` });
  await runMigrations(holder.db);
});

describe('관리자 비밀번호 시도 횟수', () => {
  it('틀린 Basic 을 다 쓰면 맞는 비밀번호도 보지 않고 막는다', async () => {
    const ip = '203.0.113.1';
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect((await tryBasic(ip, 'wrong-pass')).status).toBe(302);
    }
    const res = await tryBasic(ip, SECRET);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
    expect((await res.json()).error_code).toBe('RATE_LIMITED');
  });

  it('틀린 폼을 다 쓰면 맞는 비밀번호도 쿠키 없이 로그인 화면으로 막는다', async () => {
    const ip = '203.0.113.2';
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect((await tryForm(ip, 'wrong-pass')).status).toBe(303);
    }
    const res = await tryForm(ip, SECRET);
    expect(res.status).toBe(429);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const html = await res.text();
    expect(html).toContain('type="password"');
    expect(html).toContain('너무 많이 틀렸어요');
  });

  it('폼과 Basic 은 같은 횟수를 나눠 쓴다', async () => {
    const ip = '203.0.113.3';
    for (let i = 0; i < MAX_ATTEMPTS / 2; i++) {
      await tryForm(ip, 'wrong-pass');
      await tryBasic(ip, 'wrong-pass');
    }
    expect((await tryForm(ip, SECRET)).status).toBe(429);
    expect((await tryBasic(ip, SECRET)).status).toBe(429);
  });

  it('서버가 달라도 같이 센다 — 워커 메모리에 세면 새 연결마다 빈 통이라 막지 못한다', async () => {
    const ip = '203.0.113.4';
    for (let i = 0; i < MAX_ATTEMPTS; i++) await tryBasic(ip, 'wrong-pass');

    // 다른 isolate 처럼 모듈을 새로 띄운다. 모듈 안의 값은 비고 DB 만 남는다.
    vi.resetModules();
    const { default: freshRoutes } = await import('../src/routes/admin');
    expect(freshRoutes).not.toBe(adminRoutes);
    const res = await appWith(freshRoutes).request(basicRequest(ip, SECRET), undefined, ENV);
    expect(res.status).toBe(429);
  });

  it('동시에 보내도 정확히 한도만큼만 맞춰 본다', async () => {
    const ip = '203.0.113.5';
    const results = await Promise.all(Array.from({ length: MAX_ATTEMPTS * 2 }, () => tryForm(ip, 'wrong-pass')));
    expect(results.filter((r) => r.status === 303)).toHaveLength(MAX_ATTEMPTS);
    expect(results.filter((r) => r.status === 429)).toHaveLength(MAX_ATTEMPTS);
  });

  it('맞는 Basic 은 쌓이지 않는다 — 스크립트가 클립 수만큼 불러도 막히지 않는다', async () => {
    const ip = '203.0.113.6';
    for (let i = 0; i < MAX_ATTEMPTS * 3; i++) {
      expect((await tryBasic(ip, SECRET)).status).toBe(200);
    }
  });

  it('맞는 비밀번호로 들어오면 틀린 횟수를 지운다', async () => {
    const ip = '203.0.113.7';
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) await tryForm(ip, 'wrong-pass');
    const ok = await tryForm(ip, SECRET);
    expect(ok.headers.get('Set-Cookie')).toContain('admin_session=');
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect((await tryForm(ip, 'wrong-pass')).status).toBe(303);
    }
    expect((await tryForm(ip, 'wrong-pass')).status).toBe(429);
  });

  it('다른 IP 는 막히지 않는다', async () => {
    const ip = '203.0.113.8';
    for (let i = 0; i < MAX_ATTEMPTS; i++) await tryBasic(ip, 'wrong-pass');
    expect((await tryForm('203.0.113.9', SECRET)).status).toBe(303);
  });

  it('10분이 지나면 다시 시도할 수 있다', async () => {
    const ip = '203.0.113.10';
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(start);
      for (let i = 0; i < MAX_ATTEMPTS; i++) await tryBasic(ip, 'wrong-pass');
      expect((await tryForm(ip, SECRET)).status).toBe(429);
      vi.setSystemTime(start + 10 * 60_000 + 1);
      expect((await tryForm(ip, SECRET)).status).toBe(303);
    } finally {
      vi.useRealTimers();
    }
  });

  it('IP 를 그대로 적지 않는다', async () => {
    await tryBasic('203.0.113.11', 'wrong-pass');
    const rows = await holder.db!.execute('SELECT key_hash FROM admin_password_attempts');
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) expect(String(row.key_hash)).not.toContain('203.0.113');
  });
});
