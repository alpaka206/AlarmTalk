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
// ⚠ **pk 와 login 이 다른 유일한 픽스처.** 식별자 통일 이전 구글 계정의 모양이라,
// 발신자를 한 값으로만 조회하는 회귀를 이 픽스처만 잡는다.
const SENDER_LEGACY = { pk: 'guard-legacy-pk', login: 'guard-legacy-google' };

function appFor(user: { pk: string; login: string }) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    // 실제 미들웨어와 같은 모양: `userId` 는 **users.id 로 정규화된 값**이고, 토큰의 로그인
    // 식별자는 `userLoginId` 로 따로 온다. 대부분의 픽스처는 둘이 같지만 SENDER_LEGACY 만
    // 다르다 — 그 픽스처가 '옛 행은 로그인 식별자로 저장돼 있다' 는 갈래를 지킨다.
    c.set('userId', user.pk);
    c.set('userIdPK', user.pk);
    c.set('userLoginId', user.login);
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
  // ⚠ 슬롯 신원 표도 함께 비운다(마이그레이션 107). 이게 남으면 알람 id 가 **회차 사이에**
  // 고정돼, 앞 실행이 남긴 `alarm_recipient_state` 행과 UNIQUE 충돌한다.
  await db.execute('DELETE FROM targeted_alarm_slots');
  await db.execute('DELETE FROM alarm_recipient_state');
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
  await insertUser(SENDER_LEGACY, 0, '[]');
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
  await insertMember('guard-m6', SENDER_LEGACY, 'member');
});

