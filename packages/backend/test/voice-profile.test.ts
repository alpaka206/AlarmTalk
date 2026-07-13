import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';

const V1 = '40000000-0000-4000-8000-000000000001';
const V2 = '40000000-0000-4000-8000-000000000002';
const V_BAD = 'not-a-uuid';

const mockDB = createMockDB();
const mockCreateInstantClone = vi.fn();
const mockDeleteVoice = vi.fn();

function consentRow(type: string) {
  return { consent_type: type, policy_version: CURRENT_POLICY_VERSION, agreed: 1 };
}

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

vi.mock('../src/lib/elevenlabs', () => ({
  ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.createInstantClone = mockCreateInstantClone;
    this.deleteVoice = mockDeleteVoice;
  }),
}));

import voiceProfile from '../src/routes/voice-profile';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'test-key',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/vp', voiceProfile);
  return app;
}

function req(app: Hono<AppEnv>, r: Request) {
  return app.request(r, undefined, ENV);
}

function cloneForm(
  audio: Uint8Array | null,
  name: string | null,
  durationMs = '90000',
  audioType = 'audio/wav',
  audioName = 'sample.wav',
  isDraft = true,
): Request {
  const form = new FormData();
  if (audio) form.append('audio', new Blob([audio], { type: audioType }), audioName);
  if (name) form.append('name', name);
  if (durationMs) form.append('durationMs', durationMs);
  form.append('isDraft', String(isDraft));
  return new Request('http://localhost/vp/clone', { method: 'POST', body: form });
}

beforeEach(() => {
  mockDB.reset();
  mockCreateInstantClone.mockReset();
  mockDeleteVoice.mockReset();
});

