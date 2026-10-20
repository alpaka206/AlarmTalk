// 알람 쓰기 가드 실동작 검증 — mock 결과 주입이 아니라 실제 libsql DB 에 전체 마이그레이션을 올리고
// 실제 라우트(POST/PATCH /alarms)를 호출해 DB 상태로 확인한다.
//
// 남에게 보내는 알람(가족 알람)은 2026-10-20 에 없앴다. 남을 가리키는 `target_user_id` 는 그룹 밖 발신자가 받던
// 답(403 `NOT_CONNECTED`)으로 끊고, 그 사람의 알람은 서버가 건드리지 않는다.
//
// libsql `:memory:` 는 연결마다 별도 DB 라 autocommit execute 와 transaction 이 스키마를
// 공유하지 못한다(compliance-verify.test.ts 와 동일 이슈). 이 라우트는
// withWriteTransaction 을 쓰므로 임시 파일 DB 를 사용한다.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
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

// JWT sub 은 항상 users.id 라 대부분 pk 와 login 이 같은 값이다.
const SENDER = { pk: 'guard-a-pk', login: 'guard-a-pk' };
const OTHER = { pk: 'guard-r-pk', login: 'guard-r-pk' };
// ⚠ **pk 와 login 이 다른 유일한 픽스처.** 식별자 통일 이전 구글 계정의 모양이라, 나를 한 값으로만 보는
// 회귀를 이 픽스처만 잡는다.
const SENDER_LEGACY = { pk: 'guard-legacy-pk', login: 'guard-legacy-google' };

function appFor(user: { pk: string; login: string }) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    // 실제 미들웨어와 같은 모양: `userId` 는 **users.id 로 정규화된 값**이고, 토큰의 로그인
    // 식별자는 `userLoginId` 로 따로 온다.
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
    sql: `SELECT id, user_id, time, is_active, snooze_minutes, timezone FROM alarms WHERE id = ?`,
    args: [id],
  });
  return res.rows[0] ?? null;
}

async function alarmCount(): Promise<number> {
  const res = await db.execute('SELECT COUNT(*) AS cnt FROM alarms');
  return Number(res.rows[0]!.cnt);
}

beforeAll(async () => {
  await runMigrations(db);
  // 이전 실행 잔재 정리(파일 DB 재사용). 시스템 시드 users 행은 건드리지 않는다.
  await db.execute('DELETE FROM alarms');
  await db.execute("DELETE FROM users WHERE id LIKE 'guard-%'");

  for (const u of [SENDER, OTHER, SENDER_LEGACY]) {
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email) VALUES (?, ?, ?)`,
      args: [u.pk, u.login, `${u.pk}@guard.test`],
    });
  }
});

beforeEach(async () => {
  await db.execute('DELETE FROM alarms');
});

describe('남을 가리키는 알람 — 403 NOT_CONNECTED', () => {
  it('그 사람의 같은 시각 알람은 그대로이고 새 행도 생기지 않는다', async () => {
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, time, is_active) VALUES ('guard-own', ?, '23:00', 1)`,
      args: [OTHER.pk],
    });

    const res = await postAlarm(SENDER, {
      time: '23:00',
      target_user_id: OTHER.pk,
      timezone: 'Asia/Seoul',
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('NOT_CONNECTED');

    expect(Number((await alarmRow('guard-own'))!.is_active)).toBe(1);
    expect(await alarmCount()).toBe(1);
  });

  it('PK 와 로그인 id 가 다른 옛 계정도 자기 로그인 id 를 실으면 나로 읽는다 — 내 알람으로 201', async () => {
    const res = await postAlarm(SENDER_LEGACY, {
      time: '07:15',
      target_user_id: SENDER_LEGACY.login,
      timezone: 'Asia/Seoul',
    });
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { alarm: { id: string } }).alarm.id;
    expect(String((await alarmRow(id))!.user_id)).toBe(SENDER_LEGACY.pk);
  });
});

describe('본인 알람 PATCH', () => {
  it('본인 알람 PATCH 는 시각과 무관하게 200 — 리드타임·방해 금지 같은 가드가 없다', async () => {
    const create = await postAlarm(SENDER, { time: '12:00', timezone: 'Asia/Seoul' });
    expect(create.status).toBe(201);
    const id = ((await create.json()) as { alarm: { id: string } }).alarm.id;

    const res = await patchAlarm(SENDER, id, { time: '09:20' });
    expect(res.status).toBe(200);
    expect(String((await alarmRow(id))!.time)).toBe('09:20');
  });

  it('남의 알람은 PATCH 할 수 없다 — 404 ALARM_NOT_FOUND, 행은 그대로', async () => {
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, time, is_active)
            VALUES ('11111111-1111-4111-8111-111111111111', ?, '06:00', 1)`,
      args: [OTHER.pk],
    });

    const res = await patchAlarm(SENDER, '11111111-1111-4111-8111-111111111111', { time: '06:30' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('ALARM_NOT_FOUND');
    expect(String((await alarmRow('11111111-1111-4111-8111-111111111111'))!.time)).toBe('06:00');
  });
});
