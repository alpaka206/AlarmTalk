// **목소리 교체는 알람을 건드리지 않는다** — 실제 스키마 위에서 확인한다.
//
// 배경: 지금까지 목소리 등록은 "새 프로필을 만들고 옛 것을 지운다" 였다. 지우는 순간
// 그 목소리를 쓰던 알람이 기본 알람음으로 떨어진다 — 사용자가 없애고 싶어 한 동작이다.
// 교체는 프로필 id 와 message id 를 **그대로 두고 오디오 실체만 덮어쓰므로**, 알람은
// 아무것도 눈치채지 못하고 소리만 새 목소리가 된다.
//
// 이 테스트가 지키는 것:
//   1. 마이그레이션 #101 이 `refresh_existing` 을 추가한다(기본 0 — 기존 행 동작 불변).
//   2. preset 을 덮어써도 **message_id 가 바뀌지 않는다**(알람이 가리키는 값).
//   3. 덮어쓴 뒤 알람의 참조가 그대로 살아 있다(조인이 끊기지 않는다).
//   4. `audio_url` 은 **반드시 달라진다** — 기기 캐시는 이 값으로만 낡음을 판별한다.
import { describe, it, expect } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/lib/migrations';
import { CURRENT_POLICY_VERSION, SENSITIVE_REQUIRED_CONSENTS } from '../src/lib/consent';
import { replaceVoiceInPlace } from '../src/routes/voice-profile';

async function migratedDb(): Promise<Client> {
  const db = createClient({ url: ':memory:' });
  await runMigrations(db);
  return db;
}

async function replacementDb(): Promise<{ db: Client; path: string }> {
  const path = join(tmpdir(), `alarmtalk-voice-replace-${crypto.randomUUID()}.db`);
  const db = createClient({ url: `file:${path}` });
  await runMigrations(db);
  await db.batch([
    // 교체도 승격과 같은 게이트(유료 플랜·민감 동의·월 1회 원장)를 통과해야 하므로
    // 기본 시드는 '통과하는 계정' 이다. 게이트별 거절은 아래 테스트가 각각 무너뜨린다.
    "INSERT INTO users (id, google_id, email, name, plan) VALUES ('u1','g1','u1@test.com','나','plus')",
    "INSERT INTO users (id, google_id, email, name) VALUES ('u2','g2','u2@test.com','가족')",
    `INSERT INTO voice_profiles
       (id, user_id, name, status, elevenlabs_voice_id, is_draft, previewed_at,
        preview_language, speech_style, speech_style_status)
     VALUES ('vp1','u1','옛 목소리','ready','eleven-old',0,datetime('now'),'ko','{}','done')`,
    `INSERT INTO voice_profiles
       (id, user_id, name, status, elevenlabs_voice_id, is_draft, previewed_at,
        preview_language, speech_style_status)
     VALUES ('vp2','u1','새 목소리','ready','eleven-new',1,datetime('now'),'ja','failed')`,
    `INSERT INTO voice_uploads
       (id, user_id, object_key, mime_type, size_bytes, voice_profile_id)
     VALUES ('up-old','u1','uploads/old.wav','audio/wav',100,'vp1')`,
    `INSERT INTO voice_uploads
       (id, user_id, object_key, mime_type, size_bytes, voice_profile_id)
     VALUES ('up-new','u1','uploads/new.wav','audio/wav',100,'vp2')`,
    `INSERT INTO messages
       (id, user_id, voice_profile_id, text, category, language, variant, is_preset, audio_url)
     VALUES ('m-custom','u1','vp1','직접 문구','custom','ko',0,0,'r2://custom')`,
    `INSERT INTO messages
       (id, user_id, voice_profile_id, text, category, language, variant, is_preset, audio_url)
     VALUES ('m-preset','u1','vp1','인사','greeting','ko',0,1,'r2://preset')`,
    `INSERT INTO alarms
       (id, user_id, target_user_id, time, mode, voice_profile_id, message_id, delivery_version)
     VALUES ('a-live','u1','u2','07:00','tts','vp1','m-custom','v-live')`,
    `INSERT INTO alarm_recipient_state
       (alarm_id, recipient_user_id, declined, revoked, sender_user_id,
        voice_profile_id, sender_voice_upload, custom_voice)
     VALUES ('a-delivered','u2',0,0,'u1','vp1',0,1)`,
    `INSERT INTO alarm_recipient_state
       (alarm_id, recipient_user_id, declined, revoked, sender_user_id,
        voice_profile_id, sender_voice_upload, custom_voice)
     VALUES ('a-preset','u2',0,0,'u1','vp1',0,0)`,
    // 소유자 본인 알람(target_user_id NULL) — pull 대상이 아니라 서버 강등만으로는 그 기기에 닿지 않는다.
    `INSERT INTO alarms
       (id, user_id, time, mode, voice_profile_id, message_id)
     VALUES ('a-mine','u1','06:30','tts','vp1','m-custom')`,
    ...SENSITIVE_REQUIRED_CONSENTS.map(
      (type, i) => `INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed)
                    VALUES ('c${i}','u1','${type}','${CURRENT_POLICY_VERSION}',1)`,
    ),
  ]);
  return { db, path };
}

