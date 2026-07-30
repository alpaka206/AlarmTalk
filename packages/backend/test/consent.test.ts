import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB } from './helpers';
import {
  needsConsent,
  missingConsentType,
  missingConsentTypes,
  GENERAL_REQUIRED_CONSENTS,
  SENSITIVE_REQUIRED_CONSENTS,
  REQUIRED_CONSENT_TYPES,
  ALLOWED_CONSENT_TYPES,
  CONSENT_MIN_POLICY_VERSION,
  CURRENT_POLICY_VERSION,
} from '../src/lib/consent';

// consentMiddleware 가 getDB 로 user_consents 를 조회한다. 게이트 테스트에서 동의 상태를
// 제어하기 위해 mock 한다. vi.mock 은 파일 상단으로 호이스트되며 factory 는 'mock' 으로
// 시작하는 변수만 참조할 수 있어 mockConsentRows 로 명명한다.
let mockConsentRows: Array<{ consent_type: string; policy_version: string; agreed: number }> = [];
// POST /user/consents 가 실제로 INSERT 한 값 — 저장되는 정책 버전을 직접 들여다보기 위해
// 기록해 둔다(요청 바디의 version 이 아니라 서버 값이 들어가야 한다).
let mockConsentInserts: Array<{ type: string; version: string; agreed: number }> = [];
vi.mock('../src/lib/db', () => {
  const execute = async (q: { sql: string; args?: unknown[] }) => {
    if (/INSERT INTO user_consents/i.test(q.sql)) {
      const args = (q.args ?? []) as unknown[];
      // (id, user_id, consent_type, policy_version, agreed)
      mockConsentInserts.push({
        type: String(args[2]),
        version: String(args[3]),
        agreed: Number(args[4]),
      });
      return { rows: [], rowsAffected: 1 };
    }
    if (/FROM user_consents/i.test(q.sql)) {
      return { rows: mockConsentRows, rowsAffected: 0 };
    }
    return { rows: [], rowsAffected: 0 };
  };
  const transaction = async () => {
    const tx = {
      closed: false,
      execute,
      batch: async () => {},
      executeMultiple: async () => {},
      commit: async () => {
        tx.closed = true;
      },
      rollback: async () => {
        tx.closed = true;
      },
      close: () => {
        tx.closed = true;
      },
    };
    return tx;
  };
  return { getDB: () => ({ execute, transaction }) };
});

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

function consentRow(type: string, agreed = 1, version = CURRENT_POLICY_VERSION) {
  return { consent_type: type, policy_version: version, agreed };
}

/**
 * '가입 필수 동의를 다 갖춘 사용자' 의 행 목록. 목록을 손으로 나열하지 않고 소스의
 * REQUIRED_CONSENT_TYPES 에서 만들어, 필수 목록이 또 바뀌어도 픽스처가 따라오게 한다.
 * overrides 로 특정 유형만 미동의/다른 버전으로 비틀어 시나리오를 만든다.
 */
function requiredRows(
  overrides: Record<string, { agreed?: number; version?: string }> = {},
  version = '3',
) {
  return REQUIRED_CONSENT_TYPES.map((type) =>
    consentRow(type, overrides[type]?.agreed ?? 1, overrides[type]?.version ?? version),
  );
}

describe('lib/consent — config', () => {
  it('새 민감 동의 유형(voice_biometric/overseas_transfer)이 ALLOWED 에 포함', () => {
    expect(ALLOWED_CONSENT_TYPES.has('voice_biometric')).toBe(true);
    expect(ALLOWED_CONSENT_TYPES.has('overseas_transfer')).toBe(true);
  });
  it('일반/민감 필수 목록이 분리돼 있다', () => {
    expect([...GENERAL_REQUIRED_CONSENTS]).toEqual(['terms', 'privacy', 'age14']);
    expect([...SENSITIVE_REQUIRED_CONSENTS]).toEqual(['voice_biometric', 'overseas_transfer']);
  });
  it('가입 동의 화면이 받는 필수는 일반 3종 + 민감 2종 = 5종이다', () => {
    // 목소리 알람이 앱의 핵심이라 음성 처리 동의(생체정보·국외 이전)까지 가입 시 한 번에
    // 받는다. 이 목록은 /consents/status 의 missing·collect 계산 전용이며, 미들웨어의
    // 하드 게이트는 아래 'needsConsent' 테스트대로 여전히 GENERAL 3종만 본다.
    expect([...REQUIRED_CONSENT_TYPES]).toEqual([
      ...GENERAL_REQUIRED_CONSENTS,
      ...SENSITIVE_REQUIRED_CONSENTS,
    ]);
  });
  it('문서 버전은 4 이지만 유형별 최소 버전은 전부 3 (v4 는 축소 개정 → 재동의 사유 아님)', () => {
    expect(CURRENT_POLICY_VERSION).toBe('4');
    expect(Object.values(CONSENT_MIN_POLICY_VERSION).every((v) => v === 3)).toBe(true);
  });
});

