import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

// 탈퇴 커밋 뒤 등급 변경 통지(배선만 본다). 나머지는 실제 구현 그대로 둔다 — 아래 DELETE
// 테스트들이 실제 파기 문장 순서를 확인한다.
const notifyBillingStateChanged = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
);
vi.mock('../src/lib/billing-cancel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/billing-cancel')>()),
  notifyBillingStateChanged,
}));
// 목소리 철회 통지 — 등급 통지와의 **순서**만 본다(코덱스 #841).
const notifyDowngradedAlarms = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
);
vi.mock('../src/lib/fcm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/fcm')>()),
  notifyDowngradedAlarms,
}));
vi.mock('../src/lib/account-deletion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/account-deletion')>();
  return { ...actual, purgeUserAccount: vi.fn(actual.purgeUserAccount) };
});

import userRoutes from '../src/routes/user';
import { purgeUserAccount } from '../src/lib/account-deletion';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/user', userRoutes);
  return app;
}

// 계정 삭제(가명보존)는 PASSWORD_PEPPER 가 필수(미설정 시 fail-closed 500) — 운영과 동일하게
// pepper 를 세팅한 env 로 요청한다.
const DELETE_ENV = { PASSWORD_PEPPER: 'test-pepper' } as unknown as AppEnv['Bindings'];

/** 파기 트랜잭션이 대기열에 적은 행 — 커밋 뒤 비우기가 이 행을 읽어 보낸다(실제 DB 는 `pending-plan-notifications.test.ts`). */
function queuedForDrain(userIds: string[]): void {
  mockDB.pushResultFor(
    'SELECT user_id, created_at, attempts FROM pending_plan_notifications',
    userIds.map((id) => ({ user_id: id, created_at: '2026-10-01 00:00:00.000', attempts: 0 })),
  );
  // 잡기(`UPDATE … RETURNING`) — 이 실행이 잡은 행만 보낸다.
  mockDB.pushResultFor(
    'UPDATE pending_plan_notifications',
    userIds.map((id) => ({ user_id: id, created_at: '2026-10-01 00:00:00.000', attempts: 1 })),
  );
}

const originalExecute = mockDB.client.execute;

beforeEach(() => {
  mockDB.reset();
  mockDB.client.execute = originalExecute;
  notifyBillingStateChanged.mockReset();
  notifyBillingStateChanged.mockImplementation(async () => undefined);
  notifyDowngradedAlarms.mockReset();
  notifyDowngradedAlarms.mockImplementation(async () => undefined);
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
  it('allow_family_alarms=true 성공', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.allow_family_alarms).toBe(true);
    expect(mockDB.calls[0].sql).toContain('UPDATE users SET allow_family_alarms');
    expect(mockDB.calls[0].args[0]).toBe(1);
  });

  it('allow_family_alarms=false 성공', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allow_family_alarms).toBe(false);
    expect(mockDB.calls[0].args[0]).toBe(0);
  });

  it('필드 누락 → 400 NO_FIELDS_TO_UPDATE', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('NO_FIELDS_TO_UPDATE');
  });

  it('잘못된 타입 → 400 INVALID_BOOLEAN', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: 'yes' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_BOOLEAN');
  });

  it('존재하지 않는 사용자 → 404 USER_NOT_FOUND', async () => {
    mockDB.pushResult([], 0);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: true }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('USER_NOT_FOUND');
  });

  it('toBoolFlag: 문자열 "1" → true', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: '1' }));
    expect(res.status).toBe(200);
    expect((await res.json()).allow_family_alarms).toBe(true);
    expect(mockDB.calls[0].args[0]).toBe(1);
  });

  it('toBoolFlag: 문자열 "0" → false', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: '0' }));
    expect(res.status).toBe(200);
    expect((await res.json()).allow_family_alarms).toBe(false);
    expect(mockDB.calls[0].args[0]).toBe(0);
  });

  it('toBoolFlag: 문자열 "true" → true', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: 'true' }));
    expect(res.status).toBe(200);
    expect((await res.json()).allow_family_alarms).toBe(true);
  });

  it('toBoolFlag: 문자열 "false" → false', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: 'false' }));
    expect(res.status).toBe(200);
    expect((await res.json()).allow_family_alarms).toBe(false);
  });

  it('toBoolFlag: 숫자 1 → true', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: 1 }));
    expect(res.status).toBe(200);
    expect((await res.json()).allow_family_alarms).toBe(true);
  });

  it('toBoolFlag: 숫자 0 → false', async () => {
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: 0 }));
    expect(res.status).toBe(200);
    expect((await res.json()).allow_family_alarms).toBe(false);
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
