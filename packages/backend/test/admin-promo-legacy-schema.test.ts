// admin /promo 가 redemption_group(#72) 컬럼이 없는 레거시 스키마(배포→마이그레이션 창)에서도
// 500 없이 동작하는지 — #71까지만 적용한 실제 libsql 파일 DB 를 getDB 로 주입해 검증한다.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppEnv } from '../src/types';
import { runMigrationsRange } from '../src/lib/migrations';

const DB_PATH = join(tmpdir(), 'alarmtalk-admin-promo-legacy.db');
rmSync(DB_PATH, { force: true });
const db: Client = createClient({ url: `file:${DB_PATH}` });

vi.mock('../src/lib/db', () => ({ getDB: () => db }));
const { default: adminRoutes } = await import('../src/routes/admin');

const SECRET = 'admin-secret';
const AUTH = 'Basic ' + Buffer.from('x:' + SECRET).toString('base64');
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

function request(path: string, init: RequestInit) {
  const app = new Hono<AppEnv>();
  app.route('/admin', adminRoutes);
  return app.request(path, init, { ADMIN_SECRET: SECRET } as unknown as AppEnv['Bindings']);
}

beforeAll(async () => {
  await runMigrationsRange(db, 1, 71); // redemption_group(#72) 없는 스키마
  await db.execute(
    `INSERT INTO promo_codes (id, code, plan_id, duration_days, is_active)
     SELECT 'legacy-admin-code', 'LEGACY_ADMIN_CODE', id, 7, 1 FROM plans WHERE key = 'personal'`,
  );
});

describe('admin /promo — #72 적용 전 스키마 호환', () => {
  it('목록(GET)이 레거시 폴백으로 200 렌더된다', async () => {
    const res = await request('http://localhost/admin/promo', {
      method: 'GET',
      headers: { Authorization: AUTH },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('LEGACY_ADMIN_CODE');
  });

  // 프로모 코드는 2026-10-12 에 없앴다(App Store 3.1.1) — 콘솔은 이력만 보여 주고 발급·켜기가 없다.
  it('발급(POST)·켜기(toggle)는 없다 — 404 이고 행이 생기거나 바뀌지 않는다', async () => {
    const issue = await request('http://localhost/admin/promo', {
      method: 'POST',
      headers: { Authorization: AUTH, Origin: 'http://localhost', ...FORM },
      body: 'code=NEW_PROMO&plan_key=personal&duration_days=30',
    });
    expect(issue.status).toBe(404);
    const created = await db.execute(`SELECT 1 FROM promo_codes WHERE code = 'NEW_PROMO'`);
    expect(created.rows.length).toBe(0);

    await db.execute(`UPDATE promo_codes SET is_active = 0 WHERE id = 'legacy-admin-code'`);
    const toggle = await request('http://localhost/admin/promo/legacy-admin-code/toggle', {
      method: 'POST',
      headers: { Authorization: AUTH, Origin: 'http://localhost', ...FORM },
      body: '',
    });
    expect(toggle.status).toBe(404);
    const row = await db.execute(`SELECT is_active FROM promo_codes WHERE id = 'legacy-admin-code'`);
    expect(Number(row.rows[0]?.is_active)).toBe(0);
  });

  it('목록 화면에 발급 폼·켜기 버튼이 없다', async () => {
    const res = await request('http://localhost/admin/promo', {
      method: 'GET',
      headers: { Authorization: AUTH },
    });
    const html = await res.text();
    expect(html).not.toContain('action="/admin/promo"');
    expect(html).not.toContain('/toggle');
  });
});
