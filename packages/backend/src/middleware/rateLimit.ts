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

/**
 * 레이트리밋 미들웨어 팩토리. prefix 로 버킷을 분리하면 동일 키(사용자/IP)에 대해
 * 일반 한도와 별개의 더 엄격한 한도를 독립적으로 걸 수 있다.
 */
export function createRateLimitMiddleware(options?: {
  windowMs?: number;
  maxRequests?: number;
  prefix?: string;
}) {
  const windowMs = options?.windowMs ?? WINDOW_MS;
  const maxRequests = options?.maxRequests ?? MAX_REQUESTS;
  const prefix = options?.prefix ?? '';

  return async function rateLimit(c: Context, next: Next) {
    cleanup();

    const key = `${prefix}${getKey(c)}`;
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    const remaining = Math.max(0, maxRequests - entry.count);
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many requests', retryAfter }, 429);
    }

    await next();
  };
}

/**
 * 전역(인증 전) 버킷 — authMiddleware 이전에 걸리므로 항상 IP 키로 카운트된다.
 * NAT/공유 와이파이 뒤에 여러 기기가 정상적으로 붙으므로(가족 플랜은 이게 기본 상황)
 * 사용자 버킷보다 훨씬 느슨하게 두고, 실제 남용은 아래 사용자 버킷이 조인다.
 * prefix 로 버킷을 분리해 사용자 버킷과 이중 카운트되지 않게 한다 — 과거엔 같은 요청이
 * 전역(IP)·api(사용자) 두 리미터를 통과하며 각각 카운트돼, 같은 IP 의 두 기기가
 * 60req/분을 나눠 쓰다 로그인 burst(동기화+클립 다운로드)에서 429 가 났다.
 */
export const ipRateLimitMiddleware = createRateLimitMiddleware({
  maxRequests: 300,
  prefix: 'pre:',
});

/**
 * 인증 후 사용자 버킷. 로그인 직후 정상 burst(알람 동기화·목소리/구독/스톡 매니페스트
 * 로드·사전렌더 클립 다운로드 21개 등)가 수십 요청이라 60/분은 정상 사용에서도 걸렸다.
 */
export const rateLimitMiddleware = createRateLimitMiddleware({
  maxRequests: 120,
});

/**
 * 인증 엔드포인트(로그인/회원가입/이메일코드/소셜) 전용 엄격 한도. 별도 prefix 버킷이라
 * 일반 60/분 한도와 독립적으로 동작해 무차별 대입(brute-force)을 좁힌다.
 * 정상 다단계 가입 흐름(코드요청→검증→가입)에 여유를 두되 비밀번호 추측은 제한.
 */
export const authRateLimitMiddleware = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 15,
  prefix: 'auth:',
});
