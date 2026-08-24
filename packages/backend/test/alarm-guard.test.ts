// 타인 발신 알람 가드 실동작 검증 — mock 결과 주입이 아니라 실제 libsql DB 에 전체
// 마이그레이션을 올리고 실제 라우트(POST /alarms, target_user_id 경로)를 호출해,
// (수신자, HH:mm) 슬롯의 원자적 교체·멱등, 리드타임, 수신자 시간대 quiet 요일
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

// 발신자/수신자 식별자 — JWT sub 은 항상 users.id 라 pk 와 login 이 같은 값이다.
const SENDER_A = { pk: 'guard-a-pk', login: 'guard-a-pk' };
const SENDER_B = { pk: 'guard-b-pk', login: 'guard-b-pk' };
const RECIPIENT = { pk: 'guard-r-pk', login: 'guard-r-pk' }; // quiet 창 없음
const RECIPIENT_QUIET = { pk: 'guard-q-pk', login: 'guard-q-pk' }; // 주말 00:00-08:00 quiet

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

function patchAlarm(
  sender: { pk: string; login: string },
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return appFor(sender).request(
    new Request(`http://localhost/alarms/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function alarmRow(id: string) {
  const res = await db.execute({
    sql: `SELECT id, user_id, target_user_id, time, is_active, snooze_minutes, timezone,
                 delivery_version
          FROM alarms WHERE id = ?`,
    args: [id],
  });
  return res.rows[0] ?? null;
}

beforeAll(async () => {
  await runMigrations(db);
  // 이전 실행 잔재 정리(파일 DB 재사용). 시스템 시드 users 행은 건드리지 않는다.
  await db.execute('DELETE FROM alarms');
  await db.execute("DELETE FROM plan_group_members WHERE plan_group_id = 'guard-group'");
  await db.execute("DELETE FROM plan_groups WHERE id = 'guard-group'");
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

  // 타깃 알람 권한은 같은 커플/가족 플랜 그룹 멤버십(assertSameGroup)이다 —
  // 발신자·수신자 전원을 한 가족 그룹에 넣는다(plan_id 는 마이그레이션 시드 가족 플랜).
  await db.execute({
    sql: `INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members)
          VALUES ('guard-group', ?, '70000000-0000-4000-8000-000000000003', 6)`,
    args: [SENDER_A.pk],
  });
  const insertMember = (id: string, u: { pk: string }, role: string) =>
    db.execute({
      sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
            VALUES (?, 'guard-group', ?, ?)`,
      args: [id, u.pk, role],
    });
  await insertMember('guard-m1', SENDER_A, 'owner');
  await insertMember('guard-m2', SENDER_B, 'member');
  await insertMember('guard-m3', RECIPIENT, 'member');
  await insertMember('guard-m4', RECIPIENT_QUIET, 'member');
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
    const firstDeliveryVersion = String((await alarmRow(id1))!.delivery_version);
    expect(firstDeliveryVersion).toMatch(/^[0-9a-f-]{36}$/);

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
    expect(String(row!.delivery_version)).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(row!.delivery_version)).not.toBe(firstDeliveryVersion);
    // 재사용 UPDATE 도 검증에 쓴 효과 시간대를 저장한다(수신자 기록 없음 → Asia/Seoul).
    expect(String(row!.timezone)).toBe('Asia/Seoul');
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