/* ------------------------------------------------------------------ */
/*  GET /vp — 프로필 목록                                              */
/* ------------------------------------------------------------------ */
describe('GET / — 프로필 목록 (voice-profile)', () => {
  it('빈 목록', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    const res = await req(buildApp(), new Request('http://localhost/vp'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('기본 pagination limit=50, offset=0', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: V1, name: '테스트' }]);
    const res = await req(buildApp(), new Request('http://localhost/vp'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.profiles).toHaveLength(1);
  });

  it('limit 최대 100 으로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp?limit=999'));
    const call = mockDB.calls[1]!;
    expect(call.args).toContain(100);
  });

  it('limit=0 은 기본값 50 으로 폴백 (falsy)', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp?limit=0'));
    const call = mockDB.calls[1]!;
    expect(call.args).toContain(50);
  });

  it('offset 음수이면 0 으로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp?offset=-5'));
    const call = mockDB.calls[1]!;
    expect(call.args).toContain(0);
  });

  it('유효한 status 필터 적용', async () => {
    mockDB.pushResult([{ total: 1 }]);
    mockDB.pushResult([{ id: V1, name: 'ok', status: 'ready' }]);
    await req(buildApp(), new Request('http://localhost/vp?status=ready'));
    expect(mockDB.calls[0]!.sql).toContain('AND status = ?');
    expect(mockDB.calls[0]!.args).toContain('ready');
  });

  it('무효한 status 는 무시', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp?status=invalid'));
    expect(mockDB.calls[0]!.sql).not.toContain('AND status');
  });

  it('processing/failed status 도 유효', async () => {
    for (const st of ['processing', 'failed']) {
      mockDB.reset();
      mockDB.pushResult([{ total: 0 }]);
      mockDB.pushResult([]);
      await req(buildApp(), new Request(`http://localhost/vp?status=${st}`));
      expect(mockDB.calls[0]!.sql).toContain('AND status = ?');
      expect(mockDB.calls[0]!.args).toContain(st);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  GET /vp/:id — 프로필 상세                                          */
/* ------------------------------------------------------------------ */
describe('GET /:id — 프로필 상세 (voice-profile)', () => {
  it('잘못된 UUID → 400', async () => {
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V_BAD}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}`));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('자신의 프로필이면 200 반환', async () => {
    mockDB.pushResult([{ id: V1, name: '엄마', status: 'ready' }]);
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.id).toBe(V1);
    expect(body.profile.name).toBe('엄마');
  });

  it('쿼리에 user_id 포함 (소유권 검증)', async () => {
    mockDB.pushResult([{ id: V1 }]);
    await req(buildApp('user-A'), new Request(`http://localhost/vp/${V1}`));
    expect(mockDB.calls[0]!.args).toContain('user-A');
  });
});

/* ------------------------------------------------------------------ */
/*  PATCH /vp/:id — 이름 변경                                         */
/* ------------------------------------------------------------------ */
describe('PATCH /:id — 이름 변경 (voice-profile)', () => {
  it('잘못된 UUID → 400', async () => {
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V_BAD}`, { name: 'ok' }));
    expect(res.status).toBe(400);
  });

  it('JSON 아닌 body → 400', async () => {
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'PATCH', body: 'plain text' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('JSON_BODY_REQUIRED');
  });

  it('빈 이름 → 400', async () => {
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: '' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_NAME_LENGTH');
  });

  it('공백만 → 400 (trim 후 빈 문자열)', async () => {
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: '   ' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_NAME_LENGTH');
  });

  it('51자 초과 → 400', async () => {
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: 'x'.repeat(51) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_NAME_LENGTH');
  });

  it('50자 정확히 → 통과', async () => {
    mockDB.pushResult([{ id: V1 }]);
    mockDB.pushResult([], 1);
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: 'a'.repeat(50) }));
    expect(res.status).toBe(200);
  });

  it('name 이 숫자이면 빈 문자열로 처리 → 400', async () => {
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: 123 }));
    expect(res.status).toBe(400);
  });

  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: '새이름' }));
    expect(res.status).toBe(404);
  });

  it('정상 변경 시 200 + updated_at 갱신 쿼리', async () => {
    mockDB.pushResult([{ id: V1 }]);
    mockDB.pushResult([], 1);
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: '새 이름' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.id).toBe(V1);
    expect(body.profile.name).toBe('새 이름');
    const updateCall = mockDB.calls[1]!;
    expect(updateCall.sql).toContain('updated_at');
    expect(updateCall.sql).toContain('deleted_at IS NULL');
    expect(updateCall.args).toContain('새 이름');
  });

  it('존재 확인과 UPDATE 사이에 소프트 삭제되면(고아 draft 스윕 레이스) 404', async () => {
    // 존재 확인은 통과하지만 UPDATE 가 deleted_at IS NULL 가드로 0행 매칭 → 404.
    // 200 을 돌려주면 클론 파기 큐에 적재된 draft 를 promote 한 것처럼 보이게 된다.
    mockDB.pushResult([{ id: V1 }]);
    mockDB.pushResult([], 0);
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: '새이름' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('draft promote is blocked when monthly voice-change ledger is already reserved', async () => {
    mockDB.pushResult([{ id: V1, is_draft: 1, previewed_at: '2026-07-14 00:00:00' }]);
    mockDB.pushResult([{ active_count: 0, monthly_count: 0 }]);
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 0);

    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { is_draft: false }));

    expect(res.status).toBe(429);
    expect((await res.json()).error_code).toBe('VOICE_MONTHLY_CHANGE_LIMIT_REACHED');
    const ledgerCall = mockDB.calls.find((call) =>
      call.sql.includes('INSERT OR IGNORE INTO voice_profile_change_ledger'),
    );
    expect(ledgerCall).toBeDefined();
    expect(mockDB.calls.some((call) => call.sql.startsWith('UPDATE voice_profiles'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  GET /vp/:id/stats — 통계                                          */
/* ------------------------------------------------------------------ */
describe('GET /:id/stats — 통계 (voice-profile)', () => {
  it('잘못된 UUID → 400', async () => {
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V_BAD}/stats`));
    expect(res.status).toBe(400);
  });

  it('프로필 없으면 404', async () => {
    mockDB.pushResult([]);
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([{ count: 0 }]);
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}/stats`));
    expect(res.status).toBe(404);
  });

  it('통계 반환 (메시지 3개, 알람 2개)', async () => {
    mockDB.pushResult([{ id: V1, name: '엄마' }]);
    mockDB.pushResult([{ count: 3 }]);
    mockDB.pushResult([{ count: 2 }]);
    const res = await req(buildApp(), new Request(`http://localhost/vp/${V1}/stats`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voice_profile_id).toBe(V1);
    expect(body.messages).toBe(3);
    expect(body.alarms).toBe(2);
  });

  it('alarms 쿼리에 target_user_id 포함 (수신 알람 포함)', async () => {
    mockDB.pushResult([{ id: V1, name: 'x' }]);
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([{ count: 0 }]);
    await req(buildApp('user-X'), new Request(`http://localhost/vp/${V1}/stats`));
    const alarmCall = mockDB.calls[2]!;
    expect(alarmCall.sql).toContain('target_user_id');
    expect(alarmCall.args).toContain('user-X');
  });
});

