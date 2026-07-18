// 타인 발신 알람 가드 실동작 검증 — mock 결과 주입이 아니라 실제 libsql DB 에 전체
// 마이그레이션을 올리고 실제 라우트(POST /alarms, target_user_id 경로)를 호출해,
// (수신자, HH:mm) 슬롯의 원자적 교체·멱등, 30분 리드타임, 수신자 시간대 quiet 요일
// 판정을 DB 상태로 확인한다.
//
// libsql `:memory:` 는 연결마다 별도 DB 라 autocommit execute 와 transaction 이 스키마를
// 공유하지 못한다(compliance-verify.test.ts 와 동일 이슈). 이 라우트는
// withWriteTransaction 을 쓰므로 임시 파일 DB 를 사용한다.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const DB_PATH = join(tmpdir(), 'alarmtalk-alarm-guard.db');
const db: Client = createClient({ url: `file:${DB_PATH}` });

vi.mock('../src/lib/db', () => ({ getDB: () => db }));

const { default: alarmMutation } = await import('../src/routes/alarm-mutation');

// 발신자/수신자 식별자 — alarms.user_id/target_user_id 에는 로그인 id(google_id)가 저장된다.
const SENDER_A = { pk: 'guard-a-pk', login: 'guard-ga' };
const SENDER_B = { pk: 'guard-b-pk', login: 'guard-gb' };
const RECIPIENT = { pk: 'guard-r-pk', login: 'guard-gr' }; // quiet 창 없음
const RECIPIENT_QUIET = { pk: 'guard-q-pk', login: 'guard-gq' }; // 주말 00:00-08:00 quiet

function appFor(user: { pk: string; login: string }) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', user.login);
    c.set('userIdPK', user.pk);
    await next();
  });
  app.route('/alarms', alarmMutation);
  return app;
}

