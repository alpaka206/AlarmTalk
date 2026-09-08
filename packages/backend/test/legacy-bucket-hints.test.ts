// `findLegacyBucketHints` — **버킷 없이 클립 하나만 물린 옛 알람**의 테마를 서버가 알려 준다.
//
// 그 행은 클라 재바인더 두 갈래 어디에도 안 걸린다(하나는 `bucketId` 를, 다른 하나는
// `voiceRandomPrompt` 를 요구하는데 둘 다 없다). 그래서 목소리를 갈아도 그 알람만
// **이름은 새 이름인데 소리는 옛 목소리**로 영원히 운다. 무엇으로 갈아탈지는 서버가
// 아는 값이라(그 알람이 문 message 의 `category`) 매니페스트에 실어 보낸다.
//
// 실제 libsql 에 마이그레이션을 올리고 돌린다 — 이 쿼리는 **SQL 의 의미**가 전부라
// 목 DB 로는 아무것도 검증되지 않는다.
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { runMigrations } from '../src/lib/migrations';
import { findLegacyBucketHints } from '../src/lib/stock-clips';

const DB_PATH = join(tmpdir(), 'alarmtalk-legacy-bucket-hints.db');
for (const suffix of ['', '-shm', '-wal']) rmSync(`${DB_PATH}${suffix}`, { force: true });
const db: Client = createClient({ url: `file:${DB_PATH}` });

const ME = '21000000-0000-4000-9000-000000000001';
const OTHER = '21000000-0000-4000-9000-000000000002';
const SYSTEM_VOICE = '21000000-0000-4000-9000-000000000101';
const CLONE_VOICE = '21000000-0000-4000-9000-000000000102';

async function addMessage(id: string, voice: string, category: string, language = 'ko') {
  await db.execute({
    sql: `INSERT INTO messages
          (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json,
           category, language, variant, is_preset, audio_url)
          VALUES (?, ?, ?, '문구', '문구', '[]', ?, ?, 0, 1, 'r2://x/x.mp3')`,
    args: [id, ME, voice, category, language],
  });
}

async function addAlarm(id: string, user: string, messageId: string, bucketId: string | null) {
  await db.execute({
    sql: `INSERT INTO alarms (id, user_id, message_id, time, mode, bucket_id)
          VALUES (?, ?, ?, '07:00', 'tts', ?)`,
    args: [id, user, messageId, bucketId],
  });
}

beforeAll(async () => {
  await runMigrations(db);
  for (const [id, email] of [[ME, 'me@test'], [OTHER, 'other@test']] as const) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO users (id, google_id, email) VALUES (?, ?, ?)`,
      args: [id, id, email],
    });
  }
  for (const [id, isSystem] of [[SYSTEM_VOICE, 1], [CLONE_VOICE, 0]] as const) {
    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, status, is_system)
            VALUES (?, ?, 'v', 'ready', ?)`,
      args: [id, ME, isSystem],
    });
  }

  await addMessage('msg-weather', SYSTEM_VOICE, 'weather');
  await addMessage('msg-greeting', SYSTEM_VOICE, 'greeting');
  await addMessage('msg-clone', CLONE_VOICE, 'cheer');
  await addMessage('msg-med-ja', SYSTEM_VOICE, 'medication', 'ja');

  await addAlarm('legacy-null', ME, 'msg-weather', null);      // ← 힌트 대상
  await addAlarm('legacy-blank', ME, 'msg-med-ja', '   ');     // ← 공백도 '없음' 이다
  await addAlarm('has-bucket', ME, 'msg-weather', 'weather');  // 이미 안다
  await addAlarm('greeting-alarm', ME, 'msg-greeting', null);  // greeting 은 버킷이 아니다
  await addAlarm('clone-alarm', ME, 'msg-clone', null);        // 시스템 클립이 아니다
  await addAlarm('someone-else', OTHER, 'msg-weather', null);  // 남의 알람
});

