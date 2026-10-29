import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { ownAlarmIdentity } from '../src/lib/alarm-identity';
import { fakeAuthMiddleware, jsonReq } from './helpers';

/**
 * **옛 앱의 알람 올리기는 저장 없이 되돌려 준다**(2026-10-29 서버 알람 사본 삭제, 마이그레이션 #147 — `routes/alarm-mutation.ts`).
 *
 * 1.2.16 앱은 알람을 저장·켜고 끄고·지울 때마다 `POST/PATCH/DELETE /alarm` 을 부른다. 404 를 주면 실패로 보고 계속 다시
 * 보내므로 형식만 보고 받은 그대로 되돌려 준다 — 그 앱이 응답에서 반드시 읽는 것은 `alarm.id` 하나다.
 */
const dbCalls: unknown[] = [];
vi.mock('../src/lib/db', () => ({
  getDB: () =>
    new Proxy(
      {},
      {
        get: () => (...args: unknown[]) => {
          dbCalls.push(args);
          throw new Error('알람 호환 경로는 DB 를 부르지 않는다');
        },
      },
    ),
}));
import alarmMutation from '../src/routes/alarm-mutation';

const clientAlarmId = '11111111-1111-4111-8111-111111111111';

function app(owner = 'owner') {
  const result = new Hono<AppEnv>();
  result.use('*', fakeAuthMiddleware(owner));
  result.route('/alarm', alarmMutation);
  return result;
}

const fullBody = {
  time: '07:30',
  repeat_days: [1, 2, 3],
  snooze_minutes: 5,
  mode: 'tts',
  vibration_pattern: 'default',
  wake_mode: 'voice_only',
  is_active: true,
  voice_profile_id: '22222222-2222-4222-8222-222222222222',
  message_id: '33333333-3333-4333-8333-333333333333',
  bucket_id: 'cheer',
  timezone: 'Asia/Seoul',
  client_alarm_id: clientAlarmId,
};

beforeEach(() => {
  dbCalls.length = 0;
});
afterEach(() => {
  expect(dbCalls).toHaveLength(0);
});

describe('POST /alarm — 저장하지 않고 받은 그대로', () => {
  it('201 과 함께 받은 값을 돌려주고, 기기 id 로 정한 서버 id 를 싣는다', async () => {
    const res = await app().request(jsonReq('POST', '/alarm', fullBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alarm).toMatchObject({
      time: '07:30',
      repeat_days: [1, 2, 3],
      voice_profile_id: fullBody.voice_profile_id,
      message_id: fullBody.message_id,
      bucket_id: 'cheer',
      is_active: true,
      creation_replayed: false,
    });
    expect(body.alarm.id).toBe(await ownAlarmIdentity('owner', clientAlarmId));
  });

  it('같은 기기 id 로 다시 보내면 같은 서버 id, 계정이 다르면 다른 id 다', async () => {
    const first = await (await app().request(jsonReq('POST', '/alarm', fullBody))).json();
    const retry = await (await app().request(jsonReq('POST', '/alarm', fullBody))).json();
    const other = await (await app('other').request(jsonReq('POST', '/alarm', fullBody))).json();
    expect(retry.alarm.id).toBe(first.alarm.id);
    expect(other.alarm.id).not.toBe(first.alarm.id);
  });

  it('기기 id 가 없어도 서버 id 를 싣는다', async () => {
    const { client_alarm_id: _omitted, ...withoutClientId } = fullBody;
    const body = await (await app().request(jsonReq('POST', '/alarm', withoutClientId))).json();
    expect(body.alarm.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.alarm).not.toHaveProperty('creation_replayed');
  });

  it.each([
    [{ ...fullBody, time: undefined }, 'REQUIRED_FIELDS_MISSING'],
    [{ ...fullBody, client_alarm_id: 'not-a-uuid' }, 'INVALID_ALARM_ID'],
    [{ ...fullBody, time: '25:00' }, undefined],
  ])('형식이 틀리면 예전처럼 400 — %j', async (body, code) => {
    const res = await app().request(jsonReq('POST', '/alarm', body));
    expect(res.status).toBe(400);
    if (code) expect((await res.json()).error_code).toBe(code);
  });

  it('남을 가리키는 알람은 403 NOT_CONNECTED, 나를 가리키면 받는다(응답에 싣지 않는다)', async () => {
    const other = await app().request(jsonReq('POST', '/alarm', { ...fullBody, target_user_id: 'someone-else' }));
    expect(other.status).toBe(403);
    expect((await other.json()).error_code).toBe('NOT_CONNECTED');

    const mine = await app().request(jsonReq('POST', '/alarm', { ...fullBody, target_user_id: 'owner' }));
    expect(mine.status).toBe(201);
    expect((await mine.json()).alarm).not.toHaveProperty('target_user_id');
  });
});

describe('PATCH·DELETE /alarm/:id — 저장하지 않는다', () => {
  const id = '44444444-4444-4444-8444-444444444444';

  it('PATCH 는 받은 값을 그 id 로 돌려준다', async () => {
    const res = await app().request(jsonReq('PATCH', `/alarm/${id}`, { ...fullBody, is_active: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, alarm: { id, is_active: false, time: '07:30' } });
  });

  it('DELETE 는 200 success', async () => {
    const res = await app().request(new Request(`http://localhost/alarm/${id}`, { method: 'DELETE' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it('id 형식이 틀리면 400 INVALID_ALARM_ID', async () => {
    const patch = await app().request(jsonReq('PATCH', '/alarm/not-a-uuid', fullBody));
    const del = await app().request(new Request('http://localhost/alarm/not-a-uuid', { method: 'DELETE' }));
    expect(patch.status).toBe(400);
    expect(del.status).toBe(400);
    expect((await patch.json()).error_code).toBe('INVALID_ALARM_ID');
  });
});
