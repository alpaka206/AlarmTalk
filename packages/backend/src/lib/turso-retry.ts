const TURSO_RETRY_DELAYS_MS = [150, 450] as const;

/**
 * Turso's HTTP gateway can occasionally return a 520 before a request is
 * accepted. Keep this deliberately narrow: SQL errors and client mistakes
 * must still fail immediately.
 */
export function isTransientTursoGatewayError(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes('HTTP status 520') ||
    (message.includes('SERVER_ERROR') && message.includes('libsql'))
  );
}

/** Retries only Turso gateway failures with a bounded exponential backoff. */
export async function retryTransientTurso<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = TURSO_RETRY_DELAYS_MS[attempt];
      if (!isTransientTursoGatewayError(error) || delay === undefined) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}