describe('타인 발신 알람 — 수신자 시간대 기준 리드타임(FAMILY_ALARM_MIN_LEAD_MINUTES)', () => {
  it('수신자 시간대 기준 리드타임 미만이면 400 FAMILY_ALARM_LEAD_TIME, 행 미생성', async () => {
    // now = KST 09:00 → KST 09:03 은 3분 뒤(리드타임 미만).
    const res = await postAlarm(SENDER_A, {
      time: '09:03',
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

  it('리드타임 이상이면 201', async () => {
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
    // now = 2026-07-15T00:00Z = NY(EDT) 7/14 20:00 → '20:03' 은 NY 기준 3분 뒤(리드타임 미만).
    // 발신자가 body 에 Asia/Seoul 을 보내도(서울로 해석하면 11시간 이상 남아 201 이 났을 것 =
    // 리드타임 우회) 수신자 저장 tz 가 우선하므로 400 이어야 한다.
    const res = await postAlarm(SENDER_A, {
      time: '20:03',
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
      time: '20:03',
      target_user_id: RECIPIENT.login,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_code: string }).error_code).toBe(
      'FAMILY_ALARM_LEAD_TIME',
    );
  });

  it('수신자 저장 tz 기록이 없으면 발신자 body timezone 을 무시하고 Asia/Seoul 로 판정·저장', async () => {
    // 수신자 소유 알람이 하나도 없음(beforeEach 에서 전체 삭제됨).
    // 발신자가 body 에 America/New_York 을 보내도 폴백으로 신뢰하지 않는다 —
    // NY 로 해석하면 '20:15' 는 15분 뒤라 400 이 났겠지만, 효과 시간대는 기본값
    // Asia/Seoul(11시간 이상 리드타임)이므로 201 이어야 한다. 저장 timezone 도
    // 발신자 값이 아니라 효과 시간대여야 한다.
    const res = await postAlarm(SENDER_A, {
      time: '20:03',
      target_user_id: RECIPIENT.login,
      timezone: 'America/New_York',
    });
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { alarm: { id: string } }).alarm.id;
    expect(String((await alarmRow(id))!.timezone)).toBe('Asia/Seoul');
  });

  it('수신자 저장 tz 가 있으면 그 tz 가 행에 저장된다(발신자 body tz 아님)', async () => {
    // 수신자 기기가 마지막으로 보고한 시간대 = America/New_York.
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, time, timezone, is_active)
            VALUES ('guard-tz', ?, '12:00', 'America/New_York', 1)`,
      args: [RECIPIENT.login],
    });
    // now = NY 7/14 20:00 → '21:00' 은 NY 기준 1시간 뒤(리드타임 통과).
    const res = await postAlarm(SENDER_A, {
      time: '21:00',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul', // 발신자 값 — 판정·저장 어디에도 쓰이면 안 된다
    });
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { alarm: { id: string } }).alarm.id;
    // cron 스케줄러가 검증(NY 기준 리드타임)과 같은 시간대로 해석하도록 효과 tz 저장.
    expect(String((await alarmRow(id))!.timezone)).toBe('America/New_York');
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

describe('타인 발신 알람 — PATCH 가 POST 가드를 effective(수정 결과) 기준으로 재실행', () => {
  it('PATCH time 을 리드타임 미만으로 바꾸면 400 FAMILY_ALARM_LEAD_TIME, 행 미변경', async () => {
    // now = KST 09:00. 12:00 로 정상 생성 후 09:03(3분 뒤)로 PATCH → 리드타임 위반.
    const create = await postAlarm(SENDER_A, {
      time: '12:00',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
    });
    expect(create.status).toBe(201);
    const id = ((await create.json()) as { alarm: { id: string } }).alarm.id;

    const res = await patchAlarm(SENDER_A, id, { time: '09:03' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('FAMILY_ALARM_LEAD_TIME');
    expect(String((await alarmRow(id))!.time)).toBe('12:00'); // 거부됐으므로 변경 안 됨
  });

  it('PATCH time 을 수신자 quiet 시간대로 바꾸면 403 FAMILY_ALARM_QUIET_TIME, 행 미변경', async () => {
    // now = UTC 금 14:00 = KST 금 23:00. 12:00 로 생성 후 00:30(다음 발사 KST 토 00:30)로 PATCH.
    vi.setSystemTime(new Date('2026-07-17T14:00:00Z'));
    const create = await postAlarm(SENDER_A, {
      time: '12:00',
      target_user_id: RECIPIENT_QUIET.login,
      timezone: 'Asia/Seoul',
    });
    expect(create.status).toBe(201);
    const id = ((await create.json()) as { alarm: { id: string } }).alarm.id;

    const res = await patchAlarm(SENDER_A, id, { time: '00:30' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('FAMILY_ALARM_QUIET_TIME');
    expect(String((await alarmRow(id))!.time)).toBe('12:00');
  });

  it('PATCH is_active 0→1 재활성화 시 (수신자, time) 슬롯을 원자 재점유(이전 활성 비활성화)', async () => {
    // A→R, B→R 를 같은 시각으로 생성하면 B 가 슬롯을 차지하고 A 는 비활성화된다.
    // 이후 발신자 A 가 자기 알람을 is_active=1 로 재활성화하면 A 가 슬롯을 되찾고 B 는 비활성화돼야 한다.
    const ra = await postAlarm(SENDER_A, {
      time: '23:00',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
    });
    const idA = ((await ra.json()) as { alarm: { id: string } }).alarm.id;
    const rb = await postAlarm(SENDER_B, {
      time: '23:00',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
    });
    const idB = ((await rb.json()) as { alarm: { id: string } }).alarm.id;
    expect(Number((await alarmRow(idA))!.is_active)).toBe(0); // B 가 A 를 교체
    expect(Number((await alarmRow(idB))!.is_active)).toBe(1);

    const res = await patchAlarm(SENDER_A, idA, { is_active: true });
    expect(res.status).toBe(200);
    expect(Number((await alarmRow(idA))!.is_active)).toBe(1); // A 재활성화(슬롯 되찾음)
    expect(Number((await alarmRow(idB))!.is_active)).toBe(0); // 이전 활성(B) 비활성화
  });

  it('같은 슬롯에 발신자 활성 알람이 둘이어도 PATCH 대상이 승자로 남고 나머지만 비활성화(Codex #563)', async () => {
    // 비정상 상태((수신자, time) 슬롯에 발신자 A 의 활성 알람 2개)를 직접 만든 뒤 그 중 하나를
    // PATCH 하면 대상이 유일 승자로 남아야 한다. 구버전은 POST 용 claimTargetedAlarmSlot 이
    // 다른 행을 keeper 로 골라 PATCH 대상까지 비활성화해 둘 다 꺼지는 버그가 있었다.
    const DBX = '11111111-1111-4111-8111-111111111111';
    const DBY = '22222222-2222-4222-8222-222222222222';
    // 무료 발신자 알람은 sound-only(POST 가 무료 플랜에 넣는 기본값)로 넣어 플랜 게이트를 피한다.
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, target_user_id, time, is_active, timezone, mode)
            VALUES (?, ?, ?, '23:00', 1, 'Asia/Seoul', 'sound-only'),
                   (?, ?, ?, '23:00', 1, 'Asia/Seoul', 'sound-only')`,
      args: [DBX, SENDER_A.login, RECIPIENT.login, DBY, SENDER_A.login, RECIPIENT.login],
    });
    const res = await patchAlarm(SENDER_A, DBX, { time: '23:00' });
    expect(res.status).toBe(200);
    expect(Number((await alarmRow(DBX))!.is_active)).toBe(1); // 대상 = 승자
    expect(Number((await alarmRow(DBY))!.is_active)).toBe(0); // 나머지 비활성화
    const active = await db.execute({
      sql: `SELECT COUNT(*) AS cnt FROM alarms WHERE target_user_id = ? AND time = '23:00' AND is_active = 1`,
      args: [RECIPIENT.login],
    });
    expect(Number(active.rows[0]!.cnt)).toBe(1); // 슬롯에 정확히 하나만 활성
  });

  it('본인 알람(target 없음) PATCH 는 가드가 걸리지 않는다(리드타임 미만이어도 200)', async () => {
    // 본인 알람은 리드타임/quiet 가드 대상이 아니다 — target_user_id 가 없으면 재실행하지 않는다.
    const create = await postAlarm(SENDER_A, { time: '12:00', timezone: 'Asia/Seoul' });
    expect(create.status).toBe(201);
    const id = ((await create.json()) as { alarm: { id: string } }).alarm.id;

    const res = await patchAlarm(SENDER_A, id, { time: '09:20' });
    expect(res.status).toBe(200);
    expect(String((await alarmRow(id))!.time)).toBe('09:20');
  });
});

