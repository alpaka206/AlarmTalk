import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { runMigrations } from '../src/lib/migrations';
import {
  deletePaidVoiceDataForUser,
  deleteSensitiveVoiceDataForUser,
} from '../src/lib/paid-voice-cleanup';
import { downgradeUserToFree } from '../src/lib/billing-cancel';
import { purgeUserAccount } from '../src/lib/account-deletion';

// 실제 libSQL(인메모리) + 실제 마이그레이션으로 검증한다. 유료 음성 데이터 정리는 **호출 사용자 소유 데이터**로
// 한정된다 — 남의 알람이 내 목소리·문구를 가리킬 길은 없다(알람 쓰기는 내 목소리·시스템 목소리만 받는다,
// `voiceProfileBelongsToCaller`·`messageBelongsToCaller`). 목소리 공유는 2026-10-20 에 없앴다.

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

async function insertCloneVoiceProfile(db: Client, id: string, ownerId: string) {
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name) VALUES (?, ?, ?)`,
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

/** 시스템(기본) 목소리 프로필. is_system=1 이 클론과 가르는 유일한 축이다. */
async function insertSystemVoiceProfile(db: Client, id: string) {
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, is_system)
          VALUES (?, ?, ?, 1)`,
    args: [id, SYSTEM_VOICE_USER, `system-${id}`],
  });
}

const SYSTEM_VOICE_USER = '70000000-0000-4000-9000-000000000001';

async function countRows(db: Client, sql: string, args: unknown[] = []): Promise<number> {
  const res = await db.execute({ sql, args: args as never[] });
  return res.rows.length;
}

async function getAlarm(db: Client, id: string) {
  const res = await db.execute({ sql: `SELECT * FROM alarms WHERE id = ?`, args: [id] });
  return res.rows[0] ?? null;
}

