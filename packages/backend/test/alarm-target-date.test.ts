import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq, ID } from './helpers';
import { validateAlarmFields, normalizeAlarmRow } from '../src/routes/alarm-helpers';
import { migrations } from '../src/lib/migrations';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import alarmMutation from '../src/routes/alarm-mutation';

/**
 * **날짜 지정 알람(한 번)** — `docs/spec/alarm-lifecycle.md` §4-7.
 * 서버는 알람 사본을 두지 않는다(#147). 옛 앱이 올리는 날짜는 형식·조합만 보고(지난 날짜는 거절하지 않는다)
 * 받은 그대로 되돌려 준다 — DB 는 보지 않는다(`alarm-compat.test.ts`).
 */
function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId, 'user@test.com', userId));
  app.route('/alarms', alarmMutation);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

describe('validateAlarmFields — target_date', () => {
  it('실제 날짜 + 시간대 + 빈 반복 요일이면 통과', () => {
    expect(
      validateAlarmFields({ target_date: '2026-10-27', timezone: 'Asia/Seoul', repeat_days: [] }),
    ).toBeNull();
  });

  it('지난 날짜도 통과한다 — 끝난 날짜 알람도 사본으로 올라온다', () => {
    expect(validateAlarmFields({ target_date: '2020-01-01', timezone: 'Asia/Seoul' })).toBeNull();
  });

  it('null 은 날짜 없음이라 통과', () => {
    expect(validateAlarmFields({ target_date: null, repeat_days: [1, 2] })).toBeNull();
  });

  it.each([
    ['없는 날짜', { target_date: '2026-02-30', timezone: 'Asia/Seoul' }],
    ['형식', { target_date: '2026/10/27', timezone: 'Asia/Seoul' }],
    ['반복 요일과 함께', { target_date: '2026-10-27', timezone: 'Asia/Seoul', repeat_days: [1] }],
    ['시간대 없음', { target_date: '2026-10-27' }],
    ['모르는 시간대', { target_date: '2026-10-27', timezone: 'Mars/Olympus' }],
  ])('%s → INVALID_TARGET_DATE', (_label, body) => {
    expect(validateAlarmFields(body)?.error_code).toBe('INVALID_TARGET_DATE');
  });
});

describe('normalizeAlarmRow — target_date', () => {
  it('저장된 날짜를 그대로, 없거나 깨진 값은 null 로 돌려준다', () => {
    expect(normalizeAlarmRow({ target_date: '2026-10-27' }).target_date).toBe('2026-10-27');
    expect(normalizeAlarmRow({ target_date: null }).target_date).toBeNull();
    expect(normalizeAlarmRow({}).target_date).toBeNull();
    expect(normalizeAlarmRow({ target_date: 'garbage' }).target_date).toBeNull();
  });
});

describe('마이그레이션 #140', () => {
  it('alarms.target_date 칸을 더한다(append-only)', () => {
    const m = migrations.find((entry) => entry.id === 140);
    expect(m?.name).toBe('alarm-target-date');
    expect(m?.statements).toEqual(['ALTER TABLE alarms ADD COLUMN target_date TEXT']);
  });
});

describe('POST·PATCH /alarms — target_date(저장 없이 되돌려 준다)', () => {
  it('날짜 알람은 응답에 날짜를 돌려주고, 날짜가 없으면 null 이다', async () => {
    const dated = await buildApp().request(
      jsonReq('POST', '/alarms', {
        time: '07:00',
        repeat_days: [],
        target_date: '2026-10-27',
        timezone: 'Asia/Seoul',
      }),
    );
    expect(dated.status).toBe(201);
    expect((await dated.json()).alarm).toMatchObject({ target_date: '2026-10-27', timezone: 'Asia/Seoul' });

    const undated = await buildApp().request(jsonReq('POST', '/alarms', { time: '07:00' }));
    expect(undated.status).toBe(201);
    expect((await undated.json()).alarm.target_date).toBeNull();
    expect(mockDB.calls).toHaveLength(0);
  });

  it.each(['POST', 'PATCH'] as const)('%s — 반복 요일과 날짜를 함께 보내면 400 INVALID_TARGET_DATE', async (method) => {
    const res = await buildApp().request(
      jsonReq(method, method === 'POST' ? '/alarms' : `/alarms/${ID.alarm}`, {
        time: '07:00',
        repeat_days: [1, 2],
        target_date: '2026-10-27',
        timezone: 'Asia/Seoul',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_TARGET_DATE');
    expect(mockDB.calls).toHaveLength(0);
  });
});
