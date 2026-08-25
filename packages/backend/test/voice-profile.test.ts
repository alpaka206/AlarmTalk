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
const { mockNotifyDowngradedAlarms } = vi.hoisted(() => ({
  mockNotifyDowngradedAlarms: vi.fn().mockResolvedValue(undefined),
}));

function consentRow(type: string) {
  return { consent_type: type, policy_version: CURRENT_POLICY_VERSION, agreed: 1 };
}

/**
 * POST /clone 은 `c.get('userIdPK')` 가 있으면 유료 플랜 여부를 실제로 조회한다
 * (SELECT plan FROM users ...). fakeAuthMiddleware 가 실제 authMiddleware 처럼
 * userIdPK 를 채우게 되면서 이 쿼리가 결과 큐의 맨 앞을 소비하므로, 클론 테스트는
 * 유료 플랜 행을 가장 먼저 넣어 줘야 이후 결과(한도 카운트·INSERT ...)가 한 칸씩
 * 밀리지 않는다. 무료 플랜이면 403 VOICE_FEATURE_REQUIRES_PAID_PLAN 으로 떨어진다.
 */
function pushPaidPlan() {
  mockDB.pushResult([{ plan: 'plus' }]);
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

vi.mock('../src/lib/fcm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/fcm')>()),
  notifyDowngradedAlarms: mockNotifyDowngradedAlarms,
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

function fakeExecutionCtx() {
  const tasks: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (task: Promise<unknown>) => tasks.push(task),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
    /** waitUntil 로 넘어간 작업들 — '응답을 막지 않았다' 를 이걸로 확인한다. */
    tasks,
    drain: () => Promise.all(tasks),
  };
}

/**
 * 교체(replace_existing) 갈래가 승격과 같은 게이트를 통과하도록 기본값을 깐다.
 * 매처라 FIFO 큐 순서를 건드리지 않는다(기존 pushResult 단언 보존).
 */
