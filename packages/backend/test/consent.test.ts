import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { createMockDB } from './helpers';
import {
  needsConsent,
  GENERAL_REQUIRED_CONSENTS,
  SENSITIVE_REQUIRED_CONSENTS,
  ALLOWED_CONSENT_TYPES,
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

  it('정책 버전이 현재와 다르면 true', async () => {
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
  app.get('/api/user/me', (c) => c.json({ ok: 'me' }));
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
    ['GET', '/api/user/me'],
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
