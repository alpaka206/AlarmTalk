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
const { purgeUserAccount } = await import('../src/lib/account-deletion');

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
const FAMILY_PLAN_ID = '70000000-0000-4000-8000-000000000003'; // 마이그레이션 시드 '가족' 플랜

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

describe('발신자 탈퇴 = 목소리 철회(revoked)', () => {
  beforeEach(async () => {
    testDb = await seed();
  });

  async function recipientState(userId: string) {
    const res = await appFor(userId).request('/declined');
    return (await res.json()) as { alarm_ids: string[]; revoked_alarm_ids: string[]; has_more?: boolean };
  }

  it('A 가 탈퇴하면 수신자 B 에게 revoked 로 기록된다 — 그만받기(declined)와 섞이지 않는다', async () => {
    // 탈퇴 전에는 아무 기록도 없다.
    const before = await recipientState('B');
    expect(before.alarm_ids).toEqual([]);
    expect(before.revoked_alarm_ids).toEqual([]);

    await purgeUserAccount(testDb, 'A', 'gA');

    const after = await recipientState('B');
    // 알람 행 자체는 사라졌지만, 수신자 기기가 목소리를 걷어낼 수 있게 기록은 남는다.
    // 이게 없으면 탈퇴한 사람의 복제 목소리가 B 의 기기에서 계속 울린다.
    expect(after.revoked_alarm_ids).toContain(ALARM_ID);
    expect(after.alarm_ids).not.toContain(ALARM_ID);
    const gone = await testDb.execute({ sql: `SELECT id FROM alarms WHERE id = ?`, args: [ALARM_ID] });
    expect(gone.rows.length).toBe(0);
  });

  it('B 가 이미 그만받기 한 알람은 탈퇴 뒤에도 declined 로 남는다(지우는 쪽이 우선)', async () => {
    await appFor('B').request('/' + ALARM_ID + '/decline', { method: 'POST' });
    await purgeUserAccount(testDb, 'A', 'gA');

    const state = await recipientState('B');
    // 수신자가 직접 뺀 알람은 '목소리만 걷어내기' 가 아니라 그대로 지워져야 한다.
    expect(state.alarm_ids).toContain(ALARM_ID);
    expect(state.revoked_alarm_ids).not.toContain(ALARM_ID);
  });

  it('탈퇴한 본인이 받은 알람 기록은 남기지 않는다(자기 PII 는 파기 대상)', async () => {
    // B 가 A 에게 보낸 알람을 하나 더 만든다 — A 가 탈퇴하면 이 행은 A 가 '받은' 것이다.
    await testDb.execute({
      sql: `INSERT INTO alarms (id, user_id, target_user_id, message_id, time, mode, is_active)
            VALUES ('22222222-2222-2222-2222-222222222222', 'B', 'A', 'm1', '08:00', 'tts', 1)`,
      args: [],
    });
    await purgeUserAccount(testDb, 'A', 'gA');

    const rows = await testDb.execute({
      sql: `SELECT alarm_id FROM alarm_recipient_state WHERE recipient_user_id IN ('A','gA')`,
      args: [],
    });
    expect(rows.rows.length).toBe(0);
  });

  it('알릴 수신자를 돌려준다 — 커밋 후 push 로 즉시 걷어내게', async () => {
    const { downgradedAlarms: targets } = await purgeUserAccount(testDb, 'A', 'gA');
    // 기록만 남기고 안 알리면 B 가 백그라운드일 때 다음 주기 pull 까지 탈퇴자의
    // 목소리로 계속 울린다. 형태는 notifyDowngradedAlarms 의 target 그대로.
    expect(targets).toEqual([{ alarmId: ALARM_ID, ownerUserId: 'B', isReceived: true }]);
  });

  it('내 클론을 자기 알람에 쓰던 사람도 알림 대상이다 — 알람은 남기고 목소리만 내린다', async () => {
    // B 가 **자기 알람**에 A 의 공유 클론(vp-A)을 골라 뒀다. A 가 보낸 알람이 아니라
    // 탈퇴로 지워지지 않는데, B 의 기기는 캐시된 A 의 녹음으로 계속 울린다.
    const mine = '33333333-3333-3333-3333-333333333333';
    await testDb.execute({
      sql: `INSERT INTO alarms (id, user_id, target_user_id, voice_profile_id, time, mode, is_active)
            VALUES (?, 'B', NULL, 'vp-A', '06:00', 'tts', 1)`,
      args: [mine],
    });

    const { downgradedAlarms: targets } = await purgeUserAccount(testDb, 'A', 'gA');

    // 본인 소유 알람이라 pull 이 아니라 목소리 접근권 재확인으로 알린다(isReceived=false).
    expect(targets).toContainEqual({ alarmId: mine, ownerUserId: 'B', isReceived: false });
    const row = await testDb.execute({
      sql: `SELECT mode, voice_profile_id, message_id, is_active FROM alarms WHERE id = ?`,
      args: [mine],
    });
    // 알람은 남아 울리되(시각은 B 것이다) 목소리만 걷힌다.
    expect(row.rows.length).toBe(1);
    expect(row.rows[0]!.mode).toBe('sound-only');
    expect(row.rows[0]!.voice_profile_id).toBeNull();
    expect(Number(row.rows[0]!.is_active)).toBe(1);
  });

  it('서버에 알람 행이 없어도 같은 그룹 멤버에게는 알린다(미동기화 로컬 알람)', async () => {
    // 알람은 로컬이 원본이라, 아직 서버로 올라가지 않은 알람은 alarms 조회에 안 잡힌다.
    // 그래도 그 기기는 캐시된 A 의 녹음으로 그대로 울리므로, 목소리를 볼 수 있었던
    // 사람에게는 알람 유무와 무관하게 알려야 한다.
    // 스코프는 plan_group_members 동석만 본다(공유 목소리 조회와 같은 기준).
    await testDb.execute({
      sql: `INSERT INTO plan_groups (id, owner_user_id, plan_id) VALUES ('g1','A',?)`,
      args: [FAMILY_PLAN_ID],
    });
    await testDb.execute({
      sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
            VALUES ('pm1','g1','A','owner'), ('pm2','g1','B','member')`,
      args: [],
    });

    const purged = await purgeUserAccount(testDb, 'A', 'gA');

    // 본인은 빼고 상대만. voice_access_revoked → VoiceAccessSyncWorker 가 재조회 후 강등한다.
    expect(purged.voiceAccessRevokedUserIds).toEqual(['B']);
  });

  it('클론이 없으면 아무도 깨우지 않는다(파기할 생체정보가 없다)', async () => {
    await testDb.execute({
      sql: `UPDATE voice_profiles SET is_system = 1 WHERE id = 'vp-A'`,
      args: [],
    });
    // 스코프는 plan_group_members 동석만 본다(공유 목소리 조회와 같은 기준).
    await testDb.execute({
      sql: `INSERT INTO plan_groups (id, owner_user_id, plan_id) VALUES ('g1','A',?)`,
      args: [FAMILY_PLAN_ID],
    });
    await testDb.execute({
      sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
            VALUES ('pm1','g1','A','owner'), ('pm2','g1','B','member')`,
      args: [],
    });

    const purged = await purgeUserAccount(testDb, 'A', 'gA');

    expect(purged.voiceAccessRevokedUserIds).toEqual([]);
  });

  it('탈퇴한 본인이 받은 알람은 알릴 대상이 아니다(그 기기는 이미 계정이 없다)', async () => {
    await testDb.execute({
      sql: `INSERT INTO alarms (id, user_id, target_user_id, message_id, time, mode, is_active)
            VALUES ('22222222-2222-2222-2222-222222222222', 'B', 'A', 'm1', '08:00', 'tts', 1)`,
      args: [],
    });
    const { downgradedAlarms: targets } = await purgeUserAccount(testDb, 'A', 'gA');
    expect(targets.map((t) => t.ownerUserId)).toEqual(['B']);
  });
});