/* ------------------------------------------------------------------ */
/*  POST /vp/clone — 음성 클론                                         */
/* ------------------------------------------------------------------ */
describe('POST /clone — 음성 클론 (voice-profile)', () => {
  it('정식 음성 직접 생성은 미리듣기 우회이므로 거부한다', async () => {
    const res = await req(
      buildApp(),
      cloneForm(new Uint8Array([1, 2, 3]), '우회 시도', '90000', 'audio/wav', 'sample.wav', false),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('VOICE_DRAFT_REQUIRED');
    expect(mockCreateInstantClone).not.toHaveBeenCalled();
  });

  it('draft 미리듣기 완료 전에는 정식 음성으로 승격할 수 없다', async () => {
    mockDB.pushResult([{ id: V1, is_draft: 1, previewed_at: null }]);

    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { is_draft: false }));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('VOICE_PREVIEW_REQUIRED');
    expect(mockDB.calls.some((call) => call.sql.includes('voice_profile_change_ledger'))).toBe(
      false,
    );
  });

  it('정식 등록 후 관계와 호칭은 프리셋 정합성을 위해 변경할 수 없다', async () => {
    mockDB.pushResult([{ id: V1, is_draft: 0, previewed_at: '2026-07-14 00:00:00' }]);

    const res = await req(
      buildApp(),
      jsonReq('PATCH', `/vp/${V1}`, { relationship_label: '친구' }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('VOICE_PERSONA_LOCKED');
  });
  it('voice_biometric 동의 없으면 403 CONSENT_REQUIRED (B4)', async () => {
    // 생체정보(음성 클론) 별도 동의 미충족 시 클로닝을 차단한다. 동의 쿼리는
    // missing 모드로 두고 빈 결과(미동의)를 돌려준다.
    mockDB.setConsentMissing(true);
    mockDB.pushResult([]); // user_consents 조회 결과: 동의 없음
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2, 3]), '엄마 목소리'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('CONSENT_REQUIRED');
    expect(body.consent).toBe('voice_biometric');
    // 동의 게이트에서 막혔으므로 ElevenLabs 클론은 호출되지 않는다.
    expect(mockCreateInstantClone).not.toHaveBeenCalled();
  });

  it('overseas_transfer 동의 없으면 ElevenLabs 클론을 호출하지 않음', async () => {
    mockDB.setConsentMissing(true);
    mockDB.pushResult([consentRow('voice_biometric')]);

    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2, 3]), '엄마 목소리'));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('CONSENT_REQUIRED');
    expect(body.consent).toBe('overseas_transfer');
    expect(mockCreateInstantClone).not.toHaveBeenCalled();
  });

  it('voice_biometric 동의가 있으면 클로닝 진행 (B4)', async () => {
    // 기본 모드(setConsentMissing 미설정): 헬퍼가 모든 동의를 합성 충족 → 통과.
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-consent-ok' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2]), '엄마 목소리'));
    expect(res.status).toBe(201);
    expect(mockCreateInstantClone).toHaveBeenCalledOnce();
  });

  it('프로필 1개 이상이면 403 VOICE_LIMIT_REACHED', async () => {
    mockDB.pushResult([{ count: 1 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2, 3]), '테스트'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_LIMIT_REACHED');
    expect(body.error).toContain('1');
  });

  it('이번 달 초안 제공자 시도를 모두 썼으면 429 VOICE_DRAFT_ATTEMPT_LIMIT_REACHED', async () => {
    mockDB.pushResult([{ active_count: 0, monthly_count: 0 }]);
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 0);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2, 3]), '새 목소리'));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_DRAFT_ATTEMPT_LIMIT_REACHED');
    expect(mockCreateInstantClone).not.toHaveBeenCalled();
    const ledgerCall = mockDB.calls.find((call) => call.sql.includes('voice_draft_attempt_usage'));
    expect(ledgerCall).toBeDefined();
  });

  it('프로필이 없으면 통과', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-1' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2]), '첫번째'));
    expect(res.status).toBe(201);
  });

  it('쿼터 카운트는 failed 잔여 행을 제외한다 (일시 실패가 한도를 영구 잠식하지 않도록)', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-quota' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2]), '쿼터'));
    expect(res.status).toBe(201);

    const quotaCall = mockDB.calls.find((call) => call.sql.includes('FROM voice_profiles'));
    expect(quotaCall).toBeDefined();
    expect(quotaCall!.sql).toContain("status != 'failed'");
    expect(mockDB.calls.some((call) => call.sql.includes('voice_draft_attempt_usage'))).toBe(true);
    expect(mockDB.calls.some((call) => call.sql.includes('voice_profile_change_ledger'))).toBe(
      false,
    );
  });

  it('audio 누락 → 400', async () => {
    mockDB.pushResult([{ count: 0 }]);
    const form = new FormData();
    form.append('name', 'test');
    form.append('isDraft', 'true');
    const res = await req(
      buildApp(),
      new Request('http://localhost/vp/clone', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUDIO_AND_NAME_REQUIRED');
  });

  it('name 누락 → 400', async () => {
    mockDB.pushResult([{ count: 0 }]);
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array([1])], { type: 'audio/wav' }), 'a.wav');
    form.append('isDraft', 'true');
    const res = await req(
      buildApp(),
      new Request('http://localhost/vp/clone', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUDIO_AND_NAME_REQUIRED');
  });

  it('name 50자 초과 → 400', async () => {
    mockDB.pushResult([{ count: 0 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'x'.repeat(51)));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NAME_TOO_LONG');
  });

  it('durationMs 생략 시 400', async () => {
    mockDB.pushResult([{ count: 0 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'name', ''));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_DURATION');
  });

  it('초안 최소 12초 미만 durationMs 는 400', async () => {
    mockDB.pushResult([{ count: 0 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'name', '11999'));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_CLONE_AUDIO_TOO_SHORT');
  });

  it('2분에서 5초 이내 durationMs 오차는 허용', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-ok' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'name', '125000'));
    expect(res.status).toBe(201);
  });

  it('2분 5초를 넘는 durationMs 는 400', async () => {
    mockDB.pushResult([{ count: 0 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'name', '125001'));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_CLONE_AUDIO_TOO_LONG');
  });

  it('name 50자 정확히 → 통과', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-2' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2]), 'a'.repeat(50)));
    expect(res.status).toBe(201);
  });

  it('성공 시 INSERT processing → UPDATE ready 순서', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-ok' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2, 3]), '엄마'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.profile.name).toBe('엄마');
    expect(body.profile.voice_id).toBe('elv-ok');
    expect(body.profile.status).toBe('ready');

    const insertCall = mockDB.calls.find((call) =>
      call.sql.includes('INSERT INTO voice_profiles'),
    )!;
    expect(insertCall.sql).toContain('INSERT INTO voice_profiles');
    expect(insertCall.sql).toContain("'processing'");

    const updateCall = mockDB.calls.find((call) => call.sql.includes("status = 'ready'"))!;
    expect(updateCall.sql).toContain("status = 'ready'");
    expect(updateCall.args).toContain('elv-ok');
  });

  it('ElevenLabs 실패 → 500 VOICE_CLONING_FAILED', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockRejectedValue(new Error('API down'));
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2]), 'test'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_CLONING_FAILED');
    expect(body.detail).toBe('API down');

    // 클론 실패 시 stuck 'processing' 방지: 해당 row 를 'failed' 로 정리해야 한다.
    const insertCall = mockDB.calls.find((call) =>
      call.sql.includes('INSERT INTO voice_profiles'),
    )!;
    const insertedId = insertCall.args[0];
    const failedCall = mockDB.calls.find((call) => call.sql.includes("status = 'failed'"));
    expect(failedCall).toBeDefined();
    expect(failedCall!.args).toContain(insertedId);
  });

  it('ElevenLabs 에 audioBuffer 전달 확인', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-x' });
    await req(buildApp(), cloneForm(new Uint8Array([10, 20, 30]), '이름'));
    expect(mockCreateInstantClone).toHaveBeenCalledOnce();
    const [audioArg, nameArg, optionsArg] = mockCreateInstantClone.mock.calls[0]! as [
      ArrayBuffer,
      string,
      { removeBackgroundNoise?: boolean; mimeType?: string; fileName?: string },
    ];
    expect(new Uint8Array(audioArg)).toEqual(new Uint8Array([10, 20, 30]));
    expect(nameArg).toBe('이름');
    expect(optionsArg).toEqual({
      removeBackgroundNoise: true,
      mimeType: 'audio/wav',
      fileName: 'sample.wav',
    });
  });

  it('mp3 clone 업로드 MIME 과 파일명을 ElevenLabs 로 전달', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-x' });

    const res = await req(
      buildApp(),
      cloneForm(new Uint8Array([10, 20, 30]), '이름', '90000', 'audio/mpeg', 'voice.mp3'),
    );

    expect(res.status).toBe(201);
    expect(mockCreateInstantClone).toHaveBeenCalledOnce();
    const [, , optionsArg] = mockCreateInstantClone.mock.calls[0]! as [
      ArrayBuffer,
      string,
      { removeBackgroundNoise?: boolean; mimeType?: string; fileName?: string },
    ];
    expect(optionsArg).toMatchObject({
      mimeType: 'audio/mpeg',
      fileName: 'voice.mp3',
    });
  });

  it('ElevenLabs 슬롯 부족 시 503 + VOICE_SLOT_EXHAUSTED', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockRejectedValue(
      new Error(
        'ElevenLabs clone error 400: {"detail":{"status":"voice_limit_reached","message":"You have reached your maximum voice limit."}}',
      ),
    );
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'name'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_SLOT_EXHAUSTED');
    expect(body.error).toContain('서비스가 확장중');
  });
});

