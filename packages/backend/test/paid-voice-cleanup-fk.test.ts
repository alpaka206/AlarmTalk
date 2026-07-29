// 보관 만료 스윕(sweepPaidVoiceRetention → deleteSensitiveVoiceDataForUser) 회귀 가드.
//
// 목 DB 가 아니라 실제 SQLite 로 돌린다. 두 결함 다 '문장이 불렸는가'가 아니라 '스키마 제약과
// 남은 행 상태'가 본질이라, 호출 문자열을 세는 방식으로는 잡히지 않는다(Codex #646).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { runMigrations } from '../src/lib/migrations';
import { deleteSensitiveVoiceDataForUser } from '../src/lib/paid-voice-cleanup';

const DB_PATH = join(tmpdir(), `alarmtalk-cleanup-fk-${process.pid}.db`);
let db: Client;

async function reset() {
  for (const t of [
    'voice_profile_relationships',
    'alarms',
    'messages',
    'voice_uploads',
    'voice_profiles',
    'users',
  ]) {
    await db.execute(`DELETE FROM ${t}`);
  }
  await db.execute(
    `INSERT INTO users (id, google_id, email) VALUES
       ('sender', 'sender', 's@test.com'),
       ('recipient', 'recipient', 'r@test.com')`,
  );
}

beforeEach(async () => {
  if (!db) {
    for (const suffix of ['', '-shm', '-wal']) rmSync(`${DB_PATH}${suffix}`, { force: true });
    db = createClient({ url: `file:${DB_PATH}` });
    await runMigrations(db);
    // 운영에서 FK 가 켜져 있을 때의 동작을 재현한다 — 자식 행을 안 지우면 여기서 던진다.
    await db.execute('PRAGMA foreign_keys = ON');
  }
  await reset();
});

afterAll(() => {
  db?.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      rmSync(`${DB_PATH}${suffix}`, { force: true });
    } catch {
      /* 임시 파일이라 남아도 무해 */
    }
  }
});

describe('보관 만료 정리 — 자식 행 먼저', () => {
  it('공유 목소리에 붙은 호칭 행이 있어도 프로필 삭제가 끝까지 간다', async () => {
    await db.execute(
      `INSERT INTO voice_profiles (id, user_id, name, status) VALUES ('vp-1', 'sender', '내 목소리', 'ready')`,
    );
    // 공유받은 사람이 붙여 둔 호칭 — voice_profiles FK 를 건다.
    await db.execute(
      `INSERT INTO voice_profile_relationships (id, user_id, voice_profile_id, relationship_label)
       VALUES ('rel-1', 'recipient', 'vp-1', '아빠')`,
    );

    // 자식 행을 안 지우면 FK 로 여기서 던지고, 호출부(sweepPaidVoiceRetention)는
    // paid_voice_retention 을 못 지워 만료 처리가 매번 같은 자리에서 멈춘다.
    await deleteSensitiveVoiceDataForUser(db, 'sender', 'sender');

    const profiles = await db.execute(`SELECT id FROM voice_profiles`);
    const rels = await db.execute(`SELECT id FROM voice_profile_relationships`);
    expect(profiles.rows).toEqual([]);
    expect(rels.rows).toEqual([]);
  });

  it('남의 공유 목소리에 내가 붙인 호칭은 남긴다 (계정은 살아 있다)', async () => {
    await db.execute(
      `INSERT INTO voice_profiles (id, user_id, name, status) VALUES ('vp-other', 'recipient', '남의 목소리', 'ready')`,
    );
    await db.execute(
      `INSERT INTO voice_profile_relationships (id, user_id, voice_profile_id, relationship_label)
       VALUES ('rel-mine', 'sender', 'vp-other', '엄마')`,
    );

    await deleteSensitiveVoiceDataForUser(db, 'sender', 'sender');

    const rels = await db.execute(`SELECT id FROM voice_profile_relationships`);
    expect(rels.rows.map((r) => r.id)).toEqual(['rel-mine']);
  });
});

