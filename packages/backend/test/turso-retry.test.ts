import { describe, expect, it, vi } from 'vitest';
import { isTransientTursoGatewayError, retryTransientTurso } from '../src/lib/turso-retry';

describe('retryTransientTurso', () => {
  it('retries a Turso HTTP 520 and returns the later result', async () => {
    vi.useFakeTimers();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('LibsqlError: SERVER_ERROR: Server returned HTTP status 520'))
      .mockResolvedValueOnce('ok');

    const result = retryTransientTurso(operation);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not retry non-gateway errors', async () => {
    const error = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed');
    await expect(retryTransientTurso(() => Promise.reject(error))).rejects.toBe(error);
  });

  it('recognises the error reported by Sentry', () => {
    expect(isTransientTursoGatewayError('Server returned HTTP status 520')).toBe(true);
  });
});
