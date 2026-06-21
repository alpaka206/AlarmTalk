import { describe, it, expect, vi, beforeEach } from 'vitest';

// initDB 가 호출되면 성공하지만, 가드(404)에서 막히면 호출 자체가 없어야 한다.
const initDBMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../src/lib/db', () => ({
  getDB: () => ({
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  }),
  initDB: initDBMock,
}));

import app from '../src/index';

const baseEnv = {
  TURSO_DATABASE_URL: 'mock',
  TURSO_AUTH_TOKEN: 'mock',
} as never;

function post(path: string, env: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.fetch(new Request(`http://localhost${path}`, { method: 'POST', headers }), env as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/init-db — secret guard (FIX 8)', () => {
  it('비프로덕션이라도 시크릿 미설정이면 404 (익명 차단)', async () => {
    const res = await post('/api/init-db', { ...baseEnv, ENVIRONMENT: 'development' });
    expect(res.status).toBe(404);
    expect(initDBMock).not.toHaveBeenCalled();
  });

  it('시크릿 설정돼 있어도 헤더 없으면 404', async () => {
    const res = await post('/api/init-db', {
      ...baseEnv,
      ENVIRONMENT: 'development',
      INIT_DB_SECRET: 's3cret',
    });
    expect(res.status).toBe(404);
    expect(initDBMock).not.toHaveBeenCalled();
  });

  it('잘못된 헤더면 404', async () => {
    const res = await post(
      '/api/init-db',
      { ...baseEnv, ENVIRONMENT: 'development', INIT_DB_SECRET: 's3cret' },
      { 'x-init-db-secret': 'wrong' },
    );
    expect(res.status).toBe(404);
    expect(initDBMock).not.toHaveBeenCalled();
  });

  it('production 도 동일하게 시크릿 헤더 요구', async () => {
    const res = await post('/api/init-db', {
      ...baseEnv,
      ENVIRONMENT: 'production',
      INIT_DB_SECRET: 's3cret',
    });
    expect(res.status).toBe(404);
  });

  it('올바른 시크릿 헤더면 통과해 initDB 실행', async () => {
    const res = await post(
      '/api/init-db',
      { ...baseEnv, ENVIRONMENT: 'development', INIT_DB_SECRET: 's3cret' },
      { 'x-init-db-secret': 's3cret' },
    );
    expect(res.status).toBe(200);
    expect(initDBMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/seed-stock-clips — shares same guard (FIX 8)', () => {
  it('시크릿 미설정이면 404', async () => {
    const res = await post('/api/admin/seed-stock-clips', {
      ...baseEnv,
      ENVIRONMENT: 'development',
    });
    expect(res.status).toBe(404);
  });

  it('헤더 없으면 404', async () => {
    const res = await post('/api/admin/seed-stock-clips', {
      ...baseEnv,
      ENVIRONMENT: 'development',
      INIT_DB_SECRET: 's3cret',
    });
    expect(res.status).toBe(404);
  });
});

describe('init-db error body does not leak internals (FIX 9)', () => {
  it('initDB 가 SQL 내부 메시지로 throw 해도 detail 을 반사하지 않는다', async () => {
    initDBMock.mockRejectedValueOnce(new Error('SQLITE_ERROR: near "FROM": syntax error'));
    const res = await post(
      '/api/init-db',
      { ...baseEnv, ENVIRONMENT: 'development', INIT_DB_SECRET: 's3cret' },
      { 'x-init-db-secret': 's3cret' },
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('DB init failed');
    expect(body.detail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('SQLITE_ERROR');
  });
});