describe('paid voice cleanup — 내 목소리 데이터만 정리한다', () => {
  let db: Client;
  beforeEach(async () => {
    db = await setupDb();
    // A(정리 대상)와 B(무관한 다른 계정) — 각자 자기 클론과 문구가 있다.
    await insertUser(db, 'A');
    await insertUser(db, 'B');
    await insertCloneVoiceProfile(db, 'vp-A', 'A');
    await insertCloneVoiceProfile(db, 'vp-B', 'B');
    await insertMessage(db, 'msg-A', 'A', 'vp-A');
    await insertMessage(db, 'msg-B', 'B', 'vp-B');
  });

  it('deletePaidVoiceDataForUser(A): A 의 알람·문구·목소리는 지우고 B 의 것은 그대로다', async () => {
    await insertVoiceAlarm(db, 'al-A', 'A', 'msg-A', 'vp-A');
    await insertVoiceAlarm(db, 'al-B', 'B', 'msg-B', 'vp-B');

    await deletePaidVoiceDataForUser(db, 'A');

    expect(await getAlarm(db, 'al-A')).toBeNull();
    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-A'`)).toBe(0);
    expect(await countRows(db, `SELECT id FROM voice_profiles WHERE id = 'vp-A'`)).toBe(0);

    const alB = await getAlarm(db, 'al-B');
    expect(alB).toMatchObject({ mode: 'tts', message_id: 'msg-B', voice_profile_id: 'vp-B' });
    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-B'`)).toBe(1);
    expect(await countRows(db, `SELECT id FROM voice_profiles WHERE id = 'vp-B'`)).toBe(1);
  });

  it('deletePaidVoiceDataForUser(A): A 의 목소리를 가리키는 문구는 주인이 누구든 지운다 — FK 로 멈추지 않는다', async () => {
    // 목소리 공유가 있던 시절에 남을 수 있던 모양 — B 의 문구가 A 의 클론으로 합성됐다(알람은 없다).
    // messages.voice_profile_id 는 NOT NULL FK 라, 남기면 `DELETE FROM voice_profiles` 가 실패한다.
    await insertMessage(db, 'msg-B-on-A', 'B', 'vp-A');

    await expect(deletePaidVoiceDataForUser(db, 'A')).resolves.toBeUndefined();

    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-B-on-A'`)).toBe(0);
    expect(await countRows(db, `SELECT id FROM voice_profiles WHERE id = 'vp-A'`)).toBe(0);
    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-B'`)).toBe(1);
  });

  it('downgradeUserToFree(A, {deleteVoiceData:false}): 클론만 반납하고 알람·문구·목소리 행은 보관한다', async () => {
    await insertVoiceAlarm(db, 'al-A', 'A', 'msg-A', 'vp-A');
    await db.execute(`UPDATE users SET plan = 'plus' WHERE id = 'A'`);
    await db.execute(`UPDATE voice_profiles SET elevenlabs_voice_id = 'provider-A' WHERE id = 'vp-A'`);

    await downgradeUserToFree(db, 'A', { deleteVoiceData: false });

    expect((await db.execute(`SELECT plan FROM users WHERE id = 'A'`)).rows[0]!.plan).toBe('free');
    const vp = (
      await db.execute(
        `SELECT elevenlabs_voice_id, evicted_provider_voice_id, evicted_at, deleted_at
           FROM voice_profiles WHERE id = 'vp-A'`,
      )
    ).rows[0]!;
    // 재구독하면 원본으로 다시 클론한다 — 표식(evicted_*)을 남기고 행은 지우지 않는다.
    expect(vp.elevenlabs_voice_id).toBeNull();
    expect(vp.evicted_provider_voice_id).toBe('provider-A');
    expect(vp.evicted_at).not.toBeNull();
    expect(vp.deleted_at).toBeNull();
    expect(await getAlarm(db, 'al-A')).toMatchObject({ mode: 'tts', message_id: 'msg-A' });
    expect(
      await countRows(
        db,
        `SELECT id FROM pending_external_deletions WHERE kind = 'elevenlabs_voice' AND ref = 'provider-A'`,
      ),
    ).toBe(1);
  });

  it('민감 음성 동의 철회는 알람을 보존하고 음성 데이터만 제거한다 — 접근권 상실은 주인 한 사람에게', async () => {
    await insertVoiceAlarm(db, 'al-A', 'A', 'msg-A', 'vp-A');
    await db.execute({
      sql: `UPDATE voice_profiles SET elevenlabs_voice_id = 'provider-A' WHERE id = 'vp-A'`,
      args: [],
    });

    const revocation = await deleteSensitiveVoiceDataForUser(db, 'A');

    const alarm = await getAlarm(db, 'al-A');
    expect(alarm).not.toBeNull();
    expect(alarm!.mode).toBe('sound-only');
    expect(alarm!.voice_profile_id).toBeNull();
    expect(alarm!.message_id).toBeNull();
    expect(revocation.downgradedAlarms).toEqual([{ alarmId: 'al-A', ownerUserId: 'A' }]);
    expect(revocation.voiceAccessRevokedUserIds).toEqual(['A']);
    expect((await db.execute(`SELECT * FROM voice_profiles WHERE id = 'vp-A'`)).rows).toEqual([]);
    expect(
      (
        await db.execute(
          `SELECT * FROM pending_external_deletions WHERE kind = 'elevenlabs_voice' AND ref = 'provider-A'`,
        )
      ).rows,
    ).toHaveLength(1);
    // B 는 무관하다.
    expect(await countRows(db, `SELECT id FROM voice_profiles WHERE id = 'vp-B'`)).toBe(1);
  });

  // 참고: 실데이터에서 voice_profiles.user_id 가 로그인 id(google_id)로 저장된 케이스는
  // deletePaidVoiceDataForUser 와 동일하게 [userPk, loginId] 두 id 를 모두 매칭해 덮는다(PR #536 P1).
  // 이 인메모리 테스트는 FK(user_id REFERENCES users(id))를 강제해 login-id 저장 자체를 못 만드므로
  // 별도 재현 대신 코드 정합(두 id 매칭)으로 보장한다.

  it('purgeUserAccount(A, 계정 삭제): A 의 행만 사라지고 B 의 알람·문구는 남는다', async () => {
    await insertVoiceAlarm(db, 'al-A', 'A', 'msg-A', 'vp-A');
    await insertVoiceAlarm(db, 'al-B', 'B', 'msg-B', 'vp-B');

    await purgeUserAccount(db, 'A', 'google-A');

    expect(await getAlarm(db, 'al-A')).toBeNull();
    expect((await db.execute(`SELECT id FROM users WHERE id = 'A'`)).rows).toEqual([]);
    expect(await getAlarm(db, 'al-B')).toMatchObject({ mode: 'tts', message_id: 'msg-B' });
  });
});

