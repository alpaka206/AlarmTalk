import type { Context } from 'hono';
import type { SentryClient } from '../types';

export function logStructured(
  level: 'info' | 'warn' | 'error',
  data: Record<string, unknown>,
): void {
  const entry = { level, ...data };
  // eslint-disable-next-line no-console
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
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

  console.error(JSON.stringify(entry));

  const sentry = c.get('sentry') as SentryClient | undefined;
  if (sentry) {
    // 관리자가 Sentry 에서 '어디서/무엇' 에러인지 필터·식별할 수 있도록 위치 태그를 붙인다.
    // toucan-js(Toucan extends Scope)는 setTag/setTags 를 제공하지만, 테스트 목 등 일부
    // 구현체는 captureException 만 있으므로 옵셔널 체이닝으로 안전하게 호출한다.
    sentry.setTags?.({ route: c.req.path, method: c.req.method });
    if (uid) sentry.setTag?.('uid', uid);
    sentry.captureException(err);
  }

  // 이 요청은 **스택까지 붙여** 이미 보고했다. errorCode 미들웨어가 나가는 5xx 를 보고
  // 한 번 더 올리지 않도록 표시해 둔다 — 같은 사고가 Sentry 에 둘로 보이면 세는 게 틀어진다.
  c.set('errorReported', true);
}