describe('lib/consent — needsConsent', () => {
  let mockDB: ReturnType<typeof createMockDB>;
  beforeEach(() => {
    mockDB = createMockDB();
    // needsConsent 가 user_consents 를 조회하므로 missing 모드로 두고 직접 결과를 push 한다.
    mockDB.setConsentMissing(true);
  });

  it('필수 동의가 모두 기록·동의·최신버전이면 false', async () => {
    mockDB.pushResult([
      consentRow('terms'),
      consentRow('privacy'),
      consentRow('age14'),
    ]);
    expect(await needsConsent(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS)).toBe(false);
  });

  it('한 유형이라도 미기록이면 true', async () => {
    mockDB.pushResult([consentRow('terms'), consentRow('privacy')]);
    expect(await needsConsent(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS)).toBe(true);
  });

  it('미동의(agreed=0)이면 true', async () => {
    mockDB.pushResult([
      consentRow('terms'),
      consentRow('privacy'),
      consentRow('age14', 0),
    ]);
    expect(await needsConsent(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS)).toBe(true);
  });

  it('정책 버전이 그 유형의 최소 버전보다 낮으면 true', async () => {
    mockDB.pushResult([
      consentRow('terms'),
      consentRow('privacy'),
      consentRow('age14', 1, '0'),
    ]);
    expect(await needsConsent(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS)).toBe(true);
  });

  it('동일 유형 최신 1건만 본다 (가장 먼저 온 행이 최신)', async () => {
    // ORDER BY created_at DESC, rowid DESC → 첫 행이 최신. 최신이 동의면 통과.
    mockDB.pushResult([
      consentRow('terms', 1),
      consentRow('terms', 0), // 과거 미동의 이력 — 무시돼야 함
      consentRow('privacy'),
      consentRow('age14'),
    ]);
    expect(await needsConsent(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS)).toBe(false);
  });

  it('빈 requiredTypes 는 항상 false (쿼리 없이)', async () => {
    expect(await needsConsent(mockDB.client as never, 'pk-1', [])).toBe(false);
  });

  // 하드 게이트 범위 고정. 이게 깨지면 '음성 동의를 철회한 사용자가 앱 전체에서 잠긴다' 는
  // 회귀가 조용히 들어온다 — 가입 화면이 5종을 받는 것과 게이트가 3종만 보는 것은 별개다.
  it('민감 동의가 없어도 GENERAL 3종 기준이면 false (가입 화면 기준으로는 민감 2종이 missing)', async () => {
    const generalOnly = [consentRow('terms'), consentRow('privacy'), consentRow('age14')];
    mockDB.pushResult(generalOnly);
    expect(await needsConsent(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS)).toBe(
      false,
    );
    // 같은 기록을 가입 필수 5종 기준으로 보면 민감 2종이 빠져 있다.
    mockDB.pushResult(generalOnly);
    expect(
      await missingConsentTypes(mockDB.client as never, 'pk-1', REQUIRED_CONSENT_TYPES),
    ).toEqual(['voice_biometric', 'overseas_transfer']);
  });

  it('민감 동의를 철회(agreed=0)해도 GENERAL 3종 기준이면 false', async () => {
    mockDB.pushResult([
      ...requiredRows({ voice_biometric: { agreed: 0 }, overseas_transfer: { agreed: 0 } }),
    ]);
    expect(await needsConsent(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS)).toBe(
      false,
    );
  });
});

