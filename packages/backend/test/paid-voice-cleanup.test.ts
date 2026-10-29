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
// 한정된다. 목소리 공유는 2026-10-20 에 없앴다.
// 서버에는 알람 사본이 없다(#147) — 그 목소리로 울던 알람은 주인 계정의 기기가 내린다. 서버가 하는 일은 주인을 깨울
// 계정 목록(`voiceAccessRevokedUserIds`)을 돌려주는 것뿐이고, 강등 목록(`downgradedAlarms`)은 언제나 비어 있다.

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

  it('deletePaidVoiceDataForUser(A): A 의 문구·목소리는 지우고 B 의 것은 그대로다', async () => {
    await deletePaidVoiceDataForUser(db, 'A');

    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-A'`)).toBe(0);
    expect(await countRows(db, `SELECT id FROM voice_profiles WHERE id = 'vp-A'`)).toBe(0);

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

  it('downgradeUserToFree(A, {deleteVoiceData:false}): 클론만 반납하고 문구·목소리 행은 보관한다', async () => {
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
    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-A'`)).toBe(1);
    expect(
      await countRows(
        db,
        `SELECT id FROM pending_external_deletions WHERE kind = 'elevenlabs_voice' AND ref = 'provider-A'`,
      ),
    ).toBe(1);
  });

  it('민감 음성 동의 철회는 음성 데이터만 제거하고 알람은 기기에 맡긴다 — 접근권 상실은 주인 한 사람에게', async () => {
    await db.execute({
      sql: `UPDATE voice_profiles SET elevenlabs_voice_id = 'provider-A' WHERE id = 'vp-A'`,
      args: [],
    });

    const revocation = await deleteSensitiveVoiceDataForUser(db, 'A');

    // 서버가 강등할 알람 행은 없다 — 주인을 깨우면 그 기기들이 이 목소리의 알람을 기본 목소리로 내린다.
    expect(revocation.downgradedAlarms).toEqual([]);
    expect(revocation.voiceAccessRevokedUserIds).toEqual(['A']);
    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-A'`)).toBe(0);
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

  it('purgeUserAccount(A, 계정 삭제): A 의 행만 사라지고 B 의 문구·목소리는 남는다', async () => {
    await purgeUserAccount(db, 'A', 'google-A');

    expect((await db.execute(`SELECT id FROM users WHERE id = 'A'`)).rows).toEqual([]);
    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-A'`)).toBe(0);
    expect(await countRows(db, `SELECT id FROM voice_profiles WHERE id = 'vp-A'`)).toBe(0);
    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-B'`)).toBe(1);
    expect(await countRows(db, `SELECT id FROM voice_profiles WHERE id = 'vp-B'`)).toBe(1);
  });
});

// 동의 철회는 '생체정보(내가 등록한 클론)에서 파생된 것'만 지워야 한다. 예전에는
// user_id 로도 지워서, 생체정보와 무관한 시스템(기본) 목소리 자산까지 날아갔다.
describe('deleteSensitiveVoiceDataForUser — 클론 파생만 지운다', () => {
  it('시스템 목소리로 만든 문구·생성음성·라이브러리는 남는다', async () => {
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

    // 클론으로 만든 자산 — 이건 지워져야 한다.
    await insertMessage(db, 'msg-clone', 'user-A', 'vp-clone');

    const revocation = await deleteSensitiveVoiceDataForUser(db, 'user-A');

    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-system'`)).toBe(1);
    expect(await countRows(db, `SELECT id FROM message_library WHERE id = 'lib-system'`)).toBe(1);
    expect(await countRows(db, `SELECT id FROM generated_audio_assets WHERE id = 'ga-system'`)).toBe(1);
    // 시스템 보이스 캐시 오브젝트를 외부 삭제 큐에 넣으면 남의 알람까지 깨진다.
    expect(
      await countRows(db, `SELECT id FROM pending_external_deletions WHERE ref = 'obj-system'`),
    ).toBe(0);

    // 클론 파생은 사라지고, 그 클론으로 울던 알람은 주인 기기가 내린다(주인을 깨운다).
    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-clone'`)).toBe(0);
    expect(revocation).toEqual({ downgradedAlarms: [], voiceAccessRevokedUserIds: ['user-A'] });
  });

  it('클론이 없는 무료 사용자는 아무것도 잃지 않는다', async () => {
    const db = await setupDb();
    await insertUser(db, 'user-C');
    await insertSystemVoiceProfile(db, 'vp-system-2');
    await insertMessage(db, 'msg-free', 'user-C', 'vp-system-2');

    const revocation = await deleteSensitiveVoiceDataForUser(db, 'user-C');

    // 잃은 목소리가 없으니 깨울 기기도 없다.
    expect(revocation).toEqual({ downgradedAlarms: [], voiceAccessRevokedUserIds: [] });
    expect(await countRows(db, `SELECT id FROM messages WHERE id = 'msg-free'`)).toBe(1);
  });
});
