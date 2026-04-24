import { createMiddleware } from 'hono/factory';
import { Toucan } from 'toucan-js';
import type { AppEnv } from '../types';

export const sentryMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const dsn = c.env.SENTRY_DSN;
  if (!dsn) {
    await next();
    return;
  }

  const sentry = new Toucan({
    dsn,
    request: c.req.raw,
    context: c.executionCtx,
    environment: c.env.ENVIRONMENT || 'production',
  });

  c.set('sentry', sentry);

  try {
    await next();
  } catch (err) {
    sentry.captureException(err);
    throw err;
  }
});