beforeEach(async () => {
  await db.execute('DELETE FROM alarms');
  // ⚠ 슬롯 신원 표도 함께 비운다(마이그레이션 107). 이게 남으면 알람 id 가 **회차 사이에**
  // 고정돼, 앞 실행이 남긴 `alarm_recipient_state` 행과 UNIQUE 충돌한다.
  await db.execute('DELETE FROM targeted_alarm_slots');
  await db.execute('DELETE FROM alarm_recipient_state');
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
    const versionA = String((await alarmRow(idA))!.delivery_version);

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
    expect(String(rowA!.delivery_version)).not.toBe(versionA); // 옛 ACK가 원격 끄기를 지우지 못함
    expect(Number(rowB!.is_active)).toBe(1); // 최신 발신 알람만 활성
    expect(String(rowB!.target_user_id)).toBe(RECIPIENT.login);
  });

  // ⚠ **수신 확인으로 행이 지워진 뒤의 재전송도 같은 알람이어야 한다**(2026-08-27 실기기 재현).
  //
  // 수신 확인(`POST /alarm/:id/received`)은 alarms 행을 지운다. 슬롯 신원이 그 행에만
  // 달려 있으면 그 뒤의 재전송은 **새 알람 id** 를 받고, 수신자 기기에는 remoteAlarmId 가
  // 다른 두 번째 줄이 생긴다 — 껐던 옛 줄은 영영 울리지 않는 유령으로 남는다.
  // `targeted_alarm_slots`(마이그레이션 107)가 id 하나를 기억해 이걸 막는다.
  it('전달이 끝나 행이 지워진 뒤 재전송해도 같은 알람 id 를 쓴다', async () => {
    const first = await postAlarm(SENDER_A, {
      time: '21:30',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
      snooze_minutes: 5,
    });
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { alarm: { id: string } }).alarm.id;

    // 수신 확인이 하는 일 — 행을 지운다.
    await db.execute({ sql: 'DELETE FROM alarms WHERE id = ?', args: [firstId] });
    expect(await alarmRow(firstId)).toBeNull();

    const resend = await postAlarm(SENDER_A, {
      time: '21:30',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
      snooze_minutes: 9,
    });
    expect(resend.status).toBe(201);
    const resendId = ((await resend.json()) as { alarm: { id: string } }).alarm.id;

    expect(resendId).toBe(firstId);
    // 응답 id 로 실제 행이 찾아져야 한다 — 삽입 id 와 응답 id 가 어긋나면 201 을 받고도
    // 그 알람을 어디서도 못 찾는다.
    const row = await alarmRow(resendId);
    expect(row).not.toBeNull();
    expect(Number(row!.is_active)).toBe(1);
    expect(Number(row!.snooze_minutes)).toBe(9);
    // 새 전달 세대여야 수신자가 '다시 보냈다' 로 읽고 덮어쓴다.
    expect(String(row!.delivery_version)).toMatch(/^[0-9a-f-]{36}$/);
  });

  // ⚠ **식별자 통일 이전에 만들어진 발신 행도 같은 슬롯이어야 한다**(2026-08-28 리뷰).
  //
  // 구글 로그인 계정의 옛 알람은 `alarms.user_id` 에 google_id 가 들어 있는데 인증은 지금
  // users.id 로 정규화한다. 발신자를 한 값으로만 조회하면 그 행도, 그 행으로 채운 슬롯도
  // 못 찾아 **새 알람 id** 가 발급된다 — 이 표가 막으려던 중복 줄이 그대로 생긴다.
  // (다른 픽스처는 pk == login 이라 이 갈래를 통과시킨다.)
  it('레거시 발신자 식별자로 남은 슬롯도 같은 알람 id 로 이어 쓴다', async () => {
    const LEGACY_SENDER = SENDER_LEGACY;
    const legacyAlarmId = crypto.randomUUID();
    // 옛 스키마가 남긴 모양: 발신 행과 슬롯이 모두 **로그인 식별자**로 키돼 있다.
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, target_user_id, time, repeat_days, is_active,
              mode, wake_mode, snooze_minutes, timezone, delivery_version, created_at, updated_at)
            VALUES (?, ?, ?, '07:15', '[]', 1, 'sound-only', 'sound_then_voice', 5, 'Asia/Seoul', ?,
              datetime('now'), datetime('now'))`,
      args: [legacyAlarmId, LEGACY_SENDER.login, RECIPIENT.login, crypto.randomUUID()],
    });
    await db.execute({
      sql: `INSERT INTO targeted_alarm_slots (sender_user_id, recipient_user_id, time, alarm_id, updated_at)
            VALUES (?, ?, '07:15', ?, datetime('now'))`,
      args: [LEGACY_SENDER.login, RECIPIENT.login, legacyAlarmId],
    });
    // 전달이 끝난 상태 — 행은 지워지고 슬롯만 남는다.
    await db.execute({ sql: 'DELETE FROM alarms WHERE id = ?', args: [legacyAlarmId] });

    const resend = await postAlarm(LEGACY_SENDER, {
      time: '07:15',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
      snooze_minutes: 7,
    });
    expect(resend.status).toBe(201);
    const resendId = ((await resend.json()) as { alarm: { id: string } }).alarm.id;
    expect(resendId).toBe(legacyAlarmId);
    const row = await alarmRow(resendId);
    expect(row).not.toBeNull();
    expect(Number(row!.snooze_minutes)).toBe(7);
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
    await db.execute({
      sql: `INSERT INTO alarm_recipient_state
              (alarm_id, recipient_user_id, declined, revoked, voice_profile_id,
               sender_voice_upload, created_at, updated_at)
            VALUES (?, ?, 1, 1, 'old-voice', 1, datetime('now'), datetime('now'))`,
      args: [id1, RECIPIENT.login],
    });

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
    const recipientState = await db.execute({
      sql: `SELECT declined, revoked, voice_profile_id, sender_voice_upload FROM alarm_recipient_state
            WHERE alarm_id = ? AND recipient_user_id = ?`,
      args: [id1, RECIPIENT.login],
    });
    expect(Number(recipientState.rows[0]!.declined)).toBe(1);
    expect(Number(recipientState.rows[0]!.revoked)).toBe(0);
    expect(recipientState.rows[0]!.voice_profile_id).toBeNull();
    expect(Number(recipientState.rows[0]!.sender_voice_upload)).toBe(0);
    // 재사용 UPDATE 도 검증에 쓴 효과 시간대를 저장한다(수신자 기록 없음 → Asia/Seoul).
    expect(String(row!.timezone)).toBe('Asia/Seoul');
  });

  it('타깃 알람의 일반 PATCH를 거부하고 원본을 보존한다', async () => {
    const created = await postAlarm(SENDER_A, {
      time: '23:00',
      target_user_id: RECIPIENT.login,
      timezone: 'Asia/Seoul',
    });
    const id = ((await created.json()) as { alarm: { id: string } }).alarm.id;
    const before = String((await alarmRow(id))!.delivery_version);

    const patched = await patchAlarm(SENDER_A, id, { snooze_minutes: 12 });
    expect(patched.status).toBe(409);
    expect(((await patched.json()) as { error_code: string }).error_code).toBe(
      'TARGETED_ALARM_IMMUTABLE',
    );
    expect(String((await alarmRow(id))!.delivery_version)).toBe(before);
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

describe('본인 알람 PATCH', () => {
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
