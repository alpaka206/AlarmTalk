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
const FAMILY_VOICE_ALARM_ID = '44444444-4444-4444-4444-444444444444';
const FAMILY_PLAN_ID = '70000000-0000-4000-8000-000000000003'; // 마이그레이션 시드 '가족' 플랜

async function seed() {
  const db = createClient({ url: ':memory:' });
  await runMigrations(db);
  await db.execute({
    sql: `INSERT INTO users (id, google_id, email) VALUES ('A','gA','a@x.com')`,
    args: [],
  });
  await db.execute({
    sql: `INSERT INTO users (id, google_id, email) VALUES ('B','gB','b@x.com')`,
    args: [],
  });
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name) VALUES ('vp-A','A','v')`,
    args: [],
  });
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

async function seedFamilyVoiceUploadAlarm() {
  await testDb.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name) VALUES ('vp-B','B','recipient placeholder')`,
    args: [],
  });
  await testDb.execute({
    sql: `INSERT INTO voice_uploads (id, user_id, object_key, mime_type, size_bytes)
          VALUES ('upload-A','A','uploads/A/family.m4a','audio/mp4',1234)`,
    args: [],
  });
  await testDb.execute({
    sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
          VALUES ('m-family-voice','B','vp-B','일어나','uploads/A/family.m4a','family-voice')`,
    args: [],
  });
  await testDb.execute({
    sql: `INSERT INTO alarms
            (id, user_id, target_user_id, message_id, voice_profile_id, time, mode, is_active)
          VALUES (?, 'A', 'B', 'm-family-voice', 'vp-B', '09:00', 'tts', 1)`,
    args: [FAMILY_VOICE_ALARM_ID],
  });
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
    const row = await testDb.execute({
      sql: `SELECT is_active FROM alarms WHERE id = ?`,
      args: [ALARM_ID],
    });
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

// 받은 알람은 **로컬이 원본**이라, 수신자가 다 받고 나면 서버 행은 소임을 다한다.
// 남겨 두면 `audio-retention` 이 "아직 쓰는 알람이 있다" 고 보아 클론 음원을 영구 보존한다.
describe('수신자 수신 확인(received) — 서버 행 정리', () => {
  beforeEach(async () => {
    testDb = await seed();
  });

  it('수신자 B 가 확인하면 알람 행이 지워지고, tombstone 에 발신자가 남는다', async () => {
    const res = await appFor('B').request('/' + ALARM_ID + '/received', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deleted: boolean }).deleted).toBe(true);

    const row = await testDb.execute({
      sql: `SELECT id FROM alarms WHERE id = ?`,
      args: [ALARM_ID],
    });
    expect(row.rows.length).toBe(0);

    // ⚠ tombstone 이 없으면 발신자 탈퇴 시 철회 대상을 찾지 못한다(Codex #676 P1 과 같은 장치).
    const st = await testDb.execute({
      sql: `SELECT sender_user_id, declined, revoked FROM alarm_recipient_state
            WHERE alarm_id = ? AND recipient_user_id = 'B'`,
      args: [ALARM_ID],
    });
    expect(st.rows.length).toBe(1);
    expect(String(st.rows[0]!.sender_user_id)).toBe('A');
    // 아직 아무 효력이 없어야 한다 — 지금 막 정상 수신한 알람이다.
    expect(Number(st.rows[0]!.declined)).toBe(0);
    expect(Number(st.rows[0]!.revoked)).toBe(0);
  });

  it('두 번 불러도 성공한다(멱등) — 재시도가 500 이 되지 않게', async () => {
    await appFor('B').request('/' + ALARM_ID + '/received', { method: 'POST' });
    const again = await appFor('B').request('/' + ALARM_ID + '/received', { method: 'POST' });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { deleted: boolean }).deleted).toBe(false);
  });

  it('대상이 아닌 사용자(생성자 A)는 확인할 수 없다(404)', async () => {
    const res = await appFor('A').request('/' + ALARM_ID + '/received', { method: 'POST' });
    expect(res.status).toBe(404);
    const row = await testDb.execute({
      sql: `SELECT id FROM alarms WHERE id = ?`,
      args: [ALARM_ID],
    });
    expect(row.rows.length).toBe(1);
  });

  it('수신 확인 뒤 발신자가 탈퇴해도 철회 대상으로 잡힌다(tombstone 갈래)', async () => {
    await appFor('B').request('/' + ALARM_ID + '/received', { method: 'POST' });
    const { downgradedAlarms } = await purgeUserAccount(testDb, 'A', 'gA');
    expect(downgradedAlarms.map((t) => t.ownerUserId)).toContain('B');
  });

  it('tombstone 에 그 알람이 쓰는 클론 목소리를 적어 둔다 — 철회 판정의 유일한 근거', async () => {
    await appFor('B').request('/' + ALARM_ID + '/received', { method: 'POST' });
    const st = await testDb.execute({
      sql: `SELECT voice_profile_id FROM alarm_recipient_state
            WHERE alarm_id = ? AND recipient_user_id = 'B'`,
      args: [ALARM_ID],
    });
    expect(String(st.rows[0]!.voice_profile_id)).toBe('vp-A');
  });

  it('알람 직접 참조와 문구 목소리가 다르면 실제 재생되는 문구 목소리를 기록한다', async () => {
    // 구형/비정상 클라이언트가 시스템 목소리를 직접 참조로 함께 보내도, message_id가 있으면
    // 수신자가 내려받아 재생하는 음원은 message를 만든 vp-A의 것이다.
    await testDb.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, is_system)
            VALUES ('vp-sys','A','기본',1)`,
      args: [],
    });
    await testDb.execute({
      sql: `UPDATE alarms SET voice_profile_id = 'vp-sys' WHERE id = ?`,
      args: [ALARM_ID],
    });

    await appFor('B').request('/' + ALARM_ID + '/received', { method: 'POST' });

    const st = await testDb.execute({
      sql: `SELECT voice_profile_id FROM alarm_recipient_state
            WHERE alarm_id = ? AND recipient_user_id = 'B'`,
      args: [ALARM_ID],
    });
    expect(String(st.rows[0]!.voice_profile_id)).toBe('vp-A');
  });

  it('family-voice는 수신자 프로필이 아니라 발신자 직접 업로드로 기록한다', async () => {
    await seedFamilyVoiceUploadAlarm();
    await appFor('B').request('/' + FAMILY_VOICE_ALARM_ID + '/received', { method: 'POST' });

    const st = await testDb.execute({
      sql: `SELECT voice_profile_id, sender_user_id, sender_voice_upload, revoked
              FROM alarm_recipient_state WHERE alarm_id = ?`,
      args: [FAMILY_VOICE_ALARM_ID],
    });
    expect(st.rows[0]!.voice_profile_id).toBeNull();
    expect(String(st.rows[0]!.sender_user_id)).toBe('A');
    expect(Number(st.rows[0]!.sender_voice_upload)).toBe(1);
    expect(Number(st.rows[0]!.revoked)).toBe(0);
  });

  it('family-voice는 수신자 클론 삭제로 철회되지 않고 발신자 파기 때만 철회된다', async () => {
    const { revokeDeletedVoices } = await import('../src/lib/voice-revocation');
    await seedFamilyVoiceUploadAlarm();
    await appFor('B').request('/' + FAMILY_VOICE_ALARM_ID + '/received', { method: 'POST' });

    const unrelated = await revokeDeletedVoices(testDb, {
      voiceProfileIds: ['vp-B'],
      ownerUserIds: ['B'],
    });
    expect(unrelated.downgradedAlarms.map((target) => target.alarmId)).not.toContain(
      FAMILY_VOICE_ALARM_ID,
    );

    // 발신자에게 클론이 하나도 없어도 직접 업로드는 발신자의 생체정보라 파기 대상이다.
    await testDb.execute({
      sql: `UPDATE voice_profiles SET is_system = 1 WHERE id = 'vp-A'`,
      args: [],
    });
    const purged = await purgeUserAccount(testDb, 'A', 'gA');
    expect(purged.downgradedAlarms).toContainEqual({
      alarmId: FAMILY_VOICE_ALARM_ID,
      ownerUserId: 'B',
      isReceived: true,
    });
    const after = await testDb.execute({
      sql: `SELECT revoked FROM alarm_recipient_state WHERE alarm_id = ?`,
      args: [FAMILY_VOICE_ALARM_ID],
    });
    expect(Number(after.rows[0]!.revoked)).toBe(1);
  });

  it('철회가 먼저 기록된 뒤 늦은 수신 확인이 와도 revoked를 되돌리지 않는다', async () => {
    await testDb.execute({
      sql: `INSERT INTO alarm_recipient_state
              (alarm_id, recipient_user_id, declined, revoked, created_at, updated_at)
            VALUES (?, 'B', 0, 1, datetime('now'), datetime('now'))`,
      args: [ALARM_ID],
    });

    await appFor('B').request('/' + ALARM_ID + '/received', { method: 'POST' });

    const st = await testDb.execute({
      sql: `SELECT revoked, voice_profile_id, sender_voice_upload
              FROM alarm_recipient_state WHERE alarm_id = ?`,
      args: [ALARM_ID],
    });
    expect(Number(st.rows[0]!.revoked)).toBe(1);
    expect(st.rows[0]!.voice_profile_id).toBeNull();
    expect(Number(st.rows[0]!.sender_voice_upload)).toBe(0);
  });
});