function postAlarm(
  sender: { pk: string; login: string },
  body: Record<string, unknown>,
): Promise<Response> {
  return appFor(sender).request(
    new Request('http://localhost/alarms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function alarmRow(id: string) {
  const res = await db.execute({
    sql: `SELECT id, user_id, target_user_id, time, is_active, snooze_minutes FROM alarms WHERE id = ?`,
    args: [id],
  });
  return res.rows[0] ?? null;
}

beforeAll(async () => {
  await runMigrations(db);
  // 이전 실행 잔재 정리(파일 DB 재사용). 시스템 시드 users 행은 건드리지 않는다.
  await db.execute('DELETE FROM alarms');
  await db.execute('DELETE FROM friendships');
  await db.execute("DELETE FROM users WHERE id LIKE 'guard-%'");

  const insertUser = (u: { pk: string; login: string }, allow: number, quietWindows: string) =>
    db.execute({
      sql: `INSERT INTO users (id, google_id, email, allow_family_alarms, family_alarm_quiet_windows)
            VALUES (?, ?, ?, ?, ?)`,
      args: [u.pk, u.login, `${u.pk}@guard.test`, allow, quietWindows],
    });
  await insertUser(SENDER_A, 0, '[]');
  await insertUser(SENDER_B, 0, '[]');
  await insertUser(RECIPIENT, 1, '[]');
  await insertUser(RECIPIENT_QUIET, 1, '[{"days":[0,6],"start":"00:00","end":"08:00"}]');

  const insertFriendship = (id: string, a: string, b: string) =>
    db.execute({
      sql: `INSERT INTO friendships (id, user_a, user_b, status) VALUES (?, ?, ?, 'accepted')`,
      args: [id, a, b],
    });
  await insertFriendship('guard-f1', SENDER_A.login, RECIPIENT.login);
  await insertFriendship('guard-f2', SENDER_B.login, RECIPIENT.login);
  await insertFriendship('guard-f3', SENDER_A.login, RECIPIENT_QUIET.login);
});

beforeEach(async () => {
  await db.execute('DELETE FROM alarms');
  // 리드타임 판정이 실제 시계에 좌우되지 않도록 고정: 2026-07-15T00:00Z = KST 수요일 09:00.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('타인 발신 알람 — (수신자, HH:mm) 슬롯 원자 교체', () => {
  it('발신자 A→B 가 같은 수신자·같은 시각으로 순차 생성하면 마지막 것만 is_active=1', async () => {
    const resA = await postAlarm(SENDER_A, {
      time: '23:00',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
    });
    expect(resA.status).toBe(201);
    const idA = ((await resA.json()) as { alarm: { id: string } }).alarm.id;

    const resB = await postAlarm(SENDER_B, {
      time: '23:00',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
    });
    expect(resB.status).toBe(201);
    const idB = ((await resB.json()) as { alarm: { id: string } }).alarm.id;

    expect(idB).not.toBe(idA);
    const rowA = await alarmRow(idA);
    const rowB = await alarmRow(idB);
    expect(Number(rowA!.is_active)).toBe(0); // 이전 발신자 알람은 비활성화(교체)
    expect(Number(rowB!.is_active)).toBe(1); // 최신 발신 알람만 활성
    expect(String(rowB!.target_user_id)).toBe(RECIPIENT.login);
  });

  it('같은 발신자의 동일 (수신자, time) 재전송은 멱등 — 행 1개, id 유지, 내용 갱신', async () => {
    const res1 = await postAlarm(SENDER_A, {
      time: '23:00',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
      snooze_minutes: 5,
    });
    expect(res1.status).toBe(201);
    const id1 = ((await res1.json()) as { alarm: { id: string } }).alarm.id;

    const res2 = await postAlarm(SENDER_A, {
      time: '23:00',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
      snooze_minutes: 12,
    });
    expect(res2.status).toBe(201);
    const id2 = ((await res2.json()) as { alarm: { id: string } }).alarm.id;

    expect(id2).toBe(id1); // 새 행을 만들지 않고 기존 행 재사용
    const count = await db.execute({
      sql: `SELECT COUNT(*) AS cnt FROM alarms WHERE user_id = ? AND target_user_id = ? AND time = ?`,
      args: [SENDER_A.login, RECIPIENT.login, '23:00'],
    });
    expect(Number(count.rows[0]!.cnt)).toBe(1);
    const row = await alarmRow(id1);
    expect(Number(row!.is_active)).toBe(1);
    expect(Number(row!.snooze_minutes)).toBe(12); // 재전송 내용으로 UPDATE 됨
  });

  it('수신자 본인이 만든 같은 시각 알람(target 없음)은 서버가 건드리지 않는다', async () => {
    // 수신자 로컬 알람의 교체 여부는 클라 확인창이 담당하므로 서버는 보존해야 한다.
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, time, is_active) VALUES ('guard-own', ?, '23:00', 1)`,
      args: [RECIPIENT.login],
    });

    const res = await postAlarm(SENDER_A, {
      time: '23:00',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
    });
    expect(res.status).toBe(201);
    const sentId = ((await res.json()) as { alarm: { id: string } }).alarm.id;

    expect(Number((await alarmRow('guard-own'))!.is_active)).toBe(1); // 본인 알람 보존
    expect(Number((await alarmRow(sentId))!.is_active)).toBe(1);
  });
});

describe('타인 발신 알람 — 수신자 시간대 기준 30분 리드타임', () => {
  it('수신자 시간대 기준 30분 미만이면 400 FAMILY_ALARM_LEAD_TIME, 행 미생성', async () => {
    // now = KST 09:00 → KST 09:20 은 20분 뒤.
    const res = await postAlarm(SENDER_A, {
      time: '09:20',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_code: string }).error_code).toBe(
      'FAMILY_ALARM_LEAD_TIME',
    );
    const count = await db.execute({ sql: 'SELECT COUNT(*) AS cnt FROM alarms', args: [] });
    expect(Number(count.rows[0]!.cnt)).toBe(0);
  });

  it('30분 이상이면 201', async () => {
    const res = await postAlarm(SENDER_A, {
      time: '09:40',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
    });
    expect(res.status).toBe(201);
  });

  it('수신자 저장 tz 가 있으면 발신자 body 의 다른 timezone 을 무시하고 수신자 tz 로 판정(우회 차단)', async () => {
    // 수신자 기기가 마지막으로 보고한 시간대 = America/New_York.
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, time, timezone, is_active)
            VALUES ('guard-tz', ?, '12:00', 'America/New_York', 1)`,
      args: [RECIPIENT.login],
    });
    // now = 2026-07-15T00:00Z = NY(EDT) 7/14 20:00 → '20:15' 는 NY 기준 15분 뒤.
    // 발신자가 body 에 Asia/Seoul 을 보내도(서울로 해석하면 11시간 이상 남아 201 이 났을 것 =
    // 리드타임 우회) 수신자 저장 tz 가 우선하므로 400 이어야 한다.
    const res = await postAlarm(SENDER_A, {
      time: '20:15',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_code: string }).error_code).toBe(
      'FAMILY_ALARM_LEAD_TIME',
    );
  });

  it('body 에 timezone 이 없어도 수신자 최근 알람의 timezone 으로 판정', async () => {
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, time, timezone, is_active)
            VALUES ('guard-tz', ?, '12:00', 'America/New_York', 1)`,
      args: [RECIPIENT.login],
    });
    const res = await postAlarm(SENDER_A, {
      time: '20:15',
      target_user_id: RECIPIENT.login,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_code: string }).error_code).toBe(
      'FAMILY_ALARM_LEAD_TIME',
    );
  });

  it('수신자 저장 tz 기록이 없으면 body timezone 으로 폴백해 판정', async () => {
    // 수신자 소유 알람이 하나도 없음(beforeEach 에서 전체 삭제됨).
    // body = America/New_York → now = NY 7/14 20:00, '20:15' 는 15분 뒤 → 400.
    // (기본값 Asia/Seoul 로 해석했다면 11시간 이상 남아 201 이 났을 것.)
    const res = await postAlarm(SENDER_A, {
      time: '20:15',
      target_user_id: RECIPIENT.login,
      timezone: 'America/New_York',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_code: string }).error_code).toBe(
      'FAMILY_ALARM_LEAD_TIME',
    );
  });
});

describe('타인 발신 알람 — quiet 요일을 수신자 시간대의 발사 요일로 판정', () => {
  it('UTC 금요일이라도 다음 발사가 수신자(KST) 토요일이면 주말 quiet 창에 차단(403)', async () => {
    // now = 2026-07-17T14:00Z(UTC 금) = KST 금 23:00 → '00:30' 다음 발사는 KST 토 00:30
    // (= UTC 금 15:30). 구버전은 서버 UTC 요일(금)로 판정해 토요일 창을 놓쳤다.
    vi.setSystemTime(new Date('2026-07-17T14:00:00Z'));
    const res = await postAlarm(SENDER_A, {
      time: '00:30',
      target_user_id: RECIPIENT_QUIET.login,
      timezone: 'Asia/Seoul',
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error_code: string }).error_code).toBe(
      'FAMILY_ALARM_QUIET_TIME',
    );
  });

  it('같은 시각이라도 quiet 창이 평일 프리셋이면 발사일(토)이 아니므로 201', async () => {
    vi.setSystemTime(new Date('2026-07-17T14:00:00Z'));
    await db.execute({
      sql: `UPDATE users SET family_alarm_quiet_windows = ? WHERE id = ?`,
      args: ['[{"days":[1,2,3,4,5],"start":"00:00","end":"08:00"}]', RECIPIENT_QUIET.pk],
    });
    try {
      const res = await postAlarm(SENDER_A, {
        time: '00:30',
        target_user_id: RECIPIENT_QUIET.login,
        timezone: 'Asia/Seoul',
      });
      expect(res.status).toBe(201);
    } finally {
      await db.execute({
        sql: `UPDATE users SET family_alarm_quiet_windows = ? WHERE id = ?`,
        args: ['[{"days":[0,6],"start":"00:00","end":"08:00"}]', RECIPIENT_QUIET.pk],
      });
    }
  });
});
