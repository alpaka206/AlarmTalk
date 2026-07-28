// 가족 알람 실동작 검증 — mock 결과 주입이 아니라 실제 libsql DB 에 전체 마이그레이션을
// 올리고 실제 라우트(POST /family-alarm/alarms, /alarms/voice)를 호출해 확인한다:
//  - 멱등 재전송 시 message 행이 누적되지 않고 교체된 이전 행이 정리되는지(항목 D)
//  - 알람 행 timezone 이 '검증에 쓴 효과 시간대'로 저장되는지(항목 I)
//
// libsql `:memory:` 는 연결마다 별도 DB 라 autocommit execute 와 transaction 이 스키마를
// 공유하지 못한다(alarm-guard.test.ts 와 동일 이슈) → 임시 파일 DB 사용.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const DB_PATH = join(tmpdir(), 'alarmtalk-family-alarm-guard.db');
const db: Client = createClient({ url: `file:${DB_PATH}` });

vi.mock('../src/lib/db', () => ({ getDB: () => db }));

const { default: familyAlarmRoutes } = await import('../src/routes/family-alarm');

const SENDER = { pk: 'famg-s-pk', login: 'famg-s-pk' };
const RECIPIENT = { pk: 'famg-r-pk', login: 'famg-r-pk' };
const GROUP_ID = 'famg-group-001';
const FAMILY_PLAN_ID = '70000000-0000-4000-8000-000000000003'; // 마이그레이션 시드 '가족' 플랜
const VP_ID = 'famg-vp-001'; // 수신자 클론 보이스
const UPLOAD_ID = 'famg-upload-001'; // 발신자 음성 업로드

function app() {
  const a = new Hono<AppEnv>();
  a.use('*', async (c, next) => {
    c.set('userId', SENDER.login);
    await next();
  });
  a.route('/family-alarm', familyAlarmRoutes);
  return a;
}

