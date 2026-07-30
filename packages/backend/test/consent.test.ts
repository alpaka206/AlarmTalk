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
  ALLOWED_CONSENT_TYPES,
  CONSENT_MIN_POLICY_VERSION,
  CURRENT_POLICY_VERSION,
} from '../src/lib/consent';

// consentMiddleware 가 getDB 로 user_consents 를 조회한다. 게이트 테스트에서 동의 상태를
// 제어하기 위해 mock 한다. vi.mock 은 파일 상단으로 호이스트되며 factory 는 'mock' 으로
// 시작하는 변수만 참조할 수 있어 mockConsentRows 로 명명한다.
let mockConsentRows: Array<{ consent_type: string; policy_version: string; agreed: number }> = [];
vi.mock('../src/lib/db', () => ({
  getDB: () => ({
    execute: async (q: { sql: string }) => {
      if (/FROM user_consents/i.test(q.sql)) {
        return { rows: mockConsentRows, rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 0 };
    },
  }),
}));

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

describe('lib/consent — config', () => {
  it('새 민감 동의 유형(voice_biometric/overseas_transfer)이 ALLOWED 에 포함', () => {
    expect(ALLOWED_CONSENT_TYPES.has('voice_biometric')).toBe(true);
    expect(ALLOWED_CONSENT_TYPES.has('overseas_transfer')).toBe(true);
  });
  it('일반/민감 필수 목록이 분리돼 있다', () => {
    expect([...GENERAL_REQUIRED_CONSENTS]).toEqual(['terms', 'privacy', 'age14']);
    expect([...SENSITIVE_REQUIRED_CONSENTS]).toEqual(['voice_biometric', 'overseas_transfer']);
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

  it('필수 동의 기록 후 데이터 라우트 통과', async () => {
    mockConsentRows = [
      consentRow('terms'),
      consentRow('privacy'),
      consentRow('age14'),
    ];
    const res = await call('GET', '/api/alarm');
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe('data-route');
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
  required: string[];
  missing: string[];
  collect: string[];
  sensitive_missing: string[];
  policy_version: string;
}

async function consentStatus(): Promise<StatusBody> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userIdPK', 'pk-1');
    c.set('userLoginId', 'user-1');
    await next();
  });
  app.route('/user', userRoutes);
  const res = await app.request(
    new Request('http://localhost/user/consents/status'),
    undefined,
    ENV,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as StatusBody;
}

describe('GET /user/consents/status — collect / sensitive_missing', () => {
  const originalMin = { ...CONSENT_MIN_POLICY_VERSION };
  beforeEach(() => {
    mockConsentRows = [];
  });
  afterEach(() => {
    Object.assign(CONSENT_MIN_POLICY_VERSION, originalMin);
  });

  it('v3 로 다 답해 뒀으면 재동의도 재수집도 없다', async () => {
    mockConsentRows = [
      consentRow('terms', 1, '3'),
      consentRow('privacy', 1, '3'),
      consentRow('age14', 1, '3'),
      consentRow('marketing', 1, '3'),
    ];
    const body = await consentStatus();
    expect(body.needs_consent).toBe(false);
    expect(body.missing).toEqual([]);
    expect(body.collect).toEqual([]);
    expect(body.policy_version).toBe(CURRENT_POLICY_VERSION);
  });

  it('마케팅을 켜 둔 사용자는 collect 에 marketing 이 없다 (덮어쓰기로 인한 소실 방지)', async () => {
    mockConsentRows = [
      consentRow('terms', 1, '3'),
      consentRow('privacy', 1, '3'),
      consentRow('age14', 1, '3'),
      consentRow('marketing', 1, '3'),
    ];
    expect((await consentStatus()).collect).not.toContain('marketing');
  });

  it('마케팅 거절 기록도 유효한 응답이라 다시 묻지 않는다', async () => {
    mockConsentRows = [
      consentRow('terms', 1, '3'),
      consentRow('privacy', 1, '3'),
      consentRow('age14', 1, '3'),
      consentRow('marketing', 0, '3'),
    ];
    expect((await consentStatus()).collect).toEqual([]);
  });

  it('마케팅을 한 번도 안 물었으면 collect 에만 들어가고 needs_consent 는 false', async () => {
    mockConsentRows = [
      consentRow('terms', 1, '3'),
      consentRow('privacy', 1, '3'),
      consentRow('age14', 1, '3'),
    ];
    const body = await consentStatus();
    expect(body.needs_consent).toBe(false);
    expect(body.missing).toEqual([]);
    expect(body.collect).toEqual(['marketing']);
  });

  it('동의 기록이 없으면 필수 3종 + marketing 을 모두 받는다', async () => {
    const body = await consentStatus();
    expect(body.needs_consent).toBe(true);
    expect(body.missing).toEqual(['terms', 'privacy', 'age14']);
    expect(body.collect).toEqual(['terms', 'privacy', 'age14', 'marketing']);
  });

  it('한 유형의 최소 버전만 올리면 그 유형만 missing/collect 에 뜬다', async () => {
    CONSENT_MIN_POLICY_VERSION.privacy = 4;
    mockConsentRows = [
      consentRow('terms', 1, '3'),
      consentRow('privacy', 1, '3'),
      consentRow('age14', 1, '3'),
      consentRow('marketing', 1, '3'),
    ];
    const body = await consentStatus();
    expect(body.needs_consent).toBe(true);
    expect(body.missing).toEqual(['privacy']);
    expect(body.collect).toEqual(['privacy']);
  });

  it('정책 버전이 이상한 기록은 재동의 대상이 된다', async () => {
    mockConsentRows = [
      consentRow('terms', 1, ''),
      consentRow('privacy', 1, '3'),
      consentRow('age14', 1, '3'),
      consentRow('marketing', 1, 'nope'),
    ];
    const body = await consentStatus();
    expect(body.missing).toEqual(['terms']);
    expect(body.collect).toEqual(['terms', 'marketing']);
  });

  it('sensitive_missing 은 민감 동의 상태만 반영하고 needs_consent 를 올리지 않는다', async () => {
    mockConsentRows = [
      consentRow('terms', 1, '3'),
      consentRow('privacy', 1, '3'),
      consentRow('age14', 1, '3'),
      consentRow('marketing', 1, '3'),
      consentRow('voice_biometric', 1, '3'),
    ];
    const body = await consentStatus();
    expect(body.sensitive_missing).toEqual(['overseas_transfer']);
    expect(body.needs_consent).toBe(false);
    expect(body.collect).toEqual([]); // 민감 동의는 가입 게이트가 아니라 목소리 등록 화면에서 받는다
  });

  it('민감 동의를 철회(agreed=0)하면 sensitive_missing 에 다시 뜬다', async () => {
    mockConsentRows = [
      consentRow('terms', 1, '3'),
      consentRow('privacy', 1, '3'),
      consentRow('age14', 1, '3'),
      consentRow('marketing', 1, '3'),
      consentRow('voice_biometric', 0, '3'),
      consentRow('overseas_transfer', 1, '3'),
    ];
    expect((await consentStatus()).sensitive_missing).toEqual(['voice_biometric']);
  });

  it('민감 동의가 모두 유효하면 sensitive_missing 은 빈 배열', async () => {
    mockConsentRows = [
      consentRow('terms', 1, '3'),
      consentRow('privacy', 1, '3'),
      consentRow('age14', 1, '3'),
      consentRow('marketing', 1, '3'),
      consentRow('voice_biometric', 1, '3'),
      consentRow('overseas_transfer', 1, '3'),
    ];
    expect((await consentStatus()).sensitive_missing).toEqual([]);
  });
});