// ---- 유형별 최소 정책 버전 (문서 버전이 올라도 축소 개정이면 재동의 없음) ----
describe('lib/consent — CONSENT_MIN_POLICY_VERSION', () => {
  let mockDB: ReturnType<typeof createMockDB>;
  const originalMin = { ...CONSENT_MIN_POLICY_VERSION };

  beforeEach(() => {
    mockDB = createMockDB();
    mockDB.setConsentMissing(true);
  });
  afterEach(() => {
    Object.assign(CONSENT_MIN_POLICY_VERSION, originalMin);
  });

  it('문서 버전이 4 여도 v3 기록은 그대로 유효하다 (v4 축소 개정 회귀 방지)', async () => {
    mockDB.pushResult([
      consentRow('terms', 1, '3'),
      consentRow('privacy', 1, '3'),
      consentRow('age14', 1, '3'),
    ]);
    expect(await needsConsent(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS)).toBe(
      false,
    );
  });

  it('기록 버전이 최소 버전보다 높아도 유효하다', async () => {
    mockDB.pushResult([
      consentRow('terms', 1, '9'),
      consentRow('privacy', 1, '9'),
      consentRow('age14', 1, '9'),
    ]);
    expect(await needsConsent(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS)).toBe(
      false,
    );
  });

  it('한 유형의 최소 버전만 올리면 그 유형만 missing 이 된다', async () => {
    CONSENT_MIN_POLICY_VERSION.privacy = 4;
    mockDB.pushResult([
      consentRow('terms', 1, '3'),
      consentRow('privacy', 1, '3'),
      consentRow('age14', 1, '3'),
    ]);
    expect(await missingConsentTypes(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS))
      .toEqual(['privacy']);
  });

  it.each([['', '빈 값'], ['x', '숫자 아님'], ['v3', '접두사'], ['3.1', '소수점']])(
    "정책 버전 '%s'(%s)은 파싱 불가 → 0 으로 보고 재동의를 요구한다",
    async (version) => {
      mockDB.pushResult([
        consentRow('terms', 1, version),
        consentRow('privacy', 1, '3'),
        consentRow('age14', 1, '3'),
      ]);
      expect(await missingConsentTypes(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS))
        .toEqual(['terms']);
    },
  );

  it('복수형은 미충족 전부를, 단수형은 그 첫 원소를 돌려준다', async () => {
    mockDB.pushResult([consentRow('privacy', 1, '3')]);
    expect(await missingConsentTypes(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS))
      .toEqual(['terms', 'age14']);
    mockDB.pushResult([consentRow('privacy', 1, '3')]);
    expect(await missingConsentType(mockDB.client as never, 'pk-1', GENERAL_REQUIRED_CONSENTS))
      .toBe('terms');
  });
});

// ---- consentMiddleware (라우트 게이트) ----
import { consentMiddleware } from '../src/middleware/consent';

function buildApp() {
  const app = new Hono<AppEnv>();
  // authMiddleware 대체: userIdPK 를 심는다.
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userIdPK', 'pk-1');
    await next();
  });
  app.use('*', consentMiddleware);
  app.get('/api/alarm', (c) => c.json({ ok: 'data-route' }));
  app.post('/api/voice/clone', (c) => c.json({ ok: 'clone' }));
  app.get('/api/user/consents/status', (c) => c.json({ ok: 'status' }));
  app.post('/api/user/consents', (c) => c.json({ ok: 'record' }));
  app.delete('/api/user/me/deletion', (c) => c.json({ ok: 'cancel-deletion' }));
  app.get('/api/app/version', (c) => c.json({ ok: 'version' }));
  app.get('/api/holiday', (c) => c.json({ ok: 'holiday' }));
  return app;
}

function call(method: string, path: string) {
  return buildApp().request(
    new Request(`http://localhost${path}`, { method }),
    undefined,
    ENV,
  );
}

describe('consentMiddleware — 데이터 라우트 게이트 (B4)', () => {
  beforeEach(() => {
    mockConsentRows = [];
  });

  it('필수 동의 없으면 데이터 라우트 403 CONSENT_REQUIRED', async () => {
    mockConsentRows = [];
    const res = await call('GET', '/api/alarm');
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('CONSENT_REQUIRED');
  });

  it('일반 필수 3종만 기록해도 데이터 라우트 통과 (게이트는 민감 동의를 보지 않는다)', async () => {
    mockConsentRows = [
      consentRow('terms'),
      consentRow('privacy'),
      consentRow('age14'),
    ];
    const res = await call('GET', '/api/alarm');
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe('data-route');
  });

  // 가입 시 5종을 다 받더라도, 설정에서 음성 동의를 철회한 사용자는 그 기능만 막혀야 한다.
  // 여기서 403 이 나면 앱 전체가 잠기는 회귀다.
  it('민감 동의를 철회해도 데이터 라우트는 통과한다', async () => {
    mockConsentRows = [
      consentRow('terms'),
      consentRow('privacy'),
      consentRow('age14'),
      consentRow('voice_biometric', 0),
      consentRow('overseas_transfer', 0),
    ];
    const res = await call('GET', '/api/alarm');
    expect(res.status).toBe(200);
  });

  it.each([
    ['GET', '/api/user/consents/status'],
    ['POST', '/api/user/consents'],
    ['DELETE', '/api/user/me/deletion'],
    ['GET', '/api/app/version'],
    ['GET', '/api/holiday'],
  ])('면제 경로 %s %s 는 동의 없이도 통과', async (method, path) => {
    mockConsentRows = [];
    const res = await call(method, path);
    expect(res.status).toBe(200);
  });
});