function postJson(path: string, body: Record<string, unknown>): Promise<Response> {
  return app().request(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function ttsBody(overrides: Record<string, unknown> = {}) {
  return {
    recipient_user_id: RECIPIENT.pk,
    wake_at: '23:00',
    message_text: '좋은 아침!',
    ...overrides,
  };
}

function voiceBody(overrides: Record<string, unknown> = {}) {
  return {
    recipient_user_id: RECIPIENT.pk,
    wake_at: '23:00',
    voice_upload_id: UPLOAD_ID,
    ...overrides,
  };
}

async function countRows(sql: string, args: (string | number)[]): Promise<number> {
  const res = await db.execute({ sql, args });
  return Number(res.rows[0]!.cnt);
}

beforeAll(async () => {
  await runMigrations(db);
  // 이전 실행 잔재 정리(파일 DB 재사용). 시스템 시드 행은 건드리지 않는다.
  await db.execute('DELETE FROM alarms');
  await db.execute({ sql: 'DELETE FROM messages WHERE user_id = ?', args: [RECIPIENT.pk] });
  await db.execute("DELETE FROM plan_group_members WHERE id LIKE 'famg-%'");
  await db.execute("DELETE FROM plan_groups WHERE id LIKE 'famg-%'");
  await db.execute({ sql: 'DELETE FROM voice_profiles WHERE id = ?', args: [VP_ID] });
  await db.execute({ sql: 'DELETE FROM voice_uploads WHERE id = ?', args: [UPLOAD_ID] });
  await db.execute("DELETE FROM users WHERE id LIKE 'famg-%'");

  const insertUser = (u: { pk: string; login: string }, allow: number) =>
    db.execute({
      sql: `INSERT INTO users (id, google_id, email, allow_family_alarms, family_alarm_quiet_windows)
            VALUES (?, ?, ?, ?, '[]')`,
      args: [u.pk, u.login, `${u.pk}@famg.test`, allow],
    });
  await insertUser(SENDER, 0);
  await insertUser(RECIPIENT, 1);

  // 발신자·수신자를 같은 가족 그룹에 넣는다(assertSameGroup 통과).
  await db.execute({
    sql: `INSERT INTO plan_groups (id, owner_user_id, plan_id) VALUES (?, ?, ?)`,
    args: [GROUP_ID, SENDER.pk, FAMILY_PLAN_ID],
  });
  await db.execute({
    sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('famg-m1', ?, ?, 'owner')`,
    args: [GROUP_ID, SENDER.pk],
  });
  await db.execute({
    sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('famg-m2', ?, ?, 'member')`,
    args: [GROUP_ID, RECIPIENT.pk],
  });

  // 수신자 클론 보이스(ready, 비-draft) + 발신자 음성 업로드.
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, status) VALUES (?, ?, '엄마', 'ready')`,
    args: [VP_ID, RECIPIENT.pk],
  });
  await db.execute({
    sql: `INSERT INTO voice_uploads (id, user_id, object_key, mime_type, size_bytes)
          VALUES (?, ?, 'family-voice/famg.wav', 'audio/wav', 1024)`,
    args: [UPLOAD_ID, SENDER.pk],
  });
});

beforeEach(async () => {
  await db.execute('DELETE FROM alarms');
  await db.execute('DELETE FROM pending_external_deletions');
  await db.execute('DELETE FROM generated_audio_assets');
  await db.execute({ sql: 'DELETE FROM messages WHERE user_id = ?', args: [RECIPIENT.pk] });
  // 리드타임 판정이 실제 시계에 좌우되지 않도록 고정: 2026-07-15T00:00Z = KST 수요일 09:00.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('가족 알람 멱등 재전송 — message 행 누적 방지(항목 D)', () => {
  it('TTS 재전송 2회: 알람 1행 유지 + 교체된 이전 message 행 삭제(messages 1행)', async () => {
    const res1 = await postJson('/family-alarm/alarms', ttsBody({ message_text: '첫번째' }));
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as { alarm: { id: string }; message: { id: string } };

    const res2 = await postJson('/family-alarm/alarms', ttsBody({ message_text: '두번째' }));
    expect(res2.status).toBe(201);
    const body2 = (await res2.json()) as { alarm: { id: string }; message: { id: string } };

    expect(body2.alarm.id).toBe(body1.alarm.id); // 알람 행 재사용(멱등)
    expect(body2.message.id).not.toBe(body1.message.id); // 메시지는 새 내용으로 교체

    // 알람 1행 + 최신 메시지 연결.
    expect(
      await countRows(
        'SELECT COUNT(*) AS cnt FROM alarms WHERE user_id = ? AND target_user_id = ? AND time = ?',
        [SENDER.login, RECIPIENT.login, '23:00'],
      ),
    ).toBe(1);
    const alarm = await db.execute({
      sql: 'SELECT message_id FROM alarms WHERE id = ?',
      args: [body1.alarm.id],
    });
    expect(String(alarm.rows[0]!.message_id)).toBe(body2.message.id);

    // 교체된 이전 메시지는 같은 트랜잭션에서 정리되어 누적되지 않는다.
    expect(
      await countRows(
        "SELECT COUNT(*) AS cnt FROM messages WHERE user_id = ? AND category = 'family'",
        [RECIPIENT.pk],
      ),
    ).toBe(1);
    expect(
      await countRows('SELECT COUNT(*) AS cnt FROM messages WHERE id = ?', [body1.message.id]),
    ).toBe(0);
  });

  it('TTS 재전송: 이전 메시지의 generated_audio_assets 정리 + R2 키 삭제 큐 적재', async () => {
    const res1 = await postJson('/family-alarm/alarms', ttsBody({ message_text: '첫번째' }));
    const body1 = (await res1.json()) as { message: { id: string } };

    // 수신자가 프리페치해 이전 메시지의 TTS 캐시가 생긴 상황을 재현.
    const objectKey = 'generated-tts/famg-old.mp3';
    await db.execute({
      sql: `INSERT INTO generated_audio_assets
            (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
             model_id, language, request_hash, text, audio_object_key)
            VALUES ('famg-asset-1', ?, ?, ?, 'elevenlabs', 'ev-1', 'm1', 'ko', ?, '첫번째', ?)`,
      args: [RECIPIENT.pk, VP_ID, body1.message.id, crypto.randomUUID(), objectKey],
    });

    const res2 = await postJson('/family-alarm/alarms', ttsBody({ message_text: '두번째' }));
    expect(res2.status).toBe(201);

    expect(
      await countRows('SELECT COUNT(*) AS cnt FROM generated_audio_assets WHERE message_id = ?', [
        body1.message.id,
      ]),
    ).toBe(0);
    // R2 오브젝트는 트랜잭션 안에서 직접 못 지우므로 삭제 큐에 적재된다.
    expect(
      await countRows(
        "SELECT COUNT(*) AS cnt FROM pending_external_deletions WHERE kind = 'r2_object' AND ref = ?",
        [objectKey],
      ),
    ).toBe(1);
  });

  it('voice 재전송 2회: family-voice 메시지도 1행 유지', async () => {
    const res1 = await postJson('/family-alarm/alarms/voice', voiceBody({ label: '첫번째 응원' }));
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as { alarm: { id: string }; message: { id: string } };

    const res2 = await postJson('/family-alarm/alarms/voice', voiceBody({ label: '두번째 응원' }));
    expect(res2.status).toBe(201);
    const body2 = (await res2.json()) as { alarm: { id: string }; message: { id: string } };

    expect(body2.alarm.id).toBe(body1.alarm.id);
    expect(
      await countRows(
        "SELECT COUNT(*) AS cnt FROM messages WHERE user_id = ? AND category = 'family-voice'",
        [RECIPIENT.pk],
      ),
    ).toBe(1);
    expect(
      await countRows('SELECT COUNT(*) AS cnt FROM messages WHERE id = ?', [body1.message.id]),
    ).toBe(0);
  });

});

describe('가족 알람 timezone 저장 — 검증에 쓴 효과 시간대와 일치(항목 I)', () => {
  it('수신자 기록 없음: 발신자 body tz 를 무시하고 Asia/Seoul 로 판정·저장', async () => {
    // 발신자가 America/New_York 을 보내도 신뢰하지 않는다. NY 로 판정했다면 '23:00' 은
    // NY 7/15 23:00(리드타임 통과)이지만, 저장 tz 까지 NY 가 되면 cron 이 발신자 주장
    // 시간대로 울린다 — 효과 시간대(Asia/Seoul)가 판정·저장 모두에 쓰여야 한다.
    const res = await postJson(
      '/family-alarm/alarms',
      ttsBody({ timezone: 'America/New_York' }),
    );
    expect(res.status).toBe(201);
    const { alarm } = (await res.json()) as { alarm: { id: string } };
    const row = await db.execute({
      sql: 'SELECT timezone FROM alarms WHERE id = ?',
      args: [alarm.id],
    });
    expect(String(row.rows[0]!.timezone)).toBe('Asia/Seoul');
  });

  it('수신자 저장 tz 있음: 그 tz 로 판정하고 같은 값을 행에 저장(voice 경로 포함)', async () => {
    // 수신자 기기가 마지막으로 보고한 시간대 = America/New_York.
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, time, timezone, is_active)
            VALUES ('famg-own-tz', ?, '12:00', 'America/New_York', 1)`,
      args: [RECIPIENT.login],
    });
    // now = NY 7/14 20:00 → wake 10:00 은 NY 다음날 10:00(리드타임 통과).
    const res = await postJson(
      '/family-alarm/alarms/voice',
      voiceBody({ wake_at: '10:00', timezone: 'Asia/Seoul' }),
    );
    expect(res.status).toBe(201);
    const { alarm } = (await res.json()) as { alarm: { id: string } };
    const row = await db.execute({
      sql: 'SELECT timezone FROM alarms WHERE id = ?',
      args: [alarm.id],
    });
    // cron 스케줄러가 검증(NY 리드타임)과 같은 시간대로 HH:mm 을 해석하게 저장한다.
    expect(String(row.rows[0]!.timezone)).toBe('America/New_York');
  });
});

