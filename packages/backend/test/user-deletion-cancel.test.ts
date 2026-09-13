import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-deletion-cancel-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
import user from '../src/routes/user';

function cancel(userId = 'owner') {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    await next();
  });
  app.route('/user', user);
  return app.request('/user/me/deletion', { method: 'DELETE' });
}

async function state() {
  return (
    await db.execute(`SELECT id,deletion_status,deletion_requested_at,deletion_purge_at,updated_at
    FROM users WHERE id IN ('owner','other') ORDER BY id`)
  ).rows;
}

beforeAll(async () => {
  await runMigrations(db);
});
beforeEach(async () => {
  await db.execute("DELETE FROM users WHERE id IN ('owner','other')");
  await db.execute(`INSERT INTO users
    (id,google_id,email,deletion_status,deletion_requested_at,deletion_purge_at,updated_at)
    VALUES ('owner','owner-login','owner@example.test','pending_deletion','2026-09-01','2026-10-01','2026-09-01'),
           ('other','other-login','other@example.test','pending_deletion','2026-09-01','2026-10-01','2026-09-01')`);
});
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('#735 탈퇴 취소 응답 유실 후 재시도', () => {
  it('첫 성공 응답을 못 받아도 재시도는 무변경 성공이고 다른 계정은 건드리지 않는다', async () => {
    const original = await state();
    // 첫 호출은 서버에 도착했지만 클라는 응답을 확인하지 못했다고 가정한다.
    await cancel();
    const recovered = await state();
    expect(recovered.find((row) => row.id === 'owner')).toMatchObject({
      deletion_status: 'active',
      deletion_requested_at: null,
      deletion_purge_at: null,
    });
    expect(recovered.find((row) => row.id === 'other')).toEqual(
      original.find((row) => row.id === 'other'),
    );
    // 같은 초의 updated_at만 비교하면 재쓰기를 놓친다. active 행을 다시 쓰면 실패시킨다.
    await db.execute(`CREATE TRIGGER reject_active_rewrite BEFORE UPDATE ON users
      WHEN OLD.deletion_status='active' BEGIN SELECT RAISE(ABORT,'active rewrite'); END`);
    try {
      const retry = await cancel();
      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual({ success: true, status: 'active' });
      expect(await state()).toEqual(recovered);
    } finally {
      await db.execute('DROP TRIGGER reject_active_rewrite');
    }
  });

  it('이미 active인 계정도 재신청 없이 성공으로 수렴한다', async () => {
    await db.execute(`UPDATE users SET deletion_status='active',deletion_requested_at=NULL,
      deletion_purge_at=NULL WHERE id='owner'`);
    const before = await state();
    const response = await cancel();
    expect(response.status).toBe(200);
    expect(await state()).toEqual(before);
  });

  it('없는 계정은 성공으로 꾸미거나 다른 계정을 복구하지 않는다', async () => {
    const before = await state();
    const response = await cancel('missing');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error_code: 'NO_PENDING_DELETION' });
    expect(await state()).toEqual(before);
  });

  it('복구 UPDATE 실패는 pending 상태를 유지하고 재시도할 500을 반환한다', async () => {
    const before = await state();
    await db.execute(`CREATE TRIGGER reject_deletion_cancel BEFORE UPDATE ON users
      WHEN OLD.id='owner' BEGIN SELECT RAISE(ABORT,'cancel failed'); END`);
    try {
      const response = await cancel();
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error_code: 'DELETION_CANCEL_FAILED' });
      expect(await state()).toEqual(before);
    } finally {
      await db.execute('DROP TRIGGER reject_deletion_cancel');
    }
    expect((await cancel()).status).toBe(200);
  });

  it('레거시 로그인 식별자의 복구 재시도도 기존 계약을 유지한다', async () => {
    expect((await cancel('owner-login')).status).toBe(200);
    expect((await cancel('owner-login')).status).toBe(200);
    expect((await state()).find((row) => row.id === 'owner')!.deletion_status).toBe('active');
  });
});
