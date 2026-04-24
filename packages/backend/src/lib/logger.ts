import type { Context } from 'hono';
import type { SentryClient } from '../types';

export function logStructured(level: 'info' | 'warn' | 'error', data: Record<string, unknown>): void {
  const entry = { level, ...data };
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  // eslint-disable-next-line no-console
  fn(JSON.stringify(entry));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono Context is invariant on Env; this accepts both pre-auth and post-auth contexts
export function logRouteError(c: Context<any>, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 5).join(' | ') : undefined;

  const entry: Record<string, unknown> = {
    level: 'error',
    method: c.req.method,
    path: c.req.path,
    error: message,
  };

  const uid = c.get('userId') as string | undefined;
  if (uid) entry.uid = uid;
  if (stack) entry.stack = stack;

  // eslint-disable-next-line no-console
  console.error(JSON.stringify(entry));

  const sentry = c.get('sentry') as SentryClient | undefined;
  if (sentry) sentry.captureException(err);
}
