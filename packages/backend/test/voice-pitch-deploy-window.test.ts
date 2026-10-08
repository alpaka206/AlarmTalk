// **배포 창(#128 전)** — 배포가 마이그레이션보다 먼저 돈다(CLAUDE.md 「배포 / 환경」). 높이 칸이 아직 없는 스키마에서:
//   - 높이 없는 등록 확정은 새 칸을 건드리지 않아 그대로 된다(이 기능 이전과 같다).
//   - 높이 있는 등록 확정은 트랜잭션째 롤백돼 500 이다 — 높이 없이 등록된 행을 남기지 않는다(재시도하면 된다).
//   - 교체 등록은 높이와 상관없이 칸을 쓰므로 500 이고, 아무것도 바뀌지 않는다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrationsRange } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-pitch-window-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
import voiceProfile from '../src/routes/voice-profile';

const USER = '66666666-6666-4666-8666-666666666601';
const DRAFT = '77777777-7777-4777-8777-777777777701';
const OLD = '88888888-8888-4888-8888-888888888801';

async function patch(body: Record<string, unknown>) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('userId', USER); c.set('userIdPK', USER); await next(); });
  app.route('/voice', voiceProfile);
  return app.request(`/voice/${DRAFT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, {});
}

async function row(id: string) {
  const res = await db.execute({
    sql: 'SELECT is_draft, elevenlabs_voice_id, deleted_at FROM voice_profiles WHERE id = ?',
    args: [id],
  });
  return res.rows[0]!;
}

async function succeededRegistrations(): Promise<number> {
  const res = await db.execute(
    "SELECT COUNT(*) AS n FROM voice_profile_change_ledger WHERE status = 'succeeded'",
  );
  return Number(res.rows[0]!.n);
}

beforeAll(async () => {
  await runMigrationsRange(db, 1, 127);
  const columns = await db.execute("SELECT name FROM pragma_table_info('voice_profiles')");
  expect(columns.rows.map((r) => String(r.name))).not.toContain('pitch_semitones');
});
beforeEach(async () => {
  await db.execute('DELETE FROM voice_profile_change_ledger');
  for (const table of ['user_consents', 'subscriptions', 'voice_profiles', 'users']) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute({
    sql: `INSERT INTO users (id,email,name,plan) VALUES (?,?,?,?)`,
    args: [USER, 'window@example.test', 'w', 'plus'],
  });
  await db.execute({
    sql: `INSERT INTO voice_profiles (id,user_id,name,status,is_draft,previewed_at,elevenlabs_voice_id)
          VALUES (?,?,?,?,1,datetime('now'),'el-new')`,
    args: [DRAFT, USER, '새 목소리', 'ready'],
  });
  for (const type of ['voice_biometric', 'overseas_transfer']) {
    await db.execute({
      sql: `INSERT INTO user_consents (id,user_id,consent_type,agreed,policy_version,agreed_at)
            VALUES (?,?,?,1,'5',datetime('now'))`,
      args: [`c-${type}`, USER, type],
    });
  }
  await db.execute({
    sql: `INSERT INTO subscriptions (id,user_id,plan_id,status,starts_at,expires_at)
          VALUES (?,?,?,'active',datetime('now'),datetime('now','+30 days'))`,
    args: ['sub-1', USER, '70000000-0000-4000-8000-000000000002'],
  });
});
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe('목소리 높이 — 배포 창(#128 전)', () => {
  it('높이 없는 등록 확정은 그대로 된다', async () => {
    const res = await patch({ is_draft: false });
    expect(res.status).toBe(200);
    expect(Number((await row(DRAFT)).is_draft)).toBe(0);
    expect(await succeededRegistrations()).toBe(1);
  });

  it('높이 있는 등록 확정은 롤백돼 500 이고, 초안·이번 달 등록이 그대로 남는다', async () => {
    const res = await patch({ is_draft: false, pitch_semitones: -1.5 });
    expect(res.status).toBe(500);
    expect(Number((await row(DRAFT)).is_draft)).toBe(1);
    expect(await succeededRegistrations()).toBe(0);
  });

  it('교체 등록은 500 이고 아무것도 바뀌지 않는다', async () => {
    await db.execute({
      sql: `INSERT INTO voice_profiles (id,user_id,name,status,is_draft,elevenlabs_voice_id)
            VALUES (?,?,?,?,0,'el-old')`,
      args: [OLD, USER, '옛 목소리', 'ready'],
    });
    for (const body of [
      { is_draft: false, replace_existing: true },
      { is_draft: false, replace_existing: true, pitch_semitones: -2 },
    ]) {
      const res = await patch(body);
      expect(res.status, JSON.stringify(body)).toBe(500);
      expect(String((await row(OLD)).elevenlabs_voice_id)).toBe('el-old');
      expect(Number((await row(DRAFT)).is_draft)).toBe(1);
      expect((await row(DRAFT)).deleted_at).toBeNull();
      expect(await succeededRegistrations()).toBe(0);
    }
  });
});