function pushReplacementGatesPass(db: ReturnType<typeof createMockDB>) {
  db.pushResultFor('SELECT plan FROM users', [{ plan: 'plus' }]);
  db.pushResultFor('INSERT OR IGNORE INTO voice_profile_change_ledger', [], 1);
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
  mockNotifyDowngradedAlarms.mockClear();
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
describe('GET /draft — 드래프트 조회 (voice-profile)', () => {
  it('공유로 만든 드래프트는 실제 is_shared=true 를 반환(마스킹 금지)', async () => {
    mockDB.pushResult([{ id: V1, name: 'draft', is_shared: 1, is_draft: 1, status: 'ready' }]);
    const res = await req(buildApp(), new Request('http://localhost/vp/draft'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.is_shared).toBe(true);
    expect(body.profile.is_draft).toBe(true);
    expect(body.profile.is_system).toBe(false);
  });

  it('비공유 드래프트는 is_shared=false', async () => {
    mockDB.pushResult([{ id: V1, name: 'draft', is_shared: 0, is_draft: 1, status: 'ready' }]);
    const res = await req(buildApp(), new Request('http://localhost/vp/draft'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.is_shared).toBe(false);
  });

  it('드래프트 없으면 profile=null', async () => {
    mockDB.pushResult([]);
    const res = await req(buildApp(), new Request('http://localhost/vp/draft'));
    expect(res.status).toBe(200);
    expect((await res.json()).profile).toBe(null);
  });
});

describe('GET /draft-quota — 월 생성 쿼터 (voice-profile)', () => {
  it('사용 기록이 없으면 이번 달 등록 쿼터는 1/1', async () => {
    mockDB.pushResult([]); // 초안 시도 used_count 조회 → 없음
    mockDB.pushResult([{ used: 0 }]); // 이번 달 정식 등록 사용량 → 0
    const res = await req(buildApp(), new Request('http://localhost/vp/draft-quota'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // 초안 시도는 제한 없음(limit=0, 집계용). 사용자에게 보여줄 숫자는 registration_*.
    expect(body).toEqual({
      limit: 0,
      used: 0,
      remaining: 0,
      registration_limit: 1,
      registration_used: 0,
      registration_remaining: 1,
    });
  });

  it('이번 달 목소리를 이미 등록했으면 등록 쿼터는 0/1', async () => {
    mockDB.pushResult([{ used_count: 3 }]);
    mockDB.pushResult([{ used: 1 }]); // 정식 등록 1건 소진
    const res = await req(buildApp(), new Request('http://localhost/vp/draft-quota'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      limit: 0,
      used: 3,
      remaining: 0,
      registration_limit: 1,
      registration_used: 1,
      registration_remaining: 0,
    });
  });

  it("'/:id' 보다 먼저 매칭돼 draft-quota 가 프로필 id 로 잡히지 않는다", async () => {
    mockDB.pushResult([{ used_count: 1 }]);
    mockDB.pushResult([{ used: 0 }]);
    const res = await req(buildApp(), new Request('http://localhost/vp/draft-quota'));
    // 400(잘못된 UUID) 이 아니라 200 쿼터 응답이어야 한다.
    expect(res.status).toBe(200);
    expect((await res.json()).registration_remaining).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  PATCH /vp/:id — 이름 변경                                         */
/* ------------------------------------------------------------------ */
describe('POST /:id/preview-played — 미리듣기 재생 확인', () => {
  it('서버가 발급한 최신 토큰으로 draft 재생 완료를 기록한다', async () => {
    mockDB.pushResult([], 1);

    const res = await req(
      buildApp(),
      jsonReq('POST', `/vp/${V1}/preview-played`, { preview_playback_token: V2 }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).previewed).toBe(true);
    expect(mockDB.calls[0]!.sql).toContain('preview_claim_token = ?');
    expect(mockDB.calls[0]!.sql).toContain('preview_claimed_at IS NULL');
    expect(mockDB.calls[0]!.args).toContain(V2);
  });

  it('stale token은 재생 완료로 인정하지 않는다', async () => {
    mockDB.pushResult([], 0);

    const res = await req(
      buildApp(),
      jsonReq('POST', `/vp/${V1}/preview-played`, { preview_playback_token: V2 }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('VOICE_PREVIEW_CONFIRMATION_CONFLICT');
  });
});

describe('PATCH /:id/preview-text — 미리듣기 문구 수정 (voice-profile)', () => {
  it('문구를 갱신하고 previewed_at·claim 을 리셋한다(재청취 강제)', async () => {
    mockDB.pushResult([], 1);

    const res = await req(
      buildApp(),
      jsonReq('PATCH', `/vp/${V1}/preview-text`, { preview_text: '  좋은  아침이야,\n오늘도 힘내자  ' }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // 개행/연속 공백은 단일 공백으로 정규화된다.
    expect(body.preview_text).toBe('좋은 아침이야, 오늘도 힘내자');
    const sql = mockDB.calls[0]!.sql;
    expect(sql).toContain('preview_text = ?');
    // 이전 문구 기준으로 고른 delivery 태그가 수정본에 남지 않게 함께 리셋된다.
    expect(sql).toContain('preview_tag = NULL');
    expect(sql).toContain('previewed_at = NULL');
    expect(sql).toContain('preview_claimed_at = NULL');
    expect(sql).toContain('preview_claim_token = NULL');
    expect(sql).toContain("COALESCE(is_draft, 0) = 1");
    expect(sql).toContain("status = 'ready'");
  });

  it('대괄호(태그 주입)는 400', async () => {
    const res = await req(
      buildApp(),
      jsonReq('PATCH', `/vp/${V1}/preview-text`, { preview_text: '[whispers] 일어나' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_PREVIEW_TEXT_INVALID');
  });

  it('200자 초과는 400', async () => {
    const res = await req(
      buildApp(),
      jsonReq('PATCH', `/vp/${V1}/preview-text`, { preview_text: '가'.repeat(201) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_PREVIEW_TEXT_INVALID');
  });

  it('빈 문구는 400', async () => {
    const res = await req(
      buildApp(),
      jsonReq('PATCH', `/vp/${V1}/preview-text`, { preview_text: '   ' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_PREVIEW_TEXT_INVALID');
  });

  it('내 draft 가 아니면(또는 official) 404', async () => {
    mockDB.pushResult([], 0);
    const res = await req(
      buildApp(),
      jsonReq('PATCH', `/vp/${V1}/preview-text`, { preview_text: '일어나야지' }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('잘못된 UUID → 400', async () => {
    const res = await req(
      buildApp(),
      jsonReq('PATCH', `/vp/${V_BAD}/preview-text`, { preview_text: '일어나야지' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });
});

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
    mockDB.pushResult([{ plan: 'plus' }]);
    mockDB.pushResult([consentRow('voice_biometric'), consentRow('overseas_transfer')]);
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

  it('draft promotion cannot change the previewed persona in the same request', async () => {
    mockDB.pushResult([{ id: V1, is_draft: 1, previewed_at: '2026-07-14 00:00:00' }]);

    const res = await req(
      buildApp(),
      jsonReq('PATCH', `/vp/${V1}`, { is_draft: false, listener_title: '다른 호칭' }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe('VOICE_PROMOTION_FIELDS_NOT_ALLOWED');
    expect(mockDB.calls).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  GET /vp/:id/stats — 통계                                          */
/* ------------------------------------------------------------------ */
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
    pushPaidPlan(); // userIdPK 가 채워지며 유료 플랜 조회가 실제로 실행된다 — 큐 맨 앞에 유료 플랜 행을 넣어 준다.
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
    pushPaidPlan();
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
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-consent-ok' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2]), '엄마 목소리'));
    expect(res.status).toBe(201);
    expect(mockCreateInstantClone).toHaveBeenCalledOnce();
  });

  it('draft 슬롯이 차 있으면 403 VOICE_LIMIT_REACHED', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ draft_count: 1, official_count: 0 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2, 3]), '테스트'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_LIMIT_REACHED');
    expect(body.error).toContain('1');
  });

  // ⚠ **official 슬롯이 차 있어도 초안은 만들 수 있다**(2026-08-12 확정).
  //
  // 예전에는 여기서 403 으로 막았고("stranded draft 방지"), 그래서 이미 목소리를 가진
  // 사용자는 **교체를 고를 기회 자체가 없었다** — 승격의 `replace_existing` 갈래가
  // 도달 불가능한 죽은 코드였다. 교체 여부는 등록을 끝낸 마지막 확정 화면에서 묻는다.
  //
  // 옛 근거("promote 가 한도로 거부돼 stranded 가 된다")는 `replace_existing` 이 생기면서
  // 사라졌다 — 승격은 기존 행을 재사용한다.
  it('official 슬롯이 차 있어도 초안을 만들 수 있다 (교체 흐름의 입구)', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ draft_count: 0, official_count: 1 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-draft' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2, 3]), '테스트2'));
    expect(res.status).toBe(201);
  });

  // draft 슬롯 한도는 그대로 본다 — 동시에 여러 초안을 두는 것은 별개 축이다.
  it('draft 슬롯이 차 있으면 여전히 403', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ draft_count: 1, official_count: 0 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2, 3]), '테스트3'));
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('VOICE_LIMIT_REACHED');
  });

  it('초안은 월 시도 횟수로 막지 않는다 — 정식 등록 전까진 무제한 생성·삭제', async () => {
    // 예전에는 여기서 429 VOICE_DRAFT_ATTEMPT_LIMIT_REACHED 로 막았다. 이제 사용량만 센다.
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-draft' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2, 3]), '새 목소리'));
    expect(res.status).toBe(201);
    const usageCall = mockDB.calls.find((call) => call.sql.includes('voice_draft_attempt_usage'));
    expect(usageCall).toBeDefined();
    // 집계는 계속하되 상한 비교(WHERE used_count < ?)는 사라졌다.
    expect(usageCall!.sql).not.toContain('used_count <');
  });

  it('프로필이 없으면 통과', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-1' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2]), '첫번째'));
    expect(res.status).toBe(201);
  });

  it('쿼터 카운트는 failed 잔여 행을 제외한다 (일시 실패가 한도를 영구 잠식하지 않도록)', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
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
    pushPaidPlan();
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
    pushPaidPlan();
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
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'x'.repeat(51)));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('NAME_TOO_LONG');
  });

  it('durationMs 생략 시 400', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'name', ''));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_DURATION');
  });

  it('초안 최소 12초 미만 durationMs 는 400', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'name', '11999'));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_CLONE_AUDIO_TOO_SHORT');
  });

  // 예전에는 정식 등록만 60초를 요구했다. 1분을 채우는 게 부담이라는 제보가 많아 하한을
  // 초안과 같은 12초로 내렸다 — 이 테스트가 그 하한이 다시 올라가는 것을 막는다.
  it('정식 등록도 12초만 넘으면 통과한다 (1분 하한 없음)', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-short' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'name', '12000'));
    expect(res.status).toBe(201);
  });

  it('2분에서 5초 이내 durationMs 오차는 허용', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-ok' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'name', '125000'));
    expect(res.status).toBe(201);
  });

  it('2분 5초를 넘는 durationMs 는 400', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'name', '125001'));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('VOICE_CLONE_AUDIO_TOO_LONG');
  });

  it('name 50자 정확히 → 통과', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-2' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2]), 'a'.repeat(50)));
    expect(res.status).toBe(201);
  });

  it('성공 시 INSERT processing → UPDATE ready 순서', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
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
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockRejectedValue(new Error('API down'));
    const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2]), 'test'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error_code).toBe('VOICE_CLONING_FAILED');
    // K1: 제공자 응답 원문(err.message)은 detail 로 반사하지 않고 안정 에러코드만 노출한다.
    expect(body.detail).toBe('VOICE_CLONING_FAILED');
    expect(JSON.stringify(body)).not.toContain('API down');

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
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
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
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
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
    pushPaidPlan();
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

  it('J: 0바이트 오디오 → 400 AUDIO_FILE_EMPTY (arrayBuffer/클론 전 차단)', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]); // 한도 체크 SELECT
    const res = await req(buildApp(), cloneForm(new Uint8Array([]), 'name'));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('AUDIO_FILE_EMPTY');
    expect(mockCreateInstantClone).not.toHaveBeenCalled();
  });

  it('J: 25 MiB 초과 오디오 → 413 AUDIO_FILE_TOO_LARGE', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]); // 한도 체크 SELECT
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    const res = await req(buildApp(), cloneForm(big, 'name'));
    expect(res.status).toBe(413);
    expect((await res.json()).error_code).toBe('AUDIO_FILE_TOO_LARGE');
    expect(mockCreateInstantClone).not.toHaveBeenCalled();
  });

  it('C: 원본 R2 저장 성공 후 voice_uploads INSERT 실패 시 R2 삭제 큐 적재', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-ok' });

    // voice_uploads INSERT 만 실패시킨다(R2 put 은 이미 성공한 상태를 재현).
    const origExecute = mockDB.client.execute;
    mockDB.client.execute = async (q: { sql: string; args: (string | number | null)[] }) => {
      if (q.sql.includes('INSERT INTO voice_uploads')) throw new Error('insert boom');
      return origExecute(q);
    };
    try {
      const res = await req(buildApp(), cloneForm(new Uint8Array([1, 2, 3]), '엄마'));
      // 원본 보관은 best-effort — 클론 자체는 성공(201).
      expect(res.status).toBe(201);
      const enqueueCall = mockDB.calls.find((call) =>
        call.sql.includes('INSERT OR IGNORE INTO pending_external_deletions'),
      );
      expect(enqueueCall).toBeDefined();
      expect(enqueueCall!.args[1]).toBe('r2_object'); // kind
      expect(String(enqueueCall!.args[2] ?? '')).not.toBe(''); // 고아 objectKey
    } finally {
      mockDB.client.execute = origExecute;
    }
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
    const messagesUpdate = mockDB.calls.find((c) =>
      c.sql.startsWith('UPDATE messages SET audio_url'),
    );
    expect(messagesUpdate).toBeDefined();
    const update = mockDB.calls.find((c) => c.sql.startsWith('UPDATE voice_profiles'));
    expect(update?.sql).toContain('deleted_at');
    expect(update?.sql).toContain('is_shared = 0');
  });

  it('철회 컬럼이 아직 없으면 프로필 삭제도 함께 롤백한다', async () => {
    mockDB.pushResultFor('SELECT * FROM voice_profiles', [
      { id: V1, elevenlabs_voice_id: 'elv-not-deleted' },
    ]);
    mockDB.pushResultFor('UPDATE voice_profiles', [], 1);
    mockDB.pushErrorFor('sender_voice_upload', new Error('no such column: sender_voice_upload'));

    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }),
    );

    expect(res.status).toBe(500);
    expect(mockDB.transactions.rollbacks).toBe(1);
    expect(mockDB.transactions.commits).toBe(0);
    expect(mockDeleteVoice).not.toHaveBeenCalled();
  });

  it('삭제해도 이번 달 목소리 변경 원장은 남는다 — 지웠다 만들기로 월 1회를 우회할 수 없다', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: null }]);
    mockDB.pushResult([], 1);
    const res = await req(
      buildApp(),
      new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const ledgerDelete = mockDB.calls.find((c) =>
      c.sql.startsWith('DELETE FROM voice_profile_change_ledger'),
    );
    expect(ledgerDelete).toBeUndefined();
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

  it('철회 알림을 먼저 보낸 뒤 ElevenLabs voice를 정리한다', async () => {
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: 'elv-xyz' }]);
    mockDB.pushResult([], 1);
    mockDeleteVoice.mockResolvedValue(undefined);
    await req(buildApp(), new Request(`http://localhost/vp/${V1}`, { method: 'DELETE' }));
    expect(mockNotifyDowngradedAlarms).toHaveBeenCalledTimes(1);
    expect(mockDeleteVoice).toHaveBeenCalledWith('elv-xyz');
    expect(mockNotifyDowngradedAlarms.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteVoice.mock.invocationCallOrder[0]!,
    );
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
describe('PATCH /:id — 교체(replace_existing) 시 알람 처리 (voice-profile)', () => {
  // ⚠ **화면이 약속한 것을 서버가 실제로 해야 한다.**
  //
  // 등록 확정의 교체 체크는 이렇게 말한다:
  //   "이전에 저장해둔 목소리는 삭제됩니다.
  //    직접 입력으로 해둔 알람들도 기본 알람으로 설정됩니다."
  //
  // 2026-08-12 이전에는 `replaceVoiceInPlace` 가 `messages` 를 **한 줄도 건드리지 않아**,
  // 교체한 뒤에도 직접 입력 알람이 **지운 목소리로 계속 울렸다.** 사용자는 그 문구를 읽고
  // 동의했는데 정반대가 일어났다.
  //
  // 프리셋은 반대로 **살아남아야** 한다 — `voice_prerender_queue` 가 새 목소리로 다시 만든다.
  it('직접 입력(custom) 알람만 기본 알람으로 내리고 프리셋은 남긴다', async () => {
    // ① 존재/초안 확인(previewed_at 이 있어야 승격이 통과한다)
    mockDB.pushResult([{ id: V2, is_draft: 1, previewed_at: '2026-08-12T00:00:00Z' }]);
    // ② 현역 개수(한도 검사) — 1이면 교체 갈래로 간다
    mockDB.pushResult([{ active_count: 1 }]);
    // ③ replaceVoiceInPlace: draft 조회 → 교체 대상 조회 → 트랜잭션 → 최종 조회
    mockDB.pushResult([{
      id: V2,
      user_id: 'user-pk-1',
      name: '새 목소리',
      elevenlabs_voice_id: 'elv-new',
      is_shared: 0,
      // 교체 트랜잭션도 '끝까지 들어본 뒤 저장' 을 같은 스냅샷에서 다시 본다.
      previewed_at: '2026-08-12T00:00:00Z',
    }]);
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: 'elv-old' }]);
    mockDB.pushResultFor('SELECT id FROM voice_uploads WHERE voice_profile_id', [
      { id: 'upload-new' },
    ]);
    mockDB.pushResultFor('SELECT object_key FROM voice_uploads WHERE voice_profile_id', [
      { object_key: 'uploads/old.wav' },
    ]);
    mockDB.pushResultFor('SELECT a.id AS alarm_id', [
      { alarm_id: 'alarm-live', row_owner_user_id: 'recipient-live', is_received: 1 },
      // 소유자 본인 알람(target_user_id NULL) — pull 대상이 아니라 서버 강등이 안 닿는다.
      { alarm_id: 'alarm-mine', row_owner_user_id: 'user-1', is_received: 0 },
    ]);
    mockDB.pushResultFor('SELECT alarm_id, recipient_user_id FROM alarm_recipient_state', [
      { alarm_id: 'alarm-delivered', recipient_user_id: 'recipient-delivered' },
    ]);
    mockDB.pushResultFor('SELECT id, name, status, is_shared', [
      { id: V1, name: '새 목소리', status: 'ready' },
    ]);
    pushReplacementGatesPass(mockDB);

    const execution = fakeExecutionCtx();
    const response = await buildApp().fetch(
      jsonReq('PATCH', `/vp/${V2}`, {
        is_draft: false,
        replace_existing: true,
        is_shared: true,
      }),
      ENV,
      execution.ctx,
    );
    expect(response.status).toBe(200);
    const responseBody = response.json() as Promise<{ replaced?: boolean }>;
    await execution.drain();

    const profileReplace = mockDB.calls.find(
      (call) => call.sql.includes('SET name = ?') && call.sql.includes('is_shared = ?'),
    );
    // 인자 순서는 SET 절과 같다: name, voice, relationship, listener, preview_text,
    // preview_language, speech_style, speech_style_status, is_shared, id.
    expect(profileReplace?.args[8], '확정 화면의 공유 선택이 교체된 프로필에 반영되지 않았다').toBe(1);
    expect(
      profileReplace?.sql,
      '말투 분석 상태를 함께 옮기지 않으면 실패한 분석이 완료로 보인다',
    ).toContain('speech_style_status = ?');
    expect(
      profileReplace?.sql,
      '푸시를 놓친 기기가 스스로 알아챌 표식이 없다',
    ).toContain('custom_audio_invalidated_at = ');

    const alarmUpdate = mockDB.calls.find(
      (call) => call.sql.includes('UPDATE alarms') && call.sql.includes("mode = 'sound-only'"),
    );
    expect(alarmUpdate, '직접 입력 알람을 기본 알람으로 내리는 UPDATE 가 없다').toBeDefined();
    // ⚠ **대상을 custom 으로 좁혀야 한다.** 좁히지 않으면 프리셋 알람까지 기본 알람이 되어,
    // 교체의 존재 이유(알람을 살린 채 목소리만 바꾼다)가 사라진다.
    expect(alarmUpdate!.sql).toContain("category = 'custom'");

    const audioClear = mockDB.calls.find(
      (call) => call.sql.includes('UPDATE messages') && call.sql.includes('audio_url = NULL'),
    );
    expect(audioClear, '못 쓰게 된 음원 참조를 끊지 않는다').toBeDefined();
    expect(audioClear!.sql).toContain("category = 'custom'");

    const uploadMove = mockDB.calls.find(
      (call) => call.sql.includes('UPDATE voice_uploads SET voice_profile_id = ?'),
    );
    expect(uploadMove?.args).toEqual([V1, V2]);
    expect(
      mockDB.calls.some(
        (call) =>
          call.sql.includes('INSERT OR IGNORE INTO pending_external_deletions') &&
          call.args.includes('uploads/old.wav'),
      ),
      '교체 전 원본 녹음이 보존 큐 없이 사라진다',
    ).toBe(true);

    const deliveredRevoke = mockDB.calls.find(
      (call) =>
        call.sql.includes('UPDATE alarm_recipient_state') &&
        call.sql.includes('custom_voice = 1'),
    );
    expect(deliveredRevoke, 'ACK 뒤 custom 음원을 철회하는 tombstone UPDATE가 없다').toBeDefined();
    expect(mockNotifyDowngradedAlarms).toHaveBeenCalledWith(
      mockDB.client,
      ENV,
      expect.arrayContaining([
        { alarmId: 'alarm-live', ownerUserId: 'recipient-live', isReceived: true },
        { alarmId: 'alarm-delivered', ownerUserId: 'recipient-delivered', isReceived: true },
        // 소유자 본인 알람도 알린다 — 안 알리면 등록 기기 말고 다른 기기가 지운 목소리로 운다.
        { alarmId: 'alarm-mine', ownerUserId: 'user-1', isReceived: false },
      ]),
      ['user-1'],
      // 교체는 프로필 id 가 살아 있어 '접근 가능 목록 대조' 로는 안 걸린다 — 무엇이
      // 무효가 됐는지 payload 로 알려야 클라가 custom 알람만 좁혀 정리할 수 있다.
      { replacedVoiceProfileId: V1 },
    );
    expect((await responseBody).replaced, '등록 기기가 자기 알람을 정리할 신호가 없다').toBe(true);
    expect(mockDB.transactions.commits).toBe(1);
    expect(
      mockDB.calls.some((call) => call.sql.includes('FROM plan_group_members m1')),
      '새 클립 게시 전 그룹원에게 갱신 push를 보내면 옛 캐시를 다시 확정한다',
    ).toBe(false);
  });

  it('프리셋 재렌더 큐 쓰기가 실패하면 프로필 교체도 롤백한다', async () => {
    mockDB.pushResult([{ id: V2, is_draft: 1, previewed_at: '2026-08-12T00:00:00Z' }]);
    mockDB.pushResult([{ active_count: 1 }]);
    mockDB.pushResult([{
      id: V2,
      user_id: 'user-pk-1',
      name: '새 목소리',
      elevenlabs_voice_id: 'elv-new',
      is_shared: 0,
      // 교체 트랜잭션도 '끝까지 들어본 뒤 저장' 을 같은 스냅샷에서 다시 본다.
      previewed_at: '2026-08-12T00:00:00Z',
    }]);
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: 'elv-old' }]);
    mockDB.pushErrorFor(
      'INSERT INTO voice_prerender_queue',
      new Error('no such column: refresh_existing'),
    );
    pushReplacementGatesPass(mockDB);

    const response = await buildApp().fetch(
      jsonReq('PATCH', `/vp/${V2}`, {
        is_draft: false,
        replace_existing: true,
      }),
      ENV,
    );

    expect(response.status).toBe(500);
    expect(mockDB.transactions.rollbacks).toBe(1);
    expect(mockDB.transactions.commits).toBe(0);
    expect(mockNotifyDowngradedAlarms).not.toHaveBeenCalled();
  });

  // 공유 목소리는 **같은 그룹원**도 자기 알람에 직접 입력 문구를 만들어 쓸 수 있다. 그 행도
  // target_user_id 가 없어 pull 로 돌아오지 않으므로, 주인만 깨우면 그 기기에서 지운 목소리가
  // 계속 운다.
  it('공유 중이던 목소리를 교체하면 그룹원 기기도 깨운다', async () => {
    mockDB.pushResult([{ id: V2, is_draft: 1, previewed_at: '2026-08-12T00:00:00Z' }]);
    mockDB.pushResult([{ active_count: 1 }]);
    mockDB.pushResult([{
      id: V2,
      user_id: 'user-1',
      name: '새 목소리',
      elevenlabs_voice_id: 'elv-new',
      is_shared: 1,
      previewed_at: '2026-08-12T00:00:00Z',
    }]);
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: 'elv-old', is_shared: 1 }]);
    pushReplacementGatesPass(mockDB);
    mockDB.pushResultFor('SELECT a.id AS alarm_id', [
      { alarm_id: 'alarm-member', row_owner_user_id: 'member-2', is_received: 0 },
    ]);
    mockDB.pushResultFor('FROM plan_group_members m1', [{ user_id: 'member-2' }]);
    mockDB.pushResultFor('SELECT id, name, status, is_shared', [
      { id: V1, name: '새 목소리', status: 'ready' },
    ]);

    const response = await req(
      buildApp(),
      jsonReq('PATCH', `/vp/${V2}`, { is_draft: false, replace_existing: true, is_shared: true }),
    );

    expect(response.status).toBe(200);
    expect(mockNotifyDowngradedAlarms).toHaveBeenCalledWith(
      mockDB.client,
      ENV,
      // 임자를 목소리 주인으로 뭉개면 그룹원 기기가 신호를 못 받는다.
      [{ alarmId: 'alarm-member', ownerUserId: 'member-2', isReceived: false }],
      expect.arrayContaining(['user-1', 'member-2']),
      { replacedVoiceProfileId: V1 },
    );
  });

  // **교체도 '정식 등록' 이다** — 승격이 보는 게이트를 그대로 통과해야 한다(Codex #703 P1).
  //
  // 예전에는 이 갈래가 승격 트랜잭션에 닿기 전에 return 해서, 초안이 남아 있는 동안 결제가
  // 보류되거나 동의가 철회돼도 통과했고 **월 1회 등록 한도도 교체로는 소모되지 않았다** —
  // 앱은 `등록 1/1` 이라 버튼을 막아 두는데 서버만 무제한이었다.
  const pushReplaceLookups = () => {
    mockDB.pushResult([{ id: V2, is_draft: 1, previewed_at: '2026-08-12T00:00:00Z' }]);
    mockDB.pushResult([{ active_count: 1 }]);
    mockDB.pushResult([{
      id: V2,
      user_id: 'user-pk-1',
      name: '새 목소리',
      elevenlabs_voice_id: 'elv-new',
      is_shared: 0,
      // 교체 트랜잭션도 '끝까지 들어본 뒤 저장' 을 같은 스냅샷에서 다시 본다.
      previewed_at: '2026-08-12T00:00:00Z',
    }]);
    mockDB.pushResult([{ id: V1, elevenlabs_voice_id: 'elv-old' }]);
  };

  it('이번 달 등록을 이미 썼으면 교체도 429 — 한 줄도 쓰지 않는다', async () => {
    pushReplaceLookups();
    mockDB.pushResultFor('SELECT plan FROM users', [{ plan: 'plus' }]);
    // 원장이 이미 이번 달 행을 들고 있다 → INSERT OR IGNORE 가 0행.
    mockDB.pushResultFor('INSERT OR IGNORE INTO voice_profile_change_ledger', [], 0);

    const response = await req(
      buildApp(),
      jsonReq('PATCH', `/vp/${V2}`, { is_draft: false, replace_existing: true }),
    );

    expect(response.status).toBe(429);
    expect((await response.json()).error_code).toBe('VOICE_MONTHLY_CHANGE_LIMIT_REACHED');
    expect(
      mockDB.calls.some((call) => call.sql.includes('SET name = ?') && call.sql.includes('is_shared = ?')),
      '게이트에 막혔는데 프로필을 덮어썼다',
    ).toBe(false);
    expect(mockNotifyDowngradedAlarms).not.toHaveBeenCalled();
  });

  it('초안이 남아 있는 사이 무료로 내려갔으면 교체도 403', async () => {
    pushReplaceLookups();
    mockDB.pushResultFor('SELECT plan FROM users', [{ plan: 'free' }]);

    const response = await req(
      buildApp(),
      jsonReq('PATCH', `/vp/${V2}`, { is_draft: false, replace_existing: true }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error_code).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
    expect(
      mockDB.calls.some((call) => call.sql.includes('INSERT OR IGNORE INTO voice_profile_change_ledger')),
      '플랜 게이트에 막혔는데 이번 달 원장을 잡았다',
    ).toBe(false);
  });

  // 커밋은 재시도할 수 없다(드래프트가 이미 tombstone → 재요청은 404). 그래서 철회 fanout 은
  // 응답을 막지 않고 `waitUntil` 로 넘긴다 — 요청 컨텍스트가 끊겨도 런타임이 끝까지 보낸다.
  it('철회 fanout 은 waitUntil 로 넘겨 응답을 막지 않는다', async () => {
    pushReplaceLookups();
    pushReplacementGatesPass(mockDB);
    mockDB.pushResultFor('SELECT id, name, status, is_shared', [
      { id: V1, name: '새 목소리', status: 'ready' },
    ]);
    let release!: () => void;
    mockNotifyDowngradedAlarms.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );

    const execution = fakeExecutionCtx();
    const response = await buildApp().fetch(
      jsonReq('PATCH', `/vp/${V2}`, { is_draft: false, replace_existing: true }),
      ENV,
      execution.ctx,
    );

    // FCM/APNs 왕복이 아직 안 끝났는데도 응답이 돌아와야 한다.
    expect(response.status).toBe(200);
    expect(execution.tasks, '철회 fanout 이 waitUntil 에 등록되지 않았다').toHaveLength(1);
    release();
    await execution.drain();
    expect(mockNotifyDowngradedAlarms).toHaveBeenCalledTimes(1);
  });

  // ⚠ `scheduleVoiceShareChangedPush` 와 다르다. 저쪽은 executionCtx 가 없으면 push 를
  // **생략**하지만(목록 갱신이라 주기 재조회로 충분), 철회는 생략하면 조용히 사라진다.
  it('ExecutionContext 가 없으면 생략하지 않고 직접 보낸다', async () => {
    pushReplaceLookups();
    pushReplacementGatesPass(mockDB);
    mockDB.pushResultFor('SELECT id, name, status, is_shared', [
      { id: V1, name: '새 목소리', status: 'ready' },
    ]);

    const response = await req(
      buildApp(),
      jsonReq('PATCH', `/vp/${V2}`, { is_draft: false, replace_existing: true }),
    );

    expect(response.status).toBe(200);
    expect(mockNotifyDowngradedAlarms, '공유 push 처럼 생략하면 철회가 사라진다').toHaveBeenCalledTimes(1);
  });
});

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
    pushPaidPlan(); // userIdPK 가 채워지며 유료 플랜 조회가 실제로 실행된다 — 큐 맨 앞에 유료 플랜 행을 넣어 준다.
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-zero' });
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), '첫번째'));
    expect(res.status).toBe(201);
    expect((await res.json()).profile.status).toBe('ready');
  });

  it('non-Error throw 여도 detail 은 안정 코드(K1)', async () => {
    pushPaidPlan();
    mockDB.pushResult([{ count: 0 }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockCreateInstantClone.mockRejectedValue('string-error');
    const res = await req(buildApp(), cloneForm(new Uint8Array([1]), 'test'));
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toBe('VOICE_CLONING_FAILED');
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
