import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import { UsageEventSchema } from '@alarmtalk/shared';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import { ownAlarmIdentity } from '../src/lib/alarm-identity';
import { fakeAuthMiddleware, jsonReq } from './helpers';

let database: Client;
vi.mock('../src/lib/db', () => ({ getDB: () => database }));
import alarmMutation from '../src/routes/alarm-mutation';

const clientAlarmId = '11111111-1111-4111-8111-111111111111';

function app(owner = 'owner') {
  const result = new Hono<AppEnv>();
  result.use('*', fakeAuthMiddleware(owner));
  result.route('/alarm', alarmMutation);
  return result;
}

describe('본인 알람 생성 재전송', () => {
  beforeEach(async () => {
    database = createClient({ url: ':memory:' });
    await runMigrations(database);
    await database.execute("INSERT INTO users (id, google_id, email) VALUES ('owner', 'owner', 'owner@example.test'), ('other', 'other', 'other@example.test')");
  });
  afterEach(() => database.close());

  it('응답을 잃어 재전송해도 서버 행은 하나다', async () => {
    const request = { time: '07:30', client_alarm_id: clientAlarmId };
    const first = await app().request(jsonReq('POST', '/alarm', request));
    const retry = await app().request(jsonReq('POST', '/alarm', request));
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    const firstBody = await first.json();
    const retryBody = await retry.json();
    expect(retryBody.alarm.id).toBe(firstBody.alarm.id);
    expect(firstBody.alarm.creation_replayed).toBe(false);
    expect(UsageEventSchema.shape.alarm_id.safeParse(firstBody.alarm.id).success).toBe(true);
    expect(retryBody.alarm.creation_replayed).toBe(true);
    expect((await database.execute('SELECT id FROM alarms')).rows).toHaveLength(1);
  });

  it('동일한 로컬 UUID라도 계정이 다르면 다른 행이다', async () => {
    const request = { time: '07:30', client_alarm_id: clientAlarmId };
    const first = await (await app().request(jsonReq('POST', '/alarm', request))).json();
    const second = await (await app('other').request(jsonReq('POST', '/alarm', request))).json();
    expect(first.alarm.id).not.toBe(second.alarm.id);
    expect((await database.execute('SELECT id FROM alarms')).rows).toHaveLength(2);
  });

  it('꺼진 로컬 알람의 최초 생성도 꺼진 상태로 저장한다', async () => {
    const response = await app().request(jsonReq('POST', '/alarm', {
      time: '07:30', client_alarm_id: clientAlarmId, is_active: false,
    }));
    expect(response.status).toBe(201);
    expect((await response.json()).alarm.is_active).toBe(false);
    expect((await database.execute('SELECT is_active FROM alarms')).rows[0]?.is_active).toBe(0);
  });

  it('요청에 임의 ID가 있어도 실제 서버 ID를 응답한다', async () => {
    const response = await app().request(jsonReq('POST', '/alarm', {
      time: '07:30', client_alarm_id: clientAlarmId, id: 'forged',
    }));
    expect(response.status).toBe(201);
    const stored = (await database.execute('SELECT id, is_active FROM alarms')).rows[0];
    expect((await response.json()).alarm.id).toBe(stored?.id);
    expect(stored?.id).not.toBe('forged');
    expect(stored?.is_active).toBe(1);
  });

  it('늦은 생성 재시도는 이미 PATCH한 내용을 되돌리지 않는다', async () => {
    const request = { time: '07:30', client_alarm_id: clientAlarmId };
    const created = await (await app().request(jsonReq('POST', '/alarm', request))).json();
    const patched = await app().request(jsonReq('PATCH', `/alarm/${created.alarm.id}`, { time: '09:30' }));
    expect(patched.status).toBe(200);
    const replay = await app().request(jsonReq('POST', '/alarm', request));
    expect((await replay.json()).alarm.creation_replayed).toBe(true);
    expect((await database.execute('SELECT time FROM alarms')).rows[0]?.time).toBe('09:30');
  });

  it('잘못된 클라 UUID는 쓰기 전에 거절한다', async () => {
    const response = await app().request(jsonReq('POST', '/alarm', { time: '07:30', client_alarm_id: '../alarm' }));
    expect(response.status).toBe(400);
    expect((await database.execute('SELECT id FROM alarms')).rows).toHaveLength(0);
  });

  it('대문자 UUID의 재전송도 같은 서버 ID다', async () => {
    const identifier = 'aabbccdd-1111-4111-8111-111111111111';
    expect(await ownAlarmIdentity('owner', identifier)).toBe(await ownAlarmIdentity('owner', identifier.toUpperCase()));
  });
});