/* ------------------------------------------------------------------ */
/*  DELETE /vp/:id — 프로필 삭제                                       */
/* ------------------------------------------------------------------ */
describe('DELETE /:id — 프로필 삭제 (voice-profile)', () => {
  it('잘못된 UUID → 400', async () => {
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V_BAD}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(400);
  });

  it('존재하지 않으면 404', async () => {
    mockDB.pushResult([]);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);
  });

  it('생성된 음원은 정리하되 메시지와 알람 자체는 보존', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: null }]);
    mockDB.pushResult([], 1);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(true);
    expect(
      mockDB.calls.some(
        (c) => c.sql.startsWith('DELETE FROM messages') || c.sql.startsWith('DELETE FROM alarms'),
      ),
    ).toBe(false);
    const assetsDelete = mockDB.calls.find((c) =>
      c.sql.startsWith('DELETE FROM generated_audio_assets'),
    );
    expect(assetsDelete).toBeDefined();
    const alarmsCascade = mockDB.calls.find((c) => c.sql.startsWith('UPDATE alarms'));
    expect(alarmsCascade).toBeDefined();
    expect(alarmsCascade!.sql).toContain("mode = 'sound-only'");
    expect(alarmsCascade!.sql).toContain("wake_mode = 'sound_then_voice'");
    expect(alarmsCascade!.sql).toContain('message_id = NULL');
    expect(alarmsCascade!.sql).toContain('voice_profile_id = NULL');
    expect(alarmsCascade!.sql).toContain('speaker_id = NULL');
    const messagesUpdate = mockDB.calls.find((c) =>
      c.sql.startsWith('UPDATE messages SET audio_url'),
    );
    expect(messagesUpdate).toBeDefined();
    const update = mockDB.calls.find((c) => c.sql.startsWith('UPDATE voice_profiles'));
    expect(update?.sql).toContain('deleted_at');
    expect(update?.sql).toContain('is_shared = 0');
  });

  it('삭제된 목소리로 만든 쪽지는 오디오 URL을 비움', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: null }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([
      {
        audio_url: 'https://cdn.example.com/generated/voice-note.mp3',
        audio_object_key: 'generated/voice-note.mp3',
      },
    ]);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }),
    );

    expect(res.status).toBe(200);
    const notesUpdate = mockDB.calls.find((c) =>
      c.sql.startsWith('UPDATE notes SET audio_url = NULL'),
    );
    expect(notesUpdate).toBeDefined();
    expect(notesUpdate!.args).toContain('r2://generated/voice-note.mp3');
    expect(notesUpdate!.args).toContain('https://cdn.example.com/generated/voice-note.mp3');
  });

  it('force=true 여도 메시지와 알람 행은 삭제하지 않음', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: null }]);
    mockDB.pushResult([], 1);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}?force=true`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(true);
    expect(
      mockDB.calls.some(
        (c) => c.sql.startsWith('DELETE FROM messages') || c.sql.startsWith('DELETE FROM alarms'),
      ),
    ).toBe(false);
  });

  it('프로필은 삭제 시 목록에서만 숨김 처리', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: null }]);
    mockDB.pushResult([], 1);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const updateQueries = mockDB.calls.filter((c) => c.sql.startsWith('UPDATE voice_profiles'));
    expect(updateQueries).toHaveLength(1);
    expect(updateQueries[0]!.sql).toContain('deleted_at');
  });

  it('ElevenLabs voice 삭제 호출', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: 'elv-xyz' }]);
    mockDB.pushResult([], 1);
    mockDeleteVoice.mockResolvedValue(undefined);
    await req(buildApp(), new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }));
    expect(mockDeleteVoice).toHaveBeenCalledWith('elv-xyz');
  });

  it('ElevenLabs 삭제 실패해도 로컬 삭제 진행', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: 'elv-fail' }]);
    mockDB.pushResult([], 1);
    mockDeleteVoice.mockRejectedValue(new Error('API error'));
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('elevenlabs_voice_id 없으면 외부 API 호출 안 함', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: null }]);
    mockDB.pushResult([], 1);
    await req(buildApp(), new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }));
    expect(mockDeleteVoice).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  GET /vp/family — 가족 음성 프로필                                   */
/* ------------------------------------------------------------------ */
describe('GET /family — 가족 음성 프로필 (voice-profile)', () => {
  it('가족 멤버 없으면 빈 배열', async () => {
    mockDB.pushResult([]);
    const res = await req(buildApp(), new Request('http://localhost/vp/family'));
    expect(res.status).toBe(200);
    expect((await res.json()).profiles).toEqual([]);
  });

  it('가족 멤버 있고 음성 프로필 존재', async () => {
    mockDB.pushResult([{ user_id: 'member-1' }, { user_id: 'member-2' }]);
    mockDB.pushResult([
      { id: V1, name: '아빠', status: 'ready', user_id: 'member-1', owner_name: '김아빠' },
      { id: V2, name: '엄마', status: 'ready', user_id: 'member-2', owner_name: '이엄마' },
    ]);
    const res = await req(buildApp(), new Request('http://localhost/vp/family'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles).toHaveLength(2);
    expect(body.profiles[0].owner_name).toBe('김아빠');
  });

  it('가족 멤버 있지만 음성 프로필 없으면 빈 배열', async () => {
    mockDB.pushResult([{ user_id: 'member-1' }]);
    mockDB.pushResult([]);
    const res = await req(buildApp(), new Request('http://localhost/vp/family'));
    expect(res.status).toBe(200);
    expect((await res.json()).profiles).toEqual([]);
  });

  it('쿼리에 ready 상태만 필터', async () => {
    mockDB.pushResult([{ user_id: 'member-1' }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp/family'));
    const voiceQuery = mockDB.calls[1]!;
    expect(voiceQuery.sql).toContain("status = 'ready'");
  });

  it('자기 자신은 제외 (fm2.user_id != ?)', async () => {
    mockDB.pushResult([]);
    await req(buildApp('user-me'), new Request('http://localhost/vp/family'));
    const memberQuery = mockDB.calls[0]!;
    expect(memberQuery.args).toContain('user-me');
    expect(memberQuery.sql).toContain('fm2.user_id != ?');
  });

  it('placeholders 수 = 가족 멤버 수', async () => {
    mockDB.pushResult([{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'c' }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp/family'));
    const voiceQuery = mockDB.calls[1]!;
    expect(voiceQuery.sql).toContain('?,?,?');
    expect(voiceQuery.args).toEqual(['user-1', 'user-1', 'a', 'b', 'c']);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — GET / pagination                                      */
/* ------------------------------------------------------------------ */
describe('GET / — pagination edge cases (voice-profile)', () => {
  it('limit=abc (비숫자) → 기본값 50', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp?limit=abc'));
    const call = mockDB.calls[1]!;
    expect(call.args).toContain(50);
  });

  it('limit=-5 → 최소 1 로 클램핑', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp?limit=-5'));
    const call = mockDB.calls[1]!;
    expect(call.args).toContain(1);
  });

  it('offset=abc (비숫자) → 기본값 0', async () => {
    mockDB.pushResult([{ total: 0 }]);
    mockDB.pushResult([]);
    await req(buildApp(), new Request('http://localhost/vp?offset=abc'));
    const call = mockDB.calls[1]!;
    expect(call.args).toContain(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — PATCH /:id name validation                            */
/* ------------------------------------------------------------------ */
describe('PATCH /:id — name edge cases (voice-profile)', () => {
  it('name 필드 자체 없으면 400', async () => {
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_NAME_LENGTH');
  });

  it('name: null → 400', async () => {
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: null }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_NAME_LENGTH');
  });

  it('name 1자 경계 → 통과', async () => {
    mockDB.pushResult([{ id: V1 }]);
    mockDB.pushResult([], 1);
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: 'A' }));
    expect(res.status).toBe(200);
    expect((await res.json()).profile.name).toBe('A');
  });

  it('name 앞뒤 공백은 trim 후 저장', async () => {
    mockDB.pushResult([{ id: V1 }]);
    mockDB.pushResult([], 1);
    const res = await req(buildApp(), jsonReq('PATCH', `/vp/${V1}`, { name: '  엄마  ' }));
    expect(res.status).toBe(200);
    const updateCall = mockDB.calls[1]!;
    expect(updateCall.args).toContain('엄마');
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — POST /clone                                           */
/* ------------------------------------------------------------------ */
describe('POST /clone — edge cases (voice-profile)', () => {
  it('프로필 0개이면 정상 생성', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-zero' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), '첫번째'));
    expect(res.status).toBe(201);
    expect((await res.json()).profile.status).toBe('ready');
  });

  it('non-Error throw → detail = "Unknown error"', async () => {
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockRejectedValue('string-error');
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'test'));
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toBe('Unknown error');
  });
});

/* ------------------------------------------------------------------ */
/*  Edge cases — DELETE /:id force parameter                           */
/* ------------------------------------------------------------------ */
describe('DELETE /:id — force edge cases (voice-profile)', () => {
  it('force=false 여도 소프트 삭제', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: null }]);
    mockDB.pushResult([], 1);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}?force=false`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
    expect(
      mockDB.calls.some(
        (c) => c.sql.startsWith('DELETE FROM messages') || c.sql.startsWith('DELETE FROM alarms'),
      ),
    ).toBe(false);
  });

  it('force=TRUE 여도 소프트 삭제', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: null }]);
    mockDB.pushResult([], 1);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}?force=TRUE`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
  });

  it('force=true + elevenlabs_voice_id 있으면 외부 삭제 + 소프트 삭제', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: 'elv-abc' }]);
    mockDB.pushResult([], 1);
    mockDeleteVoice.mockResolvedValue(undefined);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}?force=true`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    expect(mockDeleteVoice).toHaveBeenCalledWith('elv-abc');
    expect((await res.json()).deleted).toBe(true);
    expect(
      mockDB.calls.some(
        (c) => c.sql.startsWith('DELETE FROM messages') || c.sql.startsWith('DELETE FROM alarms'),
      ),
    ).toBe(false);
  });
});
