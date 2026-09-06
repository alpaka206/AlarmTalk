import type { MiddlewareHandler } from 'hono';

function cacheControl(directive: string, vary?: string): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (c.res.status < 300) {
      c.res.headers.set('Cache-Control', directive);
      if (vary) {
        c.res.headers.set('Vary', vary);
      }
    }
  };
}

export const publicCache: MiddlewareHandler = cacheControl(
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=600',
);

export const privateCache: MiddlewareHandler = cacheControl(
  'private, max-age=30, stale-while-revalidate=60',
  'Authorization',
);

export const noStore: MiddlewareHandler = cacheControl('no-store');
