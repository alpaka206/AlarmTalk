import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import { runMigrations } from '../src/lib/migrations';

// 실제 libSQL(인메모리) + 실제 라우트로 수신자 '그만받기'(decline)를 end-to-end 검증한다.
// 감사 A-1/A-2/A-3: 로컬 삭제는 부활하지만, 서버 decline 은 비파괴적으로 수신자에게만 배달을
// 영구 차단해야 한다(생성자 알람은 보존, 재조회에도 되살아나지 않음).

let testDb: Client;
vi.mock('../src/lib/db', () => ({ getDB: () => testDb }));

const { default: alarmMutation } = await import('../src/routes/alarm-mutation');
const { default: alarmQuery } = await import('../src/routes/alarm-query');

function appFor(userId: string) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('userIdPK', userId);
    await next();
  });
  app.route('/', alarmQuery);
  app.route('/', alarmMutation);
  return app;
}

const ALARM_ID = '11111111-1111-1111-1111-111111111111';

async function seed() {
  const db = createClient({ url: ':memory:' });
  await runMigrations(db);
  await db.execute({ sql: `INSERT INTO users (id, google_id, email) VALUES ('A','gA','a@x.com')`, args: [] });
  await db.execute({ sql: `INSERT INTO users (id, google_id, email) VALUES ('B','gB','b@x.com')`, args: [] });
  await db.execute({ sql: `INSERT INTO voice_profiles (id, user_id, name) VALUES ('vp-A','A','v')`, args: [] });
  await db.execute({
    sql: `INSERT INTO messages (id, user_id, voice_profile_id, text) VALUES ('m1','A','vp-A','wake up')`,
    args: [],
  });
  // A 가 B 를 대상으로 만든 가족 반복 알람
  await db.execute({
    sql: `INSERT INTO alarms (id, user_id, target_user_id, message_id, voice_profile_id, time, mode, is_active)
          VALUES (?, 'A', 'B', 'm1', 'vp-A', '07:00', 'tts', 1)`,
    args: [ALARM_ID],
  });
  return db;
}

describe('가족 알람 수신자 그만받기(decline)', () => {
  beforeEach(async () => {
    testDb = await seed();
  });

  async function listIds(userId: string): Promise<string[]> {
    const res = await appFor(userId).request('/');
    const body = (await res.json()) as { alarms: Array<{ id: string }> };
    return body.alarms.map((a) => a.id);
  }
  it('decline 전에는 수신자 B 에게 알람이 보이고, decline 후에는 목록에서 사라진다', async () => {
    expect(await listIds('B')).toContain(ALARM_ID);

    const dec = await appFor('B').request('/' + ALARM_ID + '/decline', { method: 'POST' });
    expect(dec.status).toBe(200);

    expect(await listIds('B')).not.toContain(ALARM_ID);
  });

  it('decline 은 비파괴적: 생성자 A 는 계속 보이고 알람 행/is_active 는 유지된다', async () => {
    await appFor('B').request('/' + ALARM_ID + '/decline', { method: 'POST' });

    expect(await listIds('A')).toContain(ALARM_ID);
    const row = await testDb.execute({ sql: `SELECT is_active FROM alarms WHERE id = ?`, args: [ALARM_ID] });
    expect(row.rows.length).toBe(1);
    expect(Number(row.rows[0]!.is_active)).toBe(1);
  });

  it('decline 은 재조회에도 지속된다(부활하지 않음)', async () => {
    await appFor('B').request('/' + ALARM_ID + '/decline', { method: 'POST' });
    // 여러 번 다시 조회해도 계속 제외
    expect(await listIds('B')).not.toContain(ALARM_ID);
  });

it('대상이 아닌 사용자(생성자 A)는 decline 할 수 없다(404)', async () => {
    const res = await appFor('A').request('/' + ALARM_ID + '/decline', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