// **철회의 축은 '목소리' 하나다.** 탈퇴·플랜 강등·직접 삭제 모두 같은 함수를 부른다
// (`lib/voice-revocation.ts`). 그래서 파기할 내 녹음이 없는 알람은 어느 경로로도 안 건드린다.
describe('철회는 목소리 기준이다', () => {
  beforeEach(async () => {
    testDb = await seed();
  });

  it('스톡 목소리로 보낸 알람은 발신자가 탈퇴해도 철회되지 않는다', async () => {
    // A 가 **기본(시스템) 목소리**로 B 에게 보낸 알람. 파기해야 할 A 의 생체정보가 없다 —
    // 받은 순간부터 그 알람은 B 것이고, A 의 탈퇴는 B 의 기상 시각을 건드릴 이유가 없다.
    const STOCK_ALARM = '22222222-2222-2222-2222-222222222222';
    await testDb.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, is_system) VALUES ('vp-sys','A','기본',1)`,
      args: [],
    });
    await testDb.execute({
      sql: `INSERT INTO messages (id, user_id, voice_profile_id, text) VALUES ('m-sys','A','vp-sys','일어나')`,
      args: [],
    });
    await testDb.execute({
      sql: `INSERT INTO alarms (id, user_id, target_user_id, message_id, voice_profile_id, time, mode, is_active)
            VALUES (?, 'A', 'B', 'm-sys', 'vp-sys', '08:00', 'tts', 1)`,
      args: [STOCK_ALARM],
    });
    await appFor('B').request('/' + STOCK_ALARM + '/received', { method: 'POST' });

    // 스톡이므로 목소리 참조를 적지 않는다 — 적어 두면 "걷어낼 것이 있다" 는 거짓 근거가 된다.
    const st = await testDb.execute({
      sql: `SELECT voice_profile_id FROM alarm_recipient_state WHERE alarm_id = ?`,
      args: [STOCK_ALARM],
    });
    expect(st.rows[0]!.voice_profile_id).toBeNull();

    const { downgradedAlarms } = await purgeUserAccount(testDb, 'A', 'gA');
    expect(downgradedAlarms.map((t) => t.alarmId)).not.toContain(STOCK_ALARM);
    const after = await testDb.execute({
      sql: `SELECT revoked FROM alarm_recipient_state WHERE alarm_id = ?`,
      args: [STOCK_ALARM],
    });
    expect(Number(after.rows[0]!.revoked)).toBe(0);
  });

  it('목소리만 지워도(탈퇴 없이) 이미 전달이 끝난 알람이 철회된다', async () => {
    const { revokeDeletedVoices } = await import('../src/lib/voice-revocation');
    await appFor('B').request('/' + ALARM_ID + '/received', { method: 'POST' });
    // 이 시점에 alarms 행은 없다 — tombstone 만으로 찾아내야 한다.
    const gone = await testDb.execute({
      sql: `SELECT id FROM alarms WHERE id = ?`,
      args: [ALARM_ID],
    });
    expect(gone.rows.length).toBe(0);

    const { downgradedAlarms } = await revokeDeletedVoices(testDb, {
      voiceProfileIds: ['vp-A'],
      ownerUserIds: ['A'],
    });
    expect(downgradedAlarms).toContainEqual({
      alarmId: ALARM_ID,
      ownerUserId: 'B',
      isReceived: true,
    });

    const st = await testDb.execute({
      sql: `SELECT revoked, voice_profile_id FROM alarm_recipient_state WHERE alarm_id = ?`,
      args: [ALARM_ID],
    });
    expect(Number(st.rows[0]!.revoked)).toBe(1);
    // 소비했으므로 참조는 지운다 — 다음 삭제가 같은 알람을 또 집지 않게.
    expect(st.rows[0]!.voice_profile_id).toBeNull();
  });

  it('남이 나에게 보낸 알람 행은 내 탈퇴로 지워지지 않는다(내 데이터가 아니다)', async () => {
    // B 가 탈퇴해도 A 가 만든 행은 A 것이다. 지우면 A 쪽 같은 시각 슬롯 이력이 조용히 사라진다.
    await purgeUserAccount(testDb, 'B', 'gB');
    const row = await testDb.execute({
      sql: `SELECT id FROM alarms WHERE id = ?`,
      args: [ALARM_ID],
    });
    expect(row.rows.length).toBe(1);
  });
});

describe('발신자 탈퇴 = 목소리 철회(revoked)', () => {
  beforeEach(async () => {
    testDb = await seed();
  });

  async function recipientState(userId: string) {
    const res = await appFor(userId).request('/declined');
    return (await res.json()) as {
      alarm_ids: string[];
      revoked_alarm_ids: string[];
      has_more?: boolean;
    };
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
    const gone = await testDb.execute({
      sql: `SELECT id FROM alarms WHERE id = ?`,
      args: [ALARM_ID],
    });
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

  it('발신자가 알람을 먼저 지운 뒤 탈퇴해도 목소리는 걷힌다', async () => {
    // A 가 보낸 알람을 지운다. 수신자 B 의 기기는 그 알람을 **그대로 들고 있다**(#675) —
    // 시각은 B 것이니까. 그래서 A 의 복제 목소리도 그 기기에 남는다.
    const del = await appFor('A').request('/' + ALARM_ID, { method: 'DELETE' });
    expect(del.status).toBe(200);
    // 이 시점에는 아직 아무 효력이 없다. 알람을 지웠다고 남의 목소리를 걷어낼 이유는 없다.
    expect((await recipientState('B')).revoked_alarm_ids).not.toContain(ALARM_ID);

    // 그 다음 A 가 탈퇴한다. 훑을 alarms 행은 이미 없지만 표식이 남아 있다.
    const purged = await purgeUserAccount(testDb, 'A', 'gA');

    expect((await recipientState('B')).revoked_alarm_ids).toContain(ALARM_ID);
    expect(purged.downgradedAlarms).toContainEqual({
      alarmId: ALARM_ID,
      ownerUserId: 'B',
      isReceived: true,
    });
    // 철회 사실만 남기고 탈퇴자의 식별자는 남기지 않는다.
    const row = await testDb.execute({
      sql: `SELECT sender_user_id FROM alarm_recipient_state WHERE alarm_id = ?`,
      args: [ALARM_ID],
    });
    expect(row.rows[0]!.sender_user_id).toBeNull();
  });

  it('표식을 못 남기면 알람도 지우지 않는다 — 알람만 사라지는 상태를 만들지 않는다', async () => {
    // 배포 직후 마이그레이션 93 이 아직 안 돌았을 때가 실제로 이 상황이다. 지운 뒤에
    // 적으면서 실패를 삼키면 알람도 표식도 없어 걷어낼 근거가 영영 사라진다(Codex #678 P1).
    await testDb.execute({
      sql: `ALTER TABLE alarm_recipient_state DROP COLUMN sender_user_id`,
      args: [],
    });

    const res = await appFor('A').request('/' + ALARM_ID, { method: 'DELETE' });

    expect(res.status).toBe(500);
    // 알람은 그대로 남는다 — 사용자는 재시도하면 되고 잃는 것이 없다.
    const still = await testDb.execute({
      sql: `SELECT id FROM alarms WHERE id = ?`,
      args: [ALARM_ID],
    });
    expect(still.rows.length).toBe(1);
  });

  it('남이 내 클론으로 만든 문구가 있어도 탈퇴가 FK 로 죽지 않는다', async () => {
    // B 가 A 의 공유 클론(vp-A)으로 자기 문구를 만들어 뒀다. messages.voice_profile_id 는
    // NOT NULL FK 라, 안 지우면 DELETE FROM voice_profiles 가 실패해 탈퇴가 통째로 500 이 된다.
    await testDb.execute({
      sql: `INSERT INTO messages (id, user_id, voice_profile_id, text) VALUES ('m-b','B','vp-A','hi')`,
      args: [],
    });
    await testDb.execute({
      sql: `INSERT INTO message_library (id, user_id, message_id) VALUES ('ml-b','B','m-b')`,
      args: [],
    });

    await expect(purgeUserAccount(testDb, 'A', 'gA')).resolves.toBeDefined();

    const gone = await testDb.execute({
      sql: `SELECT id FROM messages WHERE id = 'm-b'`,
      args: [],
    });
    expect(gone.rows.length).toBe(0);
    // A 의 클론은 사라진다(시스템 보이스는 남는다 — 남의 알람이 쓰고 있다).
    const profiles = await testDb.execute({
      sql: `SELECT id FROM voice_profiles WHERE id = 'vp-A'`,
      args: [],
    });
    expect(profiles.rows.length).toBe(0);
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