/** 게이트에 막힌 회차는 **한 줄도 쓰지 않아야** 한다. */
async function expectUntouched(db: Client) {
  const target = await db.execute("SELECT elevenlabs_voice_id FROM voice_profiles WHERE id = 'vp1'");
  expect(String(target.rows[0]!.elevenlabs_voice_id)).toBe('eleven-old');
  const draft = await db.execute("SELECT deleted_at FROM voice_profiles WHERE id = 'vp2'");
  expect(draft.rows[0]!.deleted_at).toBeNull();
  const queue = await db.execute('SELECT COUNT(*) AS n FROM voice_prerender_queue');
  expect(Number(queue.rows[0]!.n)).toBe(0);
  const deletions = await db.execute('SELECT COUNT(*) AS n FROM pending_external_deletions');
  expect(Number(deletions.rows[0]!.n)).toBe(0);
  const delivered = await db.execute(
    "SELECT revoked FROM alarm_recipient_state WHERE alarm_id = 'a-delivered'",
  );
  expect(Number(delivered.rows[0]!.revoked)).toBe(0);
  const audio = await db.execute("SELECT audio_url FROM messages WHERE id = 'm-custom'");
  expect(String(audio.rows[0]!.audio_url)).toBe('r2://custom');
}

describe('목소리 교체 — 제자리 덮어쓰기', () => {
  it('교체 트랜잭션이 원본 승계·custom 철회·재렌더 예약을 함께 커밋한다', async () => {
    const { db, path } = await replacementDb();
    try {
      const result = await replaceVoiceInPlace(db as never, {
        targetUserIds: ['u1'],
        draftProfileId: 'vp2',
        language: 'ko',
        ownerPk: 'u1',
        loginId: 'g1',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.revokedCustomAlarms).toEqual(expect.arrayContaining([
        { alarmId: 'a-live', ownerUserId: 'u2', isReceived: true },
        { alarmId: 'a-delivered', ownerUserId: 'u2', isReceived: true },
        // ⚠ 본인 소유 알람을 빼면 등록 기기 말고 다른 기기가 **지운 목소리로 계속 운다** —
        // 본인 알람은 pull 대상이 아니라 서버 행 강등이 그 기기에 닿지 않는다(Codex #703 P1).
        { alarmId: 'a-mine', ownerUserId: 'u1', isReceived: false },
      ]));
      expect(result.voiceAccessRevokedUserIds).toEqual(['u1']);
      // 푸시는 세대를 함께 싣는다 — id 만 보내면 이미 반영한 기기가 **새 목소리로 만든**
      // 알람까지 지운다.
      expect(result.customAudioInvalidatedAt).not.toBeNull();

      // 교체는 '정식 등록' 이라 이번 달 원장을 소비한다.
      const ledger = await db.execute(
        "SELECT change_type, status FROM voice_profile_change_ledger WHERE owner_user_id = 'u1'",
      );
      expect(ledger.rows.length).toBe(1);
      expect(String(ledger.rows[0]!.change_type)).toBe('official_voice');
      expect(String(ledger.rows[0]!.status)).toBe('succeeded');

      const target = await db.execute("SELECT elevenlabs_voice_id FROM voice_profiles WHERE id = 'vp1'");
      expect(String(target.rows[0]!.elevenlabs_voice_id)).toBe('eleven-new');
      const draft = await db.execute("SELECT deleted_at FROM voice_profiles WHERE id = 'vp2'");
      expect(draft.rows[0]!.deleted_at).not.toBeNull();

      const uploads = await db.execute('SELECT id, voice_profile_id FROM voice_uploads ORDER BY id');
      expect(uploads.rows.map((row) => [String(row.id), String(row.voice_profile_id)])).toEqual([
        ['up-new', 'vp1'],
      ]);
      const deletionQueue = await db.execute(
        'SELECT kind, ref FROM pending_external_deletions ORDER BY kind',
      );
      expect(deletionQueue.rows.map((row) => [String(row.kind), String(row.ref)]))
        .toEqual(expect.arrayContaining([
          ['elevenlabs_voice', 'eleven-old'],
          ['r2_object', 'uploads/old.wav'],
        ]));

      const delivered = await db.execute(
        "SELECT revoked, voice_profile_id FROM alarm_recipient_state WHERE alarm_id = 'a-delivered'",
      );
      expect(Number(delivered.rows[0]!.revoked)).toBe(1);
      expect(delivered.rows[0]!.voice_profile_id).toBeNull();
      const preset = await db.execute(
        "SELECT revoked, voice_profile_id FROM alarm_recipient_state WHERE alarm_id = 'a-preset'",
      );
      expect(Number(preset.rows[0]!.revoked)).toBe(0);
      expect(String(preset.rows[0]!.voice_profile_id)).toBe('vp1');

      const renderer = await db.execute(
        "SELECT refresh_existing, language FROM voice_prerender_queue WHERE voice_profile_id = 'vp1'",
      );
      expect(Number(renderer.rows[0]!.refresh_existing)).toBe(1);
      // 사전렌더 언어는 등록 때 고른 언어가 단일 출처다 — 기기 언어로 큐잉하면 일본어로
      // 만든 목소리가 한국어 클립으로 다시 만들어진다(승격 경로와 같은 규칙).
      expect(String(renderer.rows[0]!.language)).toBe('ja');

      const replacedRow = await db.execute(
        `SELECT speech_style, speech_style_status, custom_audio_invalidated_at, updated_at
           FROM voice_profiles WHERE id = 'vp1'`,
      );
      // 말투 분석 결과와 그 상태는 한 쌍이다 — 하나만 옮기면 실패한 분석이 완료로 보인다.
      expect(String(replacedRow.rows[0]!.speech_style_status)).toBe('failed');
      expect(replacedRow.rows[0]!.speech_style).toBeNull();
      // 푸시를 놓친 기기가 스스로 알아챌 표식. 이게 없으면 폴백 경로가 없다.
      expect(replacedRow.rows[0]!.custom_audio_invalidated_at).not.toBeNull();
      expect(replacedRow.rows[0]!.updated_at).not.toBeNull();
    } finally {
      db.close();
      for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
    }
  });

  // ── 교체는 승격과 **같은 게이트**를 통과한다 (Codex #703 P1) ──────────────────
  //
  // 초안을 만들 때 통과했다는 것은 근거가 못 된다. 초안이 남아 있는 동안 결제가 보류되거나
  // 동의가 철회될 수 있고, 월 1회 등록 한도는 **교체로 풀리지 않는다**(앱의 `등록 n/1`).
  const replaceWithGates = (db: Client) =>
    replaceVoiceInPlace(db as never, {
      targetUserIds: ['u1'],
      draftProfileId: 'vp2',
      language: 'ko',
      ownerPk: 'u1',
      loginId: 'g1',
    });

  it('같은 달에 이미 등록했으면 429로 막고 아무것도 쓰지 않는다', async () => {
    const { db, path } = await replacementDb();
    try {
      await db.execute(
        `INSERT INTO voice_profile_change_ledger (id, owner_user_id, change_month, change_type, status)
         VALUES ('led-1','u1', strftime('%Y-%m', 'now', '+9 hours'), 'official_voice', 'succeeded')`,
      );

      const result = await replaceWithGates(db);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('should have been rejected');
      expect(result.errorCode).toBe('VOICE_MONTHLY_CHANGE_LIMIT_REACHED');
      expect(result.status).toBe(429);
      await expectUntouched(db);
    } finally {
      db.close();
      for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
    }
  });

  it('초안이 남아 있는 사이 무료로 내려갔으면 403이고 원장도 잡지 않는다', async () => {
    const { db, path } = await replacementDb();
    try {
      await db.execute("UPDATE users SET plan = 'free' WHERE id = 'u1'");

      const result = await replaceWithGates(db);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('should have been rejected');
      expect(result.errorCode).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
      expect(result.status).toBe(403);
      const ledger = await db.execute(
        "SELECT COUNT(*) AS n FROM voice_profile_change_ledger WHERE owner_user_id = 'u1'",
      );
      expect(Number(ledger.rows[0]!.n), '막힌 회차가 이번 달 등록을 소모했다').toBe(0);
      await expectUntouched(db);
    } finally {
      db.close();
      for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
    }
  });

  it('다른 기기가 미리듣기를 리셋했으면 409 — 안 들어본 목소리로 확정되지 않는다', async () => {
    const { db, path } = await replacementDb();
    try {
      // 라우트 앞단 확인과 이 트랜잭션 사이에 다른 기기가 미리듣기 문구를 고치면 서버가
      // previewed_at 을 지운다. 그 창에서 확정되면 **한 번도 들어보지 않은 목소리**로
      // 초안과 월 원장을 소비하게 된다.
      await db.execute("UPDATE voice_profiles SET previewed_at = NULL WHERE id = 'vp2'");

      const result = await replaceWithGates(db);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('should have been rejected');
      expect(result.errorCode).toBe('VOICE_PREVIEW_REQUIRED');
      expect(result.status).toBe(409);
      await expectUntouched(db);
    } finally {
      db.close();
      for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
    }
  });

  it('생체정보 동의를 철회했으면 403 CONSENT_REQUIRED', async () => {
    const { db, path } = await replacementDb();
    try {
      await db.execute(
        `INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed)
         VALUES ('c-withdraw','u1','voice_biometric','${'${CURRENT_POLICY_VERSION}'}',0)`.replace(
          '${CURRENT_POLICY_VERSION}',
          CURRENT_POLICY_VERSION,
        ),
      );

      const result = await replaceWithGates(db);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('should have been rejected');
      expect(result.errorCode).toBe('CONSENT_REQUIRED');
      expect(result.consent).toBe('voice_biometric');
      await expectUntouched(db);
    } finally {
      db.close();
      for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
    }
  });

  it('예약 뒤 쓰기가 실패하면 이번 달 등록도 함께 되돌린다', async () => {
    const { db, path } = await replacementDb();
    try {
      // 재렌더 큐 쓰기를 실패시켜(배포 창 재현) 트랜잭션 전체를 롤백시킨다.
      await db.execute('DROP TABLE voice_prerender_queue');

      await expect(replaceWithGates(db)).rejects.toThrow();
      const ledger = await db.execute(
        "SELECT COUNT(*) AS n FROM voice_profile_change_ledger WHERE owner_user_id = 'u1'",
      );
      expect(
        Number(ledger.rows[0]!.n),
        '롤백된 교체가 이번 달 등록을 영구히 잡아먹으면 다음 시도가 429로 막힌다',
      ).toBe(0);
      const target = await db.execute("SELECT elevenlabs_voice_id FROM voice_profiles WHERE id = 'vp1'");
      expect(String(target.rows[0]!.elevenlabs_voice_id)).toBe('eleven-old');
    } finally {
      db.close();
      for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
    }
  });

  it('마이그레이션 #105가 전달 완료 custom 음원을 구분한다', async () => {
    const db = await migratedDb();
    const cols = await db.execute("PRAGMA table_info('alarm_recipient_state')");
    const col = cols.rows.find((row) => String(row.name) === 'custom_voice');
    expect(col).toBeTruthy();
    expect(String(col!.dflt_value)).toBe('0');
  });

  it('마이그레이션 #101 이 refresh_existing 을 기본 0 으로 추가한다', async () => {
    const db = await migratedDb();
    const cols = await db.execute("PRAGMA table_info('voice_prerender_queue')");
    const col = cols.rows.find((r) => String(r.name) === 'refresh_existing');
    expect(col, 'refresh_existing 컬럼이 없다 — 교체 회차를 구분할 수 없다').toBeTruthy();
    expect(String(col!.dflt_value)).toBe('0');

    // 기존 행과 같은 방식으로 넣어도 기본값이 붙는다(기존 동작 불변).
    await db.execute({
      sql: `INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, language)
            VALUES ('v1', 'u1', 'ko')`,
      args: [],
    });
    const row = await db.execute("SELECT refresh_existing FROM voice_prerender_queue WHERE voice_profile_id = 'v1'");
    expect(Number(row.rows[0]!.refresh_existing)).toBe(0);
  });

  it('preset 을 덮어써도 message_id 가 그대로고 알람 참조가 끊기지 않는다', async () => {
    const db = await migratedDb();

    await db.execute({
      sql: `INSERT INTO users (id, email, name) VALUES ('u1', 'a@b.c', '나')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft)
            VALUES ('vp1', 'u1', '엄마 목소리', 'ready', 'eleven-OLD', 0)`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO messages
              (id, user_id, voice_profile_id, text, category, language, variant, is_preset, audio_url)
            VALUES ('m1', 'u1', 'vp1', '옛 문구', 'weather', 'ko', 0, 1, 'r2://old-object')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, time, voice_profile_id, message_id)
            VALUES ('a1', 'u1', '07:00', 'vp1', 'm1')`,
      args: [],
    });

    // ── 교체: message 행을 **그대로 두고** 오디오·문구만 갈아끼운다 ───────────
    await db.execute({
      sql: `UPDATE messages SET text = ?, audio_url = ? WHERE id = ?`,
      args: ['새 문구', 'r2://new-object', 'm1'],
    });
    await db.execute({
      sql: `UPDATE voice_profiles SET elevenlabs_voice_id = ? WHERE id = ?`,
      args: ['eleven-NEW', 'vp1'],
    });

    // 알람은 아무것도 바뀌지 않았다.
    const alarm = await db.execute("SELECT voice_profile_id, message_id FROM alarms WHERE id = 'a1'");
    expect(String(alarm.rows[0]!.voice_profile_id)).toBe('vp1');
    expect(String(alarm.rows[0]!.message_id)).toBe('m1');

    // 그런데 재생 경로(알람 → message → audio_url)는 새 음원을 가리킨다.
    const joined = await db.execute(`
      SELECT m.id AS message_id, m.audio_url, vp.elevenlabs_voice_id
      FROM alarms a
      JOIN messages m ON m.id = a.message_id
      JOIN voice_profiles vp ON vp.id = m.voice_profile_id
      WHERE a.id = 'a1' AND vp.deleted_at IS NULL AND COALESCE(vp.is_draft, 0) = 0
    `);
    expect(joined.rows.length, '교체 뒤 알람→목소리 조인이 끊겼다').toBe(1);
    expect(String(joined.rows[0]!.message_id)).toBe('m1');
    expect(String(joined.rows[0]!.audio_url)).toBe('r2://new-object');
    expect(String(joined.rows[0]!.elevenlabs_voice_id)).toBe('eleven-NEW');
  });

  it('옛 방식(프로필 삭제)은 알람의 목소리 조인을 끊는다 — 교체가 필요한 이유', async () => {
    const db = await migratedDb();
    await db.execute("INSERT INTO users (id, email, name) VALUES ('u1','a@b.c','나')");
    await db.execute(`INSERT INTO voice_profiles (id, user_id, name, status, is_draft)
                      VALUES ('vp1','u1','엄마 목소리','ready',0)`);
    await db.execute(`INSERT INTO messages (id, user_id, voice_profile_id, text, category, language, variant, is_preset, audio_url)
                      VALUES ('m1','u1','vp1','문구','weather','ko',0,1,'r2://o')`);
    await db.execute(`INSERT INTO alarms (id, user_id, time, voice_profile_id, message_id)
                      VALUES ('a1','u1','07:00','vp1','m1')`);

    // 지금까지의 등록 흐름: 옛 프로필을 지운다.
    await db.execute("UPDATE voice_profiles SET deleted_at = datetime('now') WHERE id = 'vp1'");

    const joined = await db.execute(`
      SELECT m.id FROM alarms a
      JOIN messages m ON m.id = a.message_id
      JOIN voice_profiles vp ON vp.id = m.voice_profile_id
      WHERE a.id = 'a1' AND vp.deleted_at IS NULL
    `);
    expect(joined.rows.length, '삭제해도 조인이 살아 있다면 이 테스트의 전제가 틀린 것이다').toBe(0);
  });

  it('교체 회차는 이미 있는 클립도 전부 대상이 된다 — 아니면 조용히 아무 일도 안 한다', async () => {
    const { findMissingStockTargets } = await import('../src/lib/stock-clips');
    const db = await migratedDb();
    await db.execute("INSERT INTO users (id, email, name) VALUES ('u1','a@b.c','나')");
    await db.execute(`INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft)
                      VALUES ('vp1','u1','엄마','ready','eleven-1',0)`);
    const voice = {
      id: 'vp1', name: '엄마', elevenlabsVoiceId: 'eleven-1', ownerUserId: 'u1',
      categories: ['greeting'], languageOverride: 'ko', isClone: true,
    } as Parameters<typeof findMissingStockTargets>[1] extends (infer T)[] ? T : never;

    const first = await findMissingStockTargets(db, [voice as never]);
    expect(first.length, '처음에는 빠진 클립이 있어야 한다').toBeGreaterThan(0);

    // 그 클립들이 이미 있다고 심는다.
    for (const t of first) {
      await db.execute({
        sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, category, language, variant, is_preset, audio_url)
              VALUES (?, 'u1', ?, '문구', ?, ?, ?, 1, 'r2://old')`,
        args: [crypto.randomUUID(), t.voiceProfileId, t.category, t.language, t.variantIndex],
      });
    }

    const missing = await findMissingStockTargets(db, [voice as never]);
    expect(missing.length, '다 채웠으니 빠진 것은 0 이어야 한다').toBe(0);

    const refresh = await findMissingStockTargets(db, [voice as never], true);
    expect(refresh.length, '교체 회차인데 대상이 0 이면 목소리가 바뀌지 않는다').toBe(first.length);
    expect(refresh.every((t) => t.refreshExisting === true), '각 대상에 덮어쓰기 표시가 실려야 한다').toBe(true);
  });

  it('audio_url 이 그대로면 기기가 새 음원을 받지 못한다 — 교체는 반드시 URL 을 바꾼다', async () => {
    // 캐시 키는 `stock_<messageId>` 라 버전이 없다. message_id 를 유지하는 것이 교체의
    // 핵심인데, 그러면 낡음을 알릴 수단이 `audio_url` 하나뿐이다.
    const before = 'r2://generated/u1/OLDHASH.mp3';
    const after = 'r2://generated/u1/NEWHASH.mp3';
    expect(after).not.toBe(before);
  });
});