describe('보관 만료 정리 — 가족알람 음성 끊기', () => {
  it('수신자 메시지가 내 업로드 오브젝트를 가리키면 알람을 강등하고 URL 을 비운다', async () => {
    await db.execute(
      `INSERT INTO voice_profiles (id, user_id, name, status) VALUES ('vp-r', 'recipient', '수신자 목소리', 'ready')`,
    );
    await db.execute(
      `INSERT INTO voice_uploads (id, user_id, object_key, mime_type, size_bytes)
       VALUES ('up-1', 'sender', 'voices/sender/clip.m4a', 'audio/mp4', 100)`,
    );
    // POST /family/alarms/voice 가 만드는 모양: 메시지는 수신자 소유인데 audio_url 은 발신자 오브젝트.
    await db.execute(
      `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
       VALUES ('msg-1', 'recipient', 'vp-r', '일어나', 'voices/sender/clip.m4a', 'family-voice')`,
    );
    // 실제 POST /family/alarms/voice 행 모양 — user_id 는 발신자, target_user_id 가 수신자다.
    await db.execute(
      `INSERT INTO alarms (id, user_id, target_user_id, message_id, time, mode)
       VALUES ('al-1', 'sender', 'recipient', 'msg-1', '07:00', 'voice')`,
    );

    await deleteSensitiveVoiceDataForUser(db, 'sender', 'sender');

    const alarm = (await db.execute(`SELECT mode, message_id FROM alarms WHERE id = 'al-1'`))
      .rows[0];
    const message = (await db.execute(`SELECT audio_url FROM messages WHERE id = 'msg-1'`)).rows[0];
    // 오브젝트가 사라졌으니 서버도 '음성 있음'이라고 광고하면 안 된다.
    expect(alarm?.mode).toBe('sound-only');
    expect(alarm?.message_id).toBeNull();
    expect(message?.audio_url).toBeNull();
    // 수신자 데이터라 메시지 행 자체는 남는다.
    expect(message).toBeDefined();
  });

  /**
   * 이 스윕은 플랜 변경 3일 뒤에 돈다. 그때 강등되는 수신자는 이번 주기의 만료 대상이 아니라
   * 호출부의 푸시 목록에 없다 — 반환하지 않으면 이미 오디오를 캐시한 백그라운드 수신자가
   * 다음 동기화까지 지워진 녹음으로 계속 울린다(그사이 알람이 먼저 울릴 수 있다).
   */
  it('강등된 알람과 울리는 기기의 주인을 돌려준다 (알람 동기화 신호용)', async () => {
    await db.execute(
      `INSERT INTO voice_profiles (id, user_id, name, status) VALUES ('vp-r', 'recipient', '수신자 목소리', 'ready')`,
    );
    await db.execute(
      `INSERT INTO voice_uploads (id, user_id, object_key, mime_type, size_bytes)
       VALUES ('up-1', 'sender', 'voices/sender/clip.m4a', 'audio/mp4', 100)`,
    );
    await db.execute(
      `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
       VALUES ('msg-1', 'recipient', 'vp-r', '일어나', 'voices/sender/clip.m4a', 'family-voice')`,
    );
    // 실제 POST /family/alarms/voice 행 모양 — user_id 는 발신자, target_user_id 가 수신자다.
    await db.execute(
      `INSERT INTO alarms (id, user_id, target_user_id, message_id, time, mode)
       VALUES ('al-1', 'sender', 'recipient', 'msg-1', '07:00', 'voice')`,
    );

    const downgraded = await deleteSensitiveVoiceDataForUser(db, 'sender', 'sender');

    // 울리는 기기의 주인은 target_user_id(수신자)다 — user_id(발신자)를 보내면
    // 정작 캐시된 녹음으로 울리는 기기는 신호를 못 받는다.
    expect(downgraded).toEqual([{ alarmId: 'al-1', ownerUserId: 'recipient' }]);
  });

  it('내 업로드와 무관한 수신자 메시지는 건드리지 않는다', async () => {
    await db.execute(
      `INSERT INTO voice_profiles (id, user_id, name, status) VALUES ('vp-r', 'recipient', '수신자 목소리', 'ready')`,
    );
    await db.execute(
      `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
       VALUES ('msg-keep', 'recipient', 'vp-r', '일어나', 'voices/someone-else/clip.m4a', 'family-voice')`,
    );
    await db.execute(
      `INSERT INTO alarms (id, user_id, target_user_id, message_id, time, mode)
       VALUES ('al-keep', 'sender', 'recipient', 'msg-keep', '07:00', 'voice')`,
    );

    await deleteSensitiveVoiceDataForUser(db, 'sender', 'sender');

    const alarm = (await db.execute(`SELECT mode FROM alarms WHERE id = 'al-keep'`)).rows[0];
    const message = (await db.execute(`SELECT audio_url FROM messages WHERE id = 'msg-keep'`))
      .rows[0];
    expect(alarm?.mode).toBe('voice');
    expect(message?.audio_url).toBe('voices/someone-else/clip.m4a');
  });
});