// 회귀 가드 — 가족 알람 배달 (2026-07 감사).
//
// alarms.target_user_id 에는 반드시 **users.id** 가 들어가야 한다. 과거에는
// `google_id ?? id` 를 저장했는데, JWT sub 이 users.id 로 통일된 뒤로는 수신자 세션의
// 식별자가 users.id 라서 google_id 로 저장하면
//   1) GET /alarm 에서 수신자가 자기 알람을 못 보고,
//   2) GET /tts/messages/:id/audio 의 소유권 판정(target_user_id IN (...))도 실패해
//      받은 목소리를 재생조차 못 한다.
// 기존 계정은 users.id == google_id 라 우연히 맞아떨어져 드러나지 않았고, 신규 구글
// 가입자(users.id = UUID, google_id = 구글 sub)부터 조용히 깨졌다.
describe('가족 알람 — target_user_id 는 users.id 로 저장한다', () => {
  // 신규 구글 가입자를 재현한다: users.id(UUID) != google_id(구글 sub).
  const SPLIT_RECIPIENT = { pk: 'guard-split-pk', google: 'guard-split-google-sub' };

  beforeAll(async () => {
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, allow_family_alarms, family_alarm_quiet_windows)
            VALUES (?, ?, ?, 1, '[]')`,
      args: [SPLIT_RECIPIENT.pk, SPLIT_RECIPIENT.google, 'guard-split@guard.test'],
    });
    await db.execute({
      sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
            VALUES ('guard-m5', 'guard-group', ?, 'member')`,
      args: [SPLIT_RECIPIENT.pk],
    });
  });

  it('users.id != google_id 인 수신자에게도 users.id 로 저장된다', async () => {
    const res = await postAlarm(SENDER_A, {
      time: '05:30',
      target_user_id: SPLIT_RECIPIENT.pk, // 앱은 /family/groups/current 가 준 users.id 를 보낸다
      timezone: 'Asia/Seoul',
    });
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { alarm: { id: string } }).alarm.id;

    const row = await alarmRow(id);
    expect(String(row!.target_user_id)).toBe(SPLIT_RECIPIENT.pk);
    expect(String(row!.target_user_id)).not.toBe(SPLIT_RECIPIENT.google);
  });

  it('수신자 세션(userId=userIdPK=users.id)이 자기 알람을 조회할 수 있다', async () => {
    const res = await postAlarm(SENDER_A, {
      time: '05:40',
      target_user_id: SPLIT_RECIPIENT.pk,
      timezone: 'Asia/Seoul',
    });
    expect(res.status).toBe(201);

    // 수신자 조회 경로가 쓰는 것과 동일한 술어(viewerIds = [users.id]).
    const visible = await db.execute({
      sql: `SELECT COUNT(*) AS cnt FROM alarms
            WHERE target_user_id = ? AND time = '05:40' AND is_active = 1`,
      args: [SPLIT_RECIPIENT.pk],
    });
    expect(Number(visible.rows[0]!.cnt)).toBe(1);
  });
});
