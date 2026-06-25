import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../src/types';

const mockDB = {
  execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 0 }),
  batch: vi.fn().mockResolvedValue([]),
};

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB,
  initDB: vi.fn().mockResolvedValue(undefined),
}));

const { default: worker } = await import('../src/index');

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'test-client-id',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'test',
};

function req(method: string, path: string, body?: Record<string, unknown>) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

async function fetchApp(method: string, path: string, body?: Record<string, unknown>) {
  const r = req(method, path, body);
  return worker.fetch(r, ENV, {} as ExecutionContext);
}

beforeEach(() => {
  mockDB.execute.mockReset();
  mockDB.execute.mockResolvedValue({ rows: [], rowsAffected: 0 });
});

describe('Health & Public Routes', () => {
  it('GET / → 200 health check 응답', async () => {
    mockDB.execute.mockResolvedValueOnce({ rows: [{ 1: 1 }], rowsAffected: 0 });
    const res = await fetchApp('GET', '/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('AlarmTalk API');
    expect(body.version).toBe('1.0.0');
    expect(body.status).toBe('ok');
  });

  it('GET / → DB 연결 실패 시 degraded', async () => {
    mockDB.execute.mockRejectedValueOnce(new Error('DB down'));
    const res = await fetchApp('GET', '/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.db).toBe('error');
  });

  it('GET /api/tts/presets → 200 프리셋 목록 (인증 불필요)', async () => {
    const res = await fetchApp('GET', '/api/tts/presets');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presets).toBeDefined();
    expect(Array.isArray(body.presets)).toBe(true);
    expect(body.presets.length).toBeGreaterThan(0);
  });

  it('POST /api/init-db → 시크릿 미설정(비프로덕션)이면 404 (익명 차단)', async () => {
    // FIX 8: canRunInitDb 는 모든 환경에서 x-init-db-secret 를 요구한다.
    // INIT_DB_SECRET 가 설정돼 있지 않으면 비프로덕션이라도 거부한다.
    const res = await fetchApp('POST', '/api/init-db');
    expect(res.status).toBe(404);
  });

  it('POST /api/init-db → 올바른 시크릿 헤더면 200 DB 초기화', async () => {
    const request = new Request('http://localhost/api/init-db', {
      method: 'POST',
      headers: { 'x-init-db-secret': 'init-secret' },
    });
    const res = await worker.fetch(
      request,
      { ...ENV, INIT_DB_SECRET: 'init-secret' },
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('POST /api/init-db → production에서는 secret 없으면 404', async () => {
    const res = await worker.fetch(req('POST', '/api/init-db'), {
      ...ENV,
      ENVIRONMENT: 'production',
    }, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  it('POST /api/init-db → production에서는 x-init-db-secret 필요', async () => {
    const request = new Request('http://localhost/api/init-db', {
      method: 'POST',
      headers: { 'x-init-db-secret': 'init-secret' },
    });
    const res = await worker.fetch(request, {
      ...ENV,
      ENVIRONMENT: 'production',
      INIT_DB_SECRET: 'init-secret',
    }, {} as ExecutionContext);
    expect(res.status).toBe(200);
  });
});

describe('Auth Routes (인증 불필요)', () => {
  it('POST /api/auth/register → 이메일 누락 시 400', async () => {
    const res = await fetchApp('POST', '/api/auth/register', { password: 'Test1234' });
    expect(res.status).toBe(400);
  });

  it('POST /api/auth/login → 잘못된 이메일 시 401', async () => {
    mockDB.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 0 });
    const res = await fetchApp('POST', '/api/auth/login', {
      email: 'nobody@test.com',
      password: 'Test1234',
    });
    expect(res.status).toBe(401);
  });
});

describe('Protected Routes — 인증 없이 요청 시 401', () => {
  const protectedEndpoints: [string, string][] = [
    ['GET', '/api/voice'],
    ['GET', '/api/tts/generate'],
    ['GET', '/api/alarm'],
    ['GET', '/api/user/me'],
    ['GET', '/api/library'],
    ['GET', '/api/friend'],
    ['GET', '/api/gift/received'],
    ['GET', '/api/stats'],
    ['GET', '/api/dub/languages'],
    ['GET', '/api/billing/vouchers'],
    ['GET', '/api/family/group'],
    ['POST', '/api/code/register'],
    ['GET', '/api/notes/received'],
  ];

  for (const [method, path] of protectedEndpoints) {
    it(`${method} ${path} → 401 AUTH_MISSING`, async () => {
      const res = await fetchApp(method, path);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error_code).toBe('AUTH_MISSING');
    });
  }
});

describe('Security Headers', () => {
  it('응답에 보안 헤더가 포함된다', async () => {
    mockDB.execute.mockResolvedValueOnce({ rows: [{ 1: 1 }], rowsAffected: 0 });
    const res = await fetchApp('GET', '/');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});

describe('CORS', () => {
  it('허용된 origin에 대해 CORS 헤더 반환', async () => {
    const r = new Request('http://localhost/', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:8081',
        'Access-Control-Request-Method': 'GET',
      },
    });
    const res = await worker.fetch(r, ENV, {} as ExecutionContext);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8081');
  });
});

describe('404 처리', () => {
  it('/api 외부 존재하지 않는 경로 → 404', async () => {
    const res = await fetchApp('GET', '/nonexistent-route-xyz');
    expect(res.status).toBe(404);
  });

  it('/api 내부 존재하지 않는 경로 → 401 (auth 먼저 실행)', async () => {
    const res = await fetchApp('GET', '/api/nonexistent-route-xyz');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_code).toBe('AUTH_MISSING');
  });
});
