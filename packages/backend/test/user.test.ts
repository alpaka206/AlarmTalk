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

// 계정 삭제(가명보존)는 PASSWORD_PEPPER 가 필수(미설정 시 fail-closed 500) — 운영과 동일하게
// pepper 를 세팅한 env 로 요청한다.
const DELETE_ENV = { PASSWORD_PEPPER: 'test-pepper' } as unknown as AppEnv['Bindings'];

const originalExecute = mockDB.client.execute;

beforeEach(() => {
  mockDB.reset();
  mockDB.client.execute = originalExecute;
});

describe('PATCH /user/me', () => {
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
    expect(body.dynamic_prompt_settings).toEqual(settings);
    expect(mockDB.calls[0].sql).toContain('dynamic_prompt_settings_json = ?');
    expect(JSON.parse(String(mockDB.calls[0].args[0]))).toEqual(settings);
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

describe('DELETE /user/me', () => {
  it('모든 관련 데이터 삭제 후 성공', async () => {
    mockDB.pushResult([{ id: 'pk-1' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/user/me'), undefined, DELETE_ENV);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const sqls = mockDB.calls.map((c) => c.sql);
    const indexOf = (pattern: string) => sqls.findIndex((sql) => sql.includes(pattern));
    // 첫 쿼리는 계정 조회다. 컬럼 목록까지 문자열로 물면 컬럼이 하나 늘 때마다
    // 깨지므로(apple_refresh_token 추가 때 실제로 깨졌다) 테이블만 본다.
    expect(indexOf('FROM users WHERE google_id')).toBe(0);
    expect(indexOf('DELETE FROM voucher_redemptions')).toBeLessThan(indexOf('DELETE FROM voucher_codes'));
    expect(indexOf('DELETE FROM voucher_codes')).toBeLessThan(indexOf('DELETE FROM subscriptions'));
    expect(indexOf('DELETE FROM plan_group_invites')).toBeLessThan(indexOf('DELETE FROM plan_groups'));
    expect(indexOf('DELETE FROM message_library')).toBeLessThan(indexOf('DELETE FROM messages'));
    expect(indexOf('DELETE FROM messages')).toBeLessThan(indexOf('DELETE FROM voice_profiles'));
    expect(indexOf('DELETE FROM users')).toBeGreaterThan(indexOf('DELETE FROM voice_profiles'));
  });

it('userPk 미해석인데 사용자 행이 존재하면 throw → 500 (고아 PII 방지)', async () => {
    // 1) SELECT id FROM users (DELETE 핸들러) → 미해석(null)
    mockDB.pushResult([]);
    // 2) purgeUserAccount 의 orphan guard SELECT → 사용자 행 존재
    mockDB.pushResult([{ id: 'ghost-pk' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('DELETE', '/user/me'), undefined, DELETE_ENV);
    expect(res.status).toBe(500);
    expect((await res.json()).error_code).toBe('DELETE_ACCOUNT_FAILED');
  });

  it('DB 에러 → 500 DELETE_ACCOUNT_FAILED', async () => {
    const app = buildApp();
    mockDB.client.execute = async () => {
      throw new Error('DB down');
    };
    const res = await app.request(jsonReq('DELETE', '/user/me'), undefined, DELETE_ENV);
    expect(res.status).toBe(500);
    expect((await res.json()).error_code).toBe('DELETE_ACCOUNT_FAILED');
  });
});


/**
 * 마케팅 재유도 — 거절자에게만, 다른 이유로 화면이 이미 뜰 때만.
 *
 * ⚠ 두 조건을 함께 봐야 한다. `collect.length > 0` 가드가 없으면 거절자는 동의 화면을
 * **영원히** 본다(안 누르면 계속 남는다). `agreed === false` 조건이 없으면 **동의한 사람**
 * 까지 끌려와 무심코 지나칠 때 멀쩡한 동의가 사라진다.
 */
describe('GET /user/consents/status — 마케팅 재유도', () => {
  function statusFor(rows: Array<{ consent_type: string; policy_version: string; agreed: number }>) {
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
})