describe('findLegacyBucketHints — 은퇴한 시스템 스톡도 함께 준다', () => {
  // ⚠ 서버 알람 행만 보면 **아직 서버에 안 올라간 알람**(LOCAL_ONLY·FAILED)이 힌트를
  //   못 받아 영영 옛 목소리로 운다(리뷰 15차). 그 알람이 가리키는 집합이 정확히
  //   '은퇴한 시스템 스톡' 이라 그걸 통째로 준다.
  beforeAll(async () => {
    await addMessage('msg-retired-cheer', SYSTEM_VOICE, 'cheer');
    await addMessage('msg-retired-greeting', SYSTEM_VOICE, 'greeting');
    await addMessage('msg-retired-clone', CLONE_VOICE, 'weather');
    for (const id of ['msg-retired-cheer', 'msg-retired-greeting', 'msg-retired-clone']) {
      await db.execute({
        sql: `UPDATE messages SET retired_at = datetime('now') WHERE id = ?`,
        args: [id],
      });
    }
  });

  it('알람이 하나도 안 가리켜도 은퇴한 시스템 버킷 클립은 힌트로 나온다', async () => {
    const ids = (await findLegacyBucketHints(db, ME)).map((h) => h.messageId);
    expect(ids).toContain('msg-retired-cheer');
  });

  it('은퇴했어도 `greeting` 과 클론은 주지 않는다', async () => {
    const ids = (await findLegacyBucketHints(db, ME)).map((h) => h.messageId);
    // greeting 은 버킷이 아니다 — 주면 앱이 `bucketId` 에 적어 저장이 400 이 된다.
    expect(ids).not.toContain('msg-retired-greeting');
    // 이번 교체는 기본 목소리만 건드린다.
    expect(ids).not.toContain('msg-retired-clone');
  });

  it('은퇴 갈래는 사용자를 가리지 않는다 — 시스템 카탈로그라 누구에게나 같다', async () => {
    // 개인정보가 아니다(소유자가 시스템 라이브러리 계정). 대신 ① 갈래는 여전히 본인
    // 알람으로만 스코프된다 — 아래 IDOR 테스트가 그걸 지킨다.
    const mine = (await findLegacyBucketHints(db, ME)).map((h) => h.messageId);
    const theirs = (await findLegacyBucketHints(db, OTHER)).map((h) => h.messageId);
    expect(theirs).toContain('msg-retired-cheer');
    expect(mine).toContain('msg-retired-cheer');
    // 그래도 남의 **알람**에서 온 것은 안 섞인다.
    expect(theirs).not.toContain('msg-med-ja');
  });
});

describe('findLegacyBucketHints', () => {
  it('버킷 없는 내 알람의 테마만 돌려준다', async () => {
    const hints = await findLegacyBucketHints(db, ME);
    const byMessage = Object.fromEntries(hints.map((h) => [h.messageId, h]));

    expect(byMessage['msg-weather']).toEqual({
      messageId: 'msg-weather',
      category: 'weather',
      language: 'ko',
    });
    // 공백만 든 `bucket_id` 도 '없음' 이다 — 옛 행이 실제로 그런 값을 들고 있다.
    expect(byMessage['msg-med-ja']).toEqual({
      messageId: 'msg-med-ja',
      category: 'medication',
      language: 'ja',
    });
    // ⚠ 정확한 개수로 고정하지 않는다 — 은퇴 갈래(위 describe)가 같은 응답에 섞이므로
    //   총량은 이 테스트가 지키려는 것이 아니다. 지키는 것은 **무엇이 들어오고 무엇이
    //   안 들어오는가** 다.
    expect(byMessage['msg-clone']).toBeUndefined();
    expect(byMessage['msg-greeting']).toBeUndefined();
  });

  it('`greeting` 은 힌트로 주지 않는다 — 버킷이 아니다', async () => {
    // 목소리 미리듣기용 자기소개라 알람 테마가 될 수 없다. 힌트로 주면 앱이 그 값을
    // `bucketId` 에 적고, 그 알람은 저장할 때마다 `INVALID_BUCKET_ID` 로 400 을 맞는다.
    const hints = await findLegacyBucketHints(db, ME);
    expect(hints.map((h) => h.category)).not.toContain('greeting');
    expect(hints.map((h) => h.messageId)).not.toContain('msg-greeting');
  });

  it('클론(등록) 목소리 클립은 대상이 아니다', async () => {
    // 이번 교체는 **기본 목소리**만 건드린다. 클론은 소유자가 재등록할 때 갱신된다.
    const hints = await findLegacyBucketHints(db, ME);
    expect(hints.map((h) => h.messageId)).not.toContain('msg-clone');
  });

  it('남의 알람은 절대 새지 않는다', async () => {
    // ⚠ IDOR. 이 함수는 id 를 받지 않고 호출자 본인으로만 스코프한다.
    const mine = (await findLegacyBucketHints(db, ME)).map((h) => h.messageId);
    const theirs = (await findLegacyBucketHints(db, OTHER)).map((h) => h.messageId);
    // 같은 message 를 물고 있어도 **알람 갈래**는 각자 자기 것으로만 답한다.
    expect(theirs).toContain('msg-weather');   // 남의 알람이 가리키는 것
    expect(theirs).not.toContain('msg-med-ja'); // 내 알람만 가리키는 것 — 새면 안 된다
    expect(mine).toContain('msg-med-ja');

    // 알람이 하나도 없는 계정에는 알람 갈래가 아무것도 안 붙는다(은퇴 갈래만 남는다).
    const nobody = (await findLegacyBucketHints(db, 'no-such-user')).map((h) => h.messageId);
    expect(nobody).not.toContain('msg-med-ja');
    expect(nobody).not.toContain('msg-weather');
  });
});