// 동의 철회는 '생체정보(내가 등록한 클론)에서 파생된 것'만 지워야 한다. 예전에는
// user_id 로도 지워서, 생체정보와 무관한 시스템(기본) 목소리 자산까지 날아갔다.
describe('deleteSensitiveVoiceDataForUser — 클론 파생만 지운다', () => {
  it('시스템 목소리로 만든 문구·생성음성·라이브러리와 그 알람은 남는다', async () => {
    const db = await setupDb();
    await insertUser(db, 'user-A');
    await insertSystemVoiceProfile(db, 'vp-system');
    await insertCloneVoiceProfile(db, 'vp-clone', 'user-A');

    // 시스템 목소리로 만든 자산 — 생체정보가 아니다.
    await insertMessage(db, 'msg-system', 'user-A', 'vp-system');
    await db.execute({
      sql: `INSERT INTO message_library (id, user_id, message_id) VALUES (?, ?, ?)`,
      args: ['lib-system', 'user-A', 'msg-system'],
    });
    await db.execute({
      sql: `INSERT INTO generated_audio_assets
              (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
               model_id, language, request_hash, text, audio_object_key)
            VALUES (?, ?, ?, ?, 'elevenlabs', 'pv', 'm', 'ko', 'hash-system', 't', 'obj-system')`,
      args: ['ga-system', 'user-A', 'vp-system', 'msg-system'],
    });
    await insertVoiceAlarm(db, 'al-system', 'user-A', 'msg-system', 'vp-system');

    // 클론으로 만든 자산 — 이건 지워져야 한다.
    await insertMessage(db, 'msg-clone', 'user-A', 'vp-clone');
    await insertVoiceAlarm(db, 'al-clone', 'user-A', 'msg-clone', 'vp-clone');

    await deleteSensitiveVoiceDataForUser(db, 'user-A');

    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-system'`)).toBe(1);
    expect(await countRows(db, `SELECT id FROM message_library WHERE id = 'lib-system'`)).toBe(1);
    expect(await countRows(db, `SELECT id FROM generated_audio_assets WHERE id = 'ga-system'`)).toBe(1);
    // 시스템 목소리 알람은 강등되지 않는다.
    expect((await getAlarm(db, 'al-system'))?.mode).toBe('tts');
    // 시스템 보이스 캐시 오브젝트를 외부 삭제 큐에 넣으면 남의 알람까지 깨진다.
    expect(
      await countRows(db, `SELECT id FROM pending_external_deletions WHERE ref = 'obj-system'`),
    ).toBe(0);

    // 클론 파생은 사라지고 그 알람만 강등된다.
    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-clone'`)).toBe(0);
    expect((await getAlarm(db, 'al-clone'))?.mode).toBe('sound-only');
  });

  it('클론이 없는 무료 사용자는 아무것도 잃지 않는다', async () => {
    const db = await setupDb();
    await insertUser(db, 'user-C');
    await insertSystemVoiceProfile(db, 'vp-system-2');
    await insertMessage(db, 'msg-free', 'user-C', 'vp-system-2');
    await insertVoiceAlarm(db, 'al-free', 'user-C', 'msg-free', 'vp-system-2');

    const downgraded = await deleteSensitiveVoiceDataForUser(db, 'user-C');

    expect(downgraded.downgradedAlarms).toEqual([]);
    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-free'`)).toBe(1);
    expect((await getAlarm(db, 'al-free'))?.mode).toBe('tts');
  });
});
