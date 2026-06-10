import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/db', () => ({
  getDB: () => ({
    execute: vi.fn().mockResolvedValue({ rows: [{ '1': 1 }] }),
  }),
  initDB: vi.fn(),
}));

import app from '../src/index';

describe('GET / — health check', () => {
  it('DB 정상 시 ok 반환', async () => {
    const res = await app.fetch(new Request('http://localhost/'), {
      TURSO_DATABASE_URL: 'mock',
      TURSO_AUTH_TOKEN: 'mock',
    } as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe('AlarmTalk API');
    expect(data.status).toBe('ok');
    expect(data.db).toBe('ok');
  });

  it('응답에 version 필드 포함', async () => {
    const res = await app.fetch(new Request('http://localhost/'), {
      TURSO_DATABASE_URL: 'mock',
      TURSO_AUTH_TOKEN: 'mock',
    } as never);
    const data = await res.json();
    expect(data.version).toBe('1.0.0');
  });

  it('GET /health 도 같은 health payload 를 반환', async () => {
    const res = await app.fetch(new Request('http://localhost/health'), {
      TURSO_DATABASE_URL: 'mock',
      TURSO_AUTH_TOKEN: 'mock',
    } as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.db).toBe('ok');
  });
});
