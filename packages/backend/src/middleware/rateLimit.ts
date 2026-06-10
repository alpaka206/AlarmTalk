/**
 * 슬라이딩 윈도(60초/60req) 레이트리밋 미들웨어.
 *
 * 인증된 요청은 userId, 비인증 요청은 클라이언트 IP를 키로 카운트한다.
 *
 * 주의(보안): IP 키는 반드시 Cloudflare가 부여하는 `cf-connecting-ip` 만 신뢰한다.
 * `x-forwarded-for` 는 클라이언트가 위조할 수 있어, 이를 키로 쓰면 헤더를 바꿔가며
 * 무제한 우회가 가능하다(특히 /auth/login·register 같은 비인증 엔드포인트의
 * 무차별 대입 방어가 무력화됨).
 *
 * 한계: 카운트 저장소가 isolate 단위 in-memory 라, 여러 isolate에 분산되면
 * 실제 한도는 isolate 수만큼 느슨해진다. 엄격한 전역 한도가 필요하면
 * Durable Objects / KV 로 이전해야 한다. (docs 의 backend findings 참고)
 */
import type { Context, Next } from 'hono';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const CLEANUP_INTERVAL = 300_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

function getKey(c: Context): string {
  const userId = c.get('userId') as string | undefined;
  if (userId) return `u:${userId}`;
  // 위조 불가능한 cf-connecting-ip 만 사용(x-forwarded-for 는 신뢰하지 않음).
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  return `ip:${ip}`;
}

export async function rateLimitMiddleware(c: Context, next: Next) {
  cleanup();

  const key = getKey(c);
  const now = Date.now();
  let entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(key, entry);
  }

  entry.count++;

  const remaining = Math.max(0, MAX_REQUESTS - entry.count);
  c.header('X-RateLimit-Limit', String(MAX_REQUESTS));
  c.header('X-RateLimit-Remaining', String(remaining));
  c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Too many requests', retryAfter }, 429);
  }

  await next();
}
