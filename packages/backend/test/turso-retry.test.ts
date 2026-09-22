import { describe, expect, it, vi } from 'vitest';
import { LibsqlError } from '@libsql/client/web';
import {
  isReadStatement,
  isTransientTursoGatewayError,
  retryTransientTurso,
  withTransientReadRetry,
} from '../src/lib/turso-retry';

/** 운영에서 실제로 오는 모양 — `@libsql/client` 의 `mapHranaError` 가 만든다(`SERVER_ERROR: …`). */
function gatewayError(status: number): LibsqlError {
  return new LibsqlError(`Server returned HTTP status ${status}`, 'SERVER_ERROR');
}

describe('isTransientTursoGatewayError', () => {
  it('게이트웨이 5xx 는 전부 일시적이다 — 525 도(2026-09-22 전에는 520 만 봐서 BACKEND-3 이 한 번도 재시도되지 않았다)', () => {
    for (const status of [500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526]) {
      expect(isTransientTursoGatewayError(gatewayError(status)), `status ${status}`).toBe(true);
    }
    // `String(err)` 는 "LibsqlError: SERVER_ERROR: …" 다 — 소문자 libsql 검사가 빗나가던 그 형태.
    expect(String(gatewayError(525))).toBe('LibsqlError: SERVER_ERROR: Server returned HTTP status 525');
  });

  it('전송 계층 실패도 일시적이다', () => {
    expect(isTransientTursoGatewayError(new LibsqlError('socket closed', 'HRANA_WEBSOCKET_ERROR'))).toBe(true);
    expect(isTransientTursoGatewayError(new LibsqlError('closed', 'HRANA_CLOSED_ERROR'))).toBe(true);
    expect(isTransientTursoGatewayError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientTursoGatewayError(new Error('read ECONNRESET'))).toBe(true);
  });

  it('SQL 오류·4xx 는 즉시 실패다', () => {
    expect(isTransientTursoGatewayError(new LibsqlError('UNIQUE constraint failed: users.email', 'SQLITE_CONSTRAINT'))).toBe(false);
    expect(isTransientTursoGatewayError(new LibsqlError('no such column: foo', 'SQLITE_ERROR'))).toBe(false);
    expect(isTransientTursoGatewayError(gatewayError(401))).toBe(false);
    expect(isTransientTursoGatewayError(gatewayError(429))).toBe(false);
    expect(isTransientTursoGatewayError(new Error('boom'))).toBe(false);
  });

  it('Sentry 에 문자열로 남은 형태도 알아본다', () => {
    expect(isTransientTursoGatewayError('Server returned HTTP status 520')).toBe(true);
  });
});

describe('retryTransientTurso', () => {
  it('525 뒤의 성공을 돌려준다(150ms·450ms 백오프, 최대 3회)', async () => {
    vi.useFakeTimers();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(gatewayError(525))
      .mockRejectedValueOnce(gatewayError(520))
      .mockResolvedValueOnce('ok');

    const result = retryTransientTurso(operation);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('세 번 다 실패하면 마지막 오류를 던진다', async () => {
    vi.useFakeTimers();
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(gatewayError(525));
    const result = retryTransientTurso(operation);
    result.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(result).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(operation).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('게이트웨이 오류가 아니면 재시도하지 않는다', async () => {
    const error = new LibsqlError('UNIQUE constraint failed', 'SQLITE_CONSTRAINT');
    await expect(retryTransientTurso(() => Promise.reject(error))).rejects.toBe(error);
  });
});

describe('withTransientReadRetry', () => {
  it('읽기 문장을 가른다', () => {
    expect(isReadStatement('SELECT 1')).toBe(true);
    expect(isReadStatement({ sql: '  select id from users where id = ?', args: ['x'] })).toBe(true);
    expect(isReadStatement('EXPLAIN QUERY PLAN SELECT 1')).toBe(true);
    expect(isReadStatement({ sql: 'INSERT INTO t VALUES (1)' })).toBe(false);
    expect(isReadStatement('UPDATE t SET a = 1')).toBe(false);
    expect(isReadStatement('DELETE FROM t')).toBe(false);
    expect(isReadStatement(undefined)).toBe(false);
  });

  it('SELECT 는 525 에서 다시 시도하고, INSERT 는 그대로 던진다 — 쓰기를 두 번 보내지 않는다', async () => {
    vi.useFakeTimers();
    const execute = vi
      .fn()
      .mockRejectedValueOnce(gatewayError(525))
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }] });
    const raw = { execute, batch: vi.fn(async () => []), closed: false } as unknown as Parameters<typeof withTransientReadRetry>[0];
    const db = withTransientReadRetry(raw);

    const read = db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: ['u1'] });
    await vi.runAllTimersAsync();
    await expect(read).resolves.toEqual({ rows: [{ id: 'u1' }] });
    expect(execute).toHaveBeenCalledTimes(2);

    execute.mockReset().mockRejectedValueOnce(gatewayError(525));
    await expect(db.execute({ sql: 'INSERT INTO t VALUES (1)' })).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(execute).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('execute 외의 멤버는 그대로 통과한다(batch·속성)', async () => {
    const batch = vi.fn(async () => ['b']);
    const raw = { execute: vi.fn(), batch, closed: false } as unknown as Parameters<typeof withTransientReadRetry>[0];
    const db = withTransientReadRetry(raw);
    await expect(db.batch([])).resolves.toEqual(['b']);
    expect(db.closed).toBe(false);
  });
});