// ---- GET /user/consents/status — 클라이언트 계약 ----
import userRoutes from '../src/routes/user';

interface StatusBody {
  needs_consent: boolean;
  needs_collection: boolean;
  required: string[];
  missing: string[];
  collect: string[];
  sensitive_missing: string[];
  policy_version: string;
}

function buildUserApp() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userIdPK', 'pk-1');
    c.set('userLoginId', 'user-1');
    await next();
  });
  app.route('/user', userRoutes);
  return app;
}

async function consentStatus(): Promise<StatusBody> {
  const res = await buildUserApp().request(
    new Request('http://localhost/user/consents/status'),
    undefined,
    ENV,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as StatusBody;
}

function postConsents(consents: unknown[]) {
  return buildUserApp().request(
    new Request('http://localhost/user/consents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consents }),
    }),
    undefined,
    ENV,
  );
}

// ---- POST /user/consents — 정책 버전은 서버가 정한다 (클라 값 위조 방지) ----
describe('POST /user/consents — 저장되는 정책 버전', () => {
  beforeEach(() => {
    mockConsentRows = [];
    mockConsentInserts = [];
  });

  it("클라가 version:'999' 를 보내도 저장은 현재 문서 버전으로 한다", async () => {
    const res = await postConsents([{ type: 'terms', agreed: true, version: '999' }]);
    expect(res.status).toBe(200);
    expect(mockConsentInserts).toEqual([
      { type: 'terms', version: CURRENT_POLICY_VERSION, agreed: 1 },
    ]);
  });

  it("클라가 아주 낮은 version:'1' 을 보내도 저장은 현재 문서 버전으로 한다", async () => {
    const res = await postConsents([{ type: 'privacy', agreed: true, version: '1' }]);
    expect(res.status).toBe(200);
    expect(mockConsentInserts).toEqual([
      { type: 'privacy', version: CURRENT_POLICY_VERSION, agreed: 1 },
    ]);
  });

  it('version 필드는 호환을 위해 받기만 하고 무시한다 — 400 으로 깨지 않는다', async () => {
    const res = await postConsents([
      { type: 'terms', agreed: true, version: 'v-nonsense' },
      { type: 'marketing', agreed: false },
    ]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, recorded: 2 });
    expect(mockConsentInserts.map((r) => r.version)).toEqual([
      CURRENT_POLICY_VERSION,
      CURRENT_POLICY_VERSION,
    ]);
  });
});

