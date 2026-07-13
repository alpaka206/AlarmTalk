import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { runMigrations } from '../src/lib/migrations';
import {
  deletePaidVoiceDataForUser,
  deleteSensitiveVoiceDataForUser,
} from '../src/lib/paid-voice-cleanup';
import { downgradeUserToFree } from '../src/lib/billing-cancel';

// 실제 libSQL(인메모리) + 실제 마이그레이션으로 검증한다. 공유 목소리 제공자가 취소/강등될 때
// 그 목소리를 참조하는 '타인 소유' 알람이 하드 삭제되면 수신자의 기상 알람이 통째로 사라지는
// 데이터 손실(감사 B-1/B-2)이 발생하므로, 삭제가 아니라 sound-only 강등이어야 함을 고정한다.

async function setupDb(): Promise<Client> {
  const db = createClient({ url: ':memory:' });
  await runMigrations(db);
  return db;
}

async function insertUser(db: Client, id: string) {
  await db.execute({
    sql: `INSERT INTO users (id, google_id, email) VALUES (?, ?, ?)`,
    args: [id, `google-${id}`, `${id}@example.com`],
  });
}

async function insertSharedVoiceProfile(db: Client, id: string, ownerId: string) {
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, is_shared) VALUES (?, ?, ?, 1)`,
    args: [id, ownerId, `voice-${id}`],
  });
}

async function insertMessage(db: Client, id: string, userId: string, voiceProfileId: string) {
  await db.execute({
    sql: `INSERT INTO messages (id, user_id, voice_profile_id, text) VALUES (?, ?, ?, ?)`,
    args: [id, userId, voiceProfileId, 'good morning'],
  });
}

async function insertVoiceAlarm(
  db: Client,
  id: string,
  userId: string,
  messageId: string,
  voiceProfileId: string,
) {
  await db.execute({
    sql: `INSERT INTO alarms (id, user_id, message_id, voice_profile_id, time, mode)
          VALUES (?, ?, ?, ?, '07:00', 'tts')`,
    args: [id, userId, messageId, voiceProfileId],
  });
}

async function getAlarm(db: Client, id: string) {
  const res = await db.execute({ sql: `SELECT * FROM alarms WHERE id = ?`, args: [id] });
  return res.rows[0] ?? null;
}

describe('paid voice cleanup — 공유 목소리 소멸 시 타인 알람 보존(강등)', () => {
  let db: Client;
  beforeEach(async () => {
    db = await setupDb();
    // owner A(공유 목소리 제공자), member B(그 목소리로 자기 알람 생성)
    await insertUser(db, 'A');
    await insertUser(db, 'B');
    await insertSharedVoiceProfile(db, 'vp-A', 'A');
    await insertMessage(db, 'msg-A', 'A', 'vp-A');
    await insertMessage(db, 'msg-B', 'B', 'vp-A'); // B의 메시지도 A의 공유 목소리로 합성됨
  });

  it('deletePaidVoiceDataForUser(A): A 본인 알람은 삭제, B의 알람은 sound-only로 강등·보존', async () => {
    await insertVoiceAlarm(db, 'al-A', 'A', 'msg-A', 'vp-A'); // A 본인 → 삭제 대상
    await insertVoiceAlarm(db, 'al-B', 'B', 'msg-B', 'vp-A'); // 타인 소유 → 강등·보존

    await deletePaidVoiceDataForUser(db, 'A');

    // A 본인 알람은 계정 정리로 삭제
    expect(await getAlarm(db, 'al-A')).toBeNull();

    // B의 기상 알람은 살아남고 sound-only로 강등(음성 참조 제거)
    const alB = await getAlarm(db, 'al-B');
    expect(alB).not.toBeNull();
    expect(alB!.mode).toBe('sound-only');
    expect(alB!.voice_profile_id).toBeNull();
    expect(alB!.message_id).toBeNull();
    expect(alB!.wake_mode).toBe('sound_then_voice');
  });

  it('deletePaidVoiceDataForUser(A): 메시지 경유로만 A 목소리를 참조하는 타인 알람도 강등·보존', async () => {
    // voice_profile_id 는 비우고 message_id 만 A의 목소리를 가리키는 알람
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, message_id, time, mode) VALUES ('al-B2', 'B', 'msg-B', '09:00', 'tts')`,
      args: [],
    });

    await deletePaidVoiceDataForUser(db, 'A');

    const alB2 = await getAlarm(db, 'al-B2');
    expect(alB2).not.toBeNull();
    expect(alB2!.mode).toBe('sound-only');
    expect(alB2!.message_id).toBeNull();
  });

  it('downgradeUserToFree(A, {deleteVoiceData:false}): un-share 시 타인 알람을 강등하고 좀비로 남기지 않음', async () => {
    await insertVoiceAlarm(db, 'al-B', 'B', 'msg-B', 'vp-A');

    await downgradeUserToFree(db, 'A', { deleteVoiceData: false });

    // 공유 해제
    const vp = await db.execute({
      sql: `SELECT is_shared FROM voice_profiles WHERE id = 'vp-A'`,
      args: [],
    });
    expect(Number(vp.rows[0]!.is_shared)).toBe(0);

    // B의 알람은 유지되되 sound-only로 강등(취소된 목소리가 계속 울리지 않도록)
    const alB = await getAlarm(db, 'al-B');
    expect(alB).not.toBeNull();
    expect(alB!.mode).toBe('sound-only');
    expect(alB!.voice_profile_id).toBeNull();
  });

  it('민감 음성 동의 철회는 본인과 타인의 알람을 보존하고 음성 데이터만 제거한다', async () => {
    await insertVoiceAlarm(db, 'al-A', 'A', 'msg-A', 'vp-A');
    await insertVoiceAlarm(db, 'al-B', 'B', 'msg-B', 'vp-A');
    await db.execute({
      sql: `UPDATE alarms SET raw_audio_url = 'r2://raw-alarm' WHERE id IN ('al-A', 'al-B')`,
      args: [],
    });
    await db.execute({
      sql: `UPDATE voice_profiles SET elevenlabs_voice_id = 'provider-A' WHERE id = 'vp-A'`,
      args: [],
    });

    await deleteSensitiveVoiceDataForUser(db, 'A');

    for (const alarmId of ['al-A', 'al-B']) {
      const alarm = await getAlarm(db, alarmId);
      expect(alarm).not.toBeNull();
      expect(alarm!.mode).toBe('sound-only');
      expect(alarm!.voice_profile_id).toBeNull();
      expect(alarm!.message_id).toBeNull();
      expect(alarm!.raw_audio_url).toBe('r2://raw-alarm');
    }
    expect((await db.execute(`SELECT * FROM voice_profiles WHERE id = 'vp-A'`)).rows).toEqual([]);
    expect(
      (
        await db.execute(
          `SELECT * FROM pending_external_deletions WHERE kind = 'elevenlabs_voice' AND ref = 'provider-A'`,
        )
      ).rows,
    ).toHaveLength(1);
  });

  // 참고: 실데이터에서 voice_profiles.user_id 가 로그인 id(google_id)로 저장된 케이스는
  // deletePaidVoiceDataForUser 와 동일하게 [userPk, loginId] 두 id 를 모두 매칭해 덮는다(PR #536 P1).
  // 이 인메모리 테스트는 FK(user_id REFERENCES users(id))를 강제해 login-id 저장 자체를 못 만드므로
  // 별도 재현 대신 코드 정합(두 id 매칭)으로 보장한다.
});
