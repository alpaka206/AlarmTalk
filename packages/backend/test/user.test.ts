import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import userRoutes from '../src/routes/user';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/user', userRoutes);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

describe('PATCH /user/me', () => {
  it.each([null, [], 'name', 1, true])('객체가 아닌 JSON %j 는 DB 접근 없이 400', async (body) => {
    const res = await buildApp().request('/user/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_REQUEST');
    expect(mockDB.calls).toHaveLength(0);
  });
  // 가족 알람 설정(`allow_family_alarms`·`family_alarm_quiet_*`)은 2026-10-20 에 칸째 없앴다. 옛 앱은 이름·문구 설정을
  // 저장할 때 그 키를 싣지 않지만(iOS 는 nil 을 빼고 안드로이드 Gson 은 null 을 버린다), 실어 와도 받고 무시한다.
  const FAMILY_KEYS = [
    'allow_family_alarms',
    'family_alarm_quiet_days',
    'family_alarm_quiet_start',
    'family_alarm_quiet_end',
    'family_alarm_quiet_windows',
  ];

  it('가족 알람 키만 오면 바꿀 것이 없다 — 400 NO_FIELDS_TO_UPDATE, DB 를 보지 않는다', async () => {
    const res = await buildApp().request(
      jsonReq('PATCH', '/user/me', {
        allow_family_alarms: true,
        family_alarm_quiet_days: [1, 2],
        family_alarm_quiet_start: '23:00',
        family_alarm_quiet_end: '07:00',
        family_alarm_quiet_windows: [],
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NO_FIELDS_TO_UPDATE');
    expect(mockDB.calls).toHaveLength(0);
  });

  it('이름과 가족 알람 키가 함께 오면 이름만 저장한다 — 이상한 값이어도 400 이 아니고 응답에도 없다', async () => {
    mockDB.pushResult([], 1);
    const res = await buildApp().request(
      jsonReq('PATCH', '/user/me', { name: '새 이름', allow_family_alarms: 'garbage' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, name: '새 이름', dynamic_prompt_settings: null });
    for (const key of FAMILY_KEYS) expect(body, key).not.toHaveProperty(key);
    expect(mockDB.calls).toHaveLength(1);
    expect(mockDB.calls[0]!.sql).toContain('UPDATE users SET name = ?');
    expect(mockDB.calls[0]!.sql).not.toMatch(/allow_family|family_alarm/);
    expect(mockDB.calls[0]!.args).toEqual(['새 이름', 'user-1']);
  });

  it('필드 누락 → 400 NO_FIELDS_TO_UPDATE', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('NO_FIELDS_TO_UPDATE');
  });

  it('존재하지 않는 사용자 → 404 USER_NOT_FOUND', async () => {
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { name: '새 이름' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('USER_NOT_FOUND');
  });

  it('잘못된 JSON 바디 → 400 NO_FIELDS_TO_UPDATE', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/user/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad json',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NO_FIELDS_TO_UPDATE');
  });

  it('dynamic_prompt_settings 저장 성공', async () => {
    mockDB.pushResult([], 1);
    const settings = {
      weather: { country: 'KR', city: 'Seoul' },
      fortune: { gender: '여성', birth_date: '1995-05-20', birth_time: '07:30' },
    };
    const app = buildApp();
    const res = await app.request(
      jsonReq('PATCH', '/user/me', { dynamic_prompt_settings: settings }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // 옛 글자('KR'·'Seoul')는 그대로 두고, 목록으로 되짚은 지역 키를 함께 적는다
    // (`normalizeWeatherSetting` — 상세는 weather-region-settings.test.ts).
    const stored = { ...settings, weather: { ...settings.weather, region: 'kr-seoul' } };
    expect(body.dynamic_prompt_settings).toEqual(stored);
    expect(mockDB.calls[0].sql).toContain('dynamic_prompt_settings_json = ?');
    expect(JSON.parse(String(mockDB.calls[0].args[0]))).toEqual(stored);
  });

  it('dynamic_prompt_settings 시간 형식 오류 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('PATCH', '/user/me', {
        dynamic_prompt_settings: {
          fortune: { birth_time: '25:99' },
        },
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_DYNAMIC_PROMPT_SETTINGS');
  });
});

describe('GET /user/consents/status — 마케팅 재유도', () => {
  function statusFor(
    rows: Array<{ consent_type: string; policy_version: string; agreed: number }>,
  ) {
    mockDB.setConsentMissing(true);
    mockDB.pushResult(rows);
    return buildApp().request('/user/consents/status', undefined, {} as AppEnv['Bindings']);
  }
  const current = CURRENT_POLICY_VERSION;

  it('거절자라도 다른 받을 게 없으면 화면을 열지 않는다', async () => {
    const res = await statusFor([
      { consent_type: 'terms', policy_version: current, agreed: 1 },
      { consent_type: 'privacy', policy_version: current, agreed: 1 },
      { consent_type: 'age14', policy_version: current, agreed: 1 },
      { consent_type: 'overseas_transfer', policy_version: current, agreed: 1 },
      { consent_type: 'voice_biometric', policy_version: current, agreed: 1 },
      { consent_type: 'marketing', policy_version: current, agreed: 0 },
    ]);
    const body = (await res.json()) as { collect: string[]; needs_collection: boolean };
    expect(body.collect).toEqual([]);
    expect(body.needs_collection).toBe(false);
  });

  it('다른 이유로 화면이 뜨면 거절자에게 마케팅을 함께 띄운다', async () => {
    const res = await statusFor([
      // terms 가 옛 버전이라 재동의 대상 — 화면이 뜬다.
      { consent_type: 'terms', policy_version: '1', agreed: 1 },
      { consent_type: 'privacy', policy_version: current, agreed: 1 },
      { consent_type: 'age14', policy_version: current, agreed: 1 },
      { consent_type: 'overseas_transfer', policy_version: current, agreed: 1 },
      { consent_type: 'voice_biometric', policy_version: current, agreed: 1 },
      { consent_type: 'marketing', policy_version: current, agreed: 0 },
    ]);
    const body = (await res.json()) as { collect: string[]; prechecked: string[] };
    expect(body.collect).toContain('terms');
    expect(body.collect).toContain('marketing');
    // 거절 상태이므로 미체크로 시작해야 한다.
    expect(body.prechecked).not.toContain('marketing');
  });

  it('마케팅에 **동의한** 사람은 끌어오지 않는다', async () => {
    const res = await statusFor([
      { consent_type: 'terms', policy_version: '1', agreed: 1 },
      { consent_type: 'privacy', policy_version: current, agreed: 1 },
      { consent_type: 'age14', policy_version: current, agreed: 1 },
      { consent_type: 'overseas_transfer', policy_version: current, agreed: 1 },
      { consent_type: 'voice_biometric', policy_version: current, agreed: 1 },
      { consent_type: 'marketing', policy_version: current, agreed: 1 },
    ]);
    const body = (await res.json()) as { collect: string[] };
    expect(body.collect).not.toContain('marketing');
  });

  /** 이미 동의한 선택 유형이 재동의 대상이면 **체크된 채로** 시작해야 한다. */
  it('이미 동의한 선택 유형은 prechecked 로 내려준다', async () => {
    const res = await statusFor([
      { consent_type: 'terms', policy_version: current, agreed: 1 },
      { consent_type: 'privacy', policy_version: current, agreed: 1 },
      { consent_type: 'age14', policy_version: current, agreed: 1 },
      { consent_type: 'overseas_transfer', policy_version: current, agreed: 1 },
      // 생체정보 동의가 옛 버전 → 재동의 대상인데, 이미 '동의' 상태다.
      { consent_type: 'voice_biometric', policy_version: '1', agreed: 1 },
      { consent_type: 'marketing', policy_version: current, agreed: 1 },
    ]);
    const body = (await res.json()) as { collect: string[]; prechecked: string[] };
    expect(body.collect).toContain('voice_biometric');
    expect(body.prechecked).toContain('voice_biometric');
  });
});
