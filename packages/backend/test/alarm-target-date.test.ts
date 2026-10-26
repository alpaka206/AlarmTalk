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
 * 서버 행은 기기의 사본이다: 날짜를 왕복 보존하고, 형식·조합만 본다(지난 날짜는 거절하지 않는다).
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

describe('POST /alarms — target_date', () => {
  it('날짜 알람을 저장한다 — INSERT 에 날짜와 확인한 시간대가 실리고 응답이 날짜를 돌려준다', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([], 1);
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', {
        time: '07:00',
        repeat_days: [],
        target_date: '2026-10-27',
        timezone: 'Asia/Seoul',
      }),
    );
    expect(res.status).toBe(201);
    const insert = mockDB.calls.find((call) => call.sql.includes('INSERT INTO alarms'))!;
    expect(insert.sql).toContain('target_date');
    expect(insert.args).toContain('2026-10-27');
    expect(insert.args).toContain('Asia/Seoul');
    expect((await res.json()).alarm.target_date).toBe('2026-10-27');
  });

  it('날짜 없는 알람도 그 칸에 NULL 을 쓴다(fail-closed — 마이그레이션 전이면 500)', async () => {
    mockDB.pushResult([{ plan: 'personal' }]);
    mockDB.pushResult([], 1);
    const res = await buildApp().request(jsonReq('POST', '/alarms', { time: '07:00' }));
    expect(res.status).toBe(201);
    const insert = mockDB.calls.find((call) => call.sql.includes('INSERT INTO alarms'))!;
    expect(insert.sql).toContain('target_date');
    expect(insert.args.at(-1)).toBeNull();
  });

  it('반복 요일과 날짜를 함께 보내면 400 — DB 를 보지 않는다', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/alarms', {
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

function pushPatchExisting(overrides: Record<string, unknown> = {}) {
  mockDB.pushResult([
    {
      id: ID.alarm,
      time: '07:00',
      repeat_days: '[]',
      is_active: 1,
      message_id: null,
      mode: 'sound-only',
      wake_mode: 'sound_then_voice',
      voice_profile_id: null,
      bucket_id: null,
      target_date: null,
      user_plan: 'personal',
      ...overrides,
    },
  ]);
}

function pushPatchResultRow(overrides: Record<string, unknown> = {}) {
  mockDB.pushResult([], 1);
  mockDB.pushResult([
    {
      id: ID.alarm,
      user_id: 'user-1',
      message_id: null,
      time: '07:00',
      repeat_days: '[]',
      is_active: 1,
      snooze_minutes: 5,
      mode: 'sound-only',
      vibration_pattern: 'default',
      wake_mode: 'sound_then_voice',
      voice_profile_id: null,
      bucket_id: null,
      timezone: 'Asia/Seoul',
      target_date: '2026-10-27',
      ...overrides,
    },
  ]);
}

describe('PATCH /alarms/:id — target_date', () => {
  it('날짜를 실어 보내면 그대로 적고 응답에 날짜·시간대를 돌려준다', async () => {
    pushPatchExisting();
    pushPatchResultRow();
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, {
        repeat_days: [],
        target_date: '2026-10-27',
        timezone: 'Asia/Seoul',
        is_active: false,
      }),
    );
    expect(res.status).toBe(200);
    const update = mockDB.calls.find((call) => call.sql.startsWith('UPDATE alarms'))!;
    expect(update.sql).toContain('target_date = ?');
    expect(update.args).toContain('2026-10-27');
    const body = await res.json();
    expect(body.alarm.target_date).toBe('2026-10-27');
    expect(body.alarm.timezone).toBe('Asia/Seoul');
  });

  it('null 을 보내면 날짜를 지운다(날짜 알람 → 반복 알람)', async () => {
    pushPatchExisting({ target_date: '2026-10-27' });
    pushPatchResultRow({ repeat_days: '[1,2]', target_date: null });
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { repeat_days: [1, 2], target_date: null }),
    );
    expect(res.status).toBe(200);
    const update = mockDB.calls.find((call) => call.sql.startsWith('UPDATE alarms'))!;
    expect(update.sql).toContain('target_date = ?');
    expect(update.args).toContain(null);
  });

  it('날짜를 싣지 않는 PATCH(옛 앱·토글)는 날짜를 건드리지 않는다', async () => {
    pushPatchExisting({ target_date: '2026-10-27' });
    pushPatchResultRow();
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { is_active: false }),
    );
    expect(res.status).toBe(200);
    const update = mockDB.calls.find((call) => call.sql.startsWith('UPDATE alarms'))!;
    expect(update.sql).not.toContain('target_date');
  });

  it('반복 요일만 실어 보내면 저장된 날짜를 지운다 — 보낸 기기에서는 반복 알람이다', async () => {
    pushPatchExisting({ target_date: '2026-10-27' });
    pushPatchResultRow({ repeat_days: '[1]', target_date: null });
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { repeat_days: [1] }),
    );
    expect(res.status).toBe(200);
    const update = mockDB.calls.find((call) => call.sql.startsWith('UPDATE alarms'))!;
    expect(update.sql).toContain('target_date = NULL');
  });

  it('날짜만 보냈는데 저장된 반복 요일이 있으면 400', async () => {
    pushPatchExisting({ repeat_days: '[1,3]' });
    const res = await buildApp().request(
      jsonReq('PATCH', `/alarms/${ID.alarm}`, { target_date: '2026-10-27', timezone: 'Asia/Seoul' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_TARGET_DATE');
    expect(mockDB.calls.some((call) => call.sql.startsWith('UPDATE alarms'))).toBe(false);
  });

  it('기존 행 조회가 날짜 칸을 읽는다(fail-closed — 마이그레이션 전이면 500)', async () => {
    pushPatchExisting();
    pushPatchResultRow();
    await buildApp().request(jsonReq('PATCH', `/alarms/${ID.alarm}`, { is_active: true }));
    expect(mockDB.calls[0]!.sql).toContain('a.target_date');
  });
});