describe('GET /user/consents/status — collect / sensitive_missing', () => {
  const originalMin = { ...CONSENT_MIN_POLICY_VERSION };
  beforeEach(() => {
    mockConsentRows = [];
  });
  afterEach(() => {
    Object.assign(CONSENT_MIN_POLICY_VERSION, originalMin);
  });

  it('v3 로 다 답해 뒀으면 재동의도 재수집도 없다', async () => {
    mockConsentRows = [...requiredRows(), consentRow('marketing', 1, '3')];
    const body = await consentStatus();
    expect(body.needs_consent).toBe(false);
    expect(body.needs_collection).toBe(false);
    expect(body.missing).toEqual([]);
    expect(body.collect).toEqual([]);
    expect(body.policy_version).toBe(CURRENT_POLICY_VERSION);
  });

  it('마케팅을 켜 둔 사용자는 collect 에 marketing 이 없다 (덮어쓰기로 인한 소실 방지)', async () => {
    mockConsentRows = [...requiredRows(), consentRow('marketing', 1, '3')];
    expect((await consentStatus()).collect).not.toContain('marketing');
  });

  it('마케팅 거절 기록도 유효한 응답이라 다시 묻지 않는다', async () => {
    mockConsentRows = [...requiredRows(), consentRow('marketing', 0, '3')];
    expect((await consentStatus()).collect).toEqual([]);
  });

  it('마케팅을 한 번도 안 물었으면 collect 에만 들어가고 needs_consent 는 false', async () => {
    mockConsentRows = requiredRows();
    const body = await consentStatus();
    expect(body.needs_consent).toBe(false);
    expect(body.missing).toEqual([]);
    expect(body.collect).toEqual(['marketing']);
  });

  it('동의 기록이 없으면 가입 필수 5종 + marketing 을 모두 받는다', async () => {
    const body = await consentStatus();
    expect(body.needs_consent).toBe(true);
    expect(body.missing).toEqual([...REQUIRED_CONSENT_TYPES]);
    expect(body.collect).toEqual([...REQUIRED_CONSENT_TYPES, 'marketing']);
  });

  it('한 유형의 최소 버전만 올리면 그 유형만 missing/collect 에 뜬다', async () => {
    CONSENT_MIN_POLICY_VERSION.privacy = 4;
    mockConsentRows = [...requiredRows(), consentRow('marketing', 1, '3')];
    const body = await consentStatus();
    expect(body.needs_consent).toBe(true);
    expect(body.missing).toEqual(['privacy']);
    expect(body.collect).toEqual(['privacy']);
  });

  it('민감 유형의 최소 버전만 올려도 그 유형만 missing/collect 에 뜬다', async () => {
    CONSENT_MIN_POLICY_VERSION.voice_biometric = 4;
    mockConsentRows = [...requiredRows(), consentRow('marketing', 1, '3')];
    const body = await consentStatus();
    expect(body.needs_consent).toBe(true);
    expect(body.missing).toEqual(['voice_biometric']);
    expect(body.collect).toEqual(['voice_biometric']);
  });

  it('정책 버전이 이상한 기록은 재동의 대상이 된다', async () => {
    mockConsentRows = [
      ...requiredRows({ terms: { version: '' } }),
      consentRow('marketing', 1, 'nope'),
    ];
    const body = await consentStatus();
    expect(body.missing).toEqual(['terms']);
    expect(body.collect).toEqual(['terms', 'marketing']);
  });

  // 민감 동의도 가입 필수라 게이트 신호를 올린다. sensitive_missing 은 음성 라우트가
  // 따로 보는 목록으로 그대로 남아, 같은 상태를 두 관점에서 보여준다.
  it('민감 동의가 빠지면 sensitive_missing 에 뜨고 needs_consent 도 true 다', async () => {
    mockConsentRows = [
      ...requiredRows({ overseas_transfer: { agreed: 0 } }),
      consentRow('marketing', 1, '3'),
    ];
    const body = await consentStatus();
    expect(body.sensitive_missing).toEqual(['overseas_transfer']);
    // 가입 동의 화면이 5종을 받으므로 민감 동의가 빠지면 게이트도 화면도 올라간다.
    expect(body.needs_consent).toBe(true);
    expect(body.missing).toEqual(['overseas_transfer']);
    expect(body.collect).toEqual(['overseas_transfer']);
    expect(body.needs_collection).toBe(true);
  });

  it('민감 동의를 철회(agreed=0)하면 sensitive_missing 에 다시 뜬다', async () => {
    mockConsentRows = [
      ...requiredRows({ voice_biometric: { agreed: 0 } }),
      consentRow('marketing', 1, '3'),
    ];
    expect((await consentStatus()).sensitive_missing).toEqual(['voice_biometric']);
  });

  // needs_consent(게이트) 와 needs_collection(화면 노출) 의 의미 분리 — 선택 동의만
  // 다시 받아야 하는 개정에서 화면이 안 뜨던 회귀를 막는다.
  it('marketing 최소 버전만 올리면 needs_consent=false 인데 needs_collection=true 다', async () => {
    CONSENT_MIN_POLICY_VERSION.marketing = 4;
    mockConsentRows = [...requiredRows(), consentRow('marketing', 1, '3')];
    const body = await consentStatus();
    expect(body.needs_consent).toBe(false); // 필수는 다 충족 — 앱을 잠그면 안 된다
    expect(body.missing).toEqual([]);
    expect(body.needs_collection).toBe(true); // 그래도 화면은 한 번 띄워야 한다
    expect(body.collect).toEqual(['marketing']);
  });

  it('필수가 빠져 있으면 needs_consent 와 needs_collection 이 모두 true', async () => {
    const body = await consentStatus();
    expect(body.needs_consent).toBe(true);
    expect(body.needs_collection).toBe(true);
    expect(body.collect).toEqual([...REQUIRED_CONSENT_TYPES, 'marketing']);
  });

  it('민감 동의가 모두 유효하면 sensitive_missing 은 빈 배열', async () => {
    mockConsentRows = [...requiredRows(), consentRow('marketing', 1, '3')];
    expect((await consentStatus()).sensitive_missing).toEqual([]);
  });
});
