// Sign in with Apple — identity token 검증.
//
// 구글(`oauth.ts`)과 달리 애플에는 tokeninfo 같은 검증 엔드포인트가 없다. 애플이 주는 건
// 공개키 묶음(JWKS)뿐이고, 서명 검증을 **우리가 직접** 해야 한다.
//
// 중요: 네이티브 앱 로그인 플로우는 **비밀키가 필요 없다.** 앱이
// `ASAuthorizationAppleIDCredential.identityToken` 을 그대로 넘겨주면 서버는 애플 공개키로
// 서명만 확인하면 된다. `.p8` 개인키(Service ID / client_secret)는 **웹·서버 대 서버
// 플로우**(authorization code 교환, 토큰 폐기)에서만 쓴다 — 둘을 헷갈리지 말 것.
// 그래서 이 파일은 유료 개발자 계정 없이도 단위 테스트가 가능하다.

export interface AppleTokenPayload {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  nonce?: string;
  nonce_supported?: boolean;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

interface AppleJwk {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n: string;
  e: string;
}

// JWKS 를 매 로그인마다 받아오면 애플에 불필요한 왕복이 생기고 로그인 지연이 커진다.
// 애플은 키를 자주 돌리지 않으므로 짧게 캐시한다. Workers 는 isolate 마다 별도 메모리라
// 전역 캐시가 아니지만, 한 isolate 가 처리하는 연속 로그인에는 충분히 효과가 있다.
//
// ⚠ 캐시는 **성공한 조회만** 담는다. 실패를 캐시하면 애플의 일시적 5xx 가 TTL 동안
// 모든 로그인을 막는다.
let jwksCache: { keys: AppleJwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

export function __resetAppleJwksCacheForTests(): void {
  jwksCache = null;
}

async function fetchAppleJwks(fetchImpl: typeof fetch): Promise<AppleJwk[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetchImpl(APPLE_JWKS_URL);
  if (!res.ok) throw new Error('Apple JWKS fetch failed');
  const body = (await res.json()) as { keys?: AppleJwk[] };
  if (!body.keys || body.keys.length === 0) throw new Error('Apple JWKS is empty');
  jwksCache = { keys: body.keys, fetchedAt: now };
  return body.keys;
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJsonSegment<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment))) as T;
}

/**
 * 애플 identity token 을 검증하고 payload 를 돌려준다.
 *
 * @param identityToken 앱이 넘긴 `identityToken` (JWT)
 * @param expectedAudience 앱 번들 ID. 네이티브 앱 토큰의 `aud` 는 번들 ID 다.
 * @param expectedNonce 앱이 로그인 요청에 넣은 nonce 의 **SHA-256 hex**. 있으면 대조한다.
 */
export async function verifyAppleIdToken(
  identityToken: string,
  expectedAudience: string,
  expectedNonce?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AppleTokenPayload> {
  // fail-closed: 번들 ID 미설정 시 aud 검증을 건너뛰지 않고 명시 실패시킨다.
  // (aud 를 안 보면 **다른 앱용으로 발급된 유효한 애플 토큰**도 통과해, 그 앱 사용자가
  //  우리 계정을 sub 기준으로 차지할 수 있다. 구글 쪽과 같은 이유다.)
  if (!expectedAudience) {
    throw new Error('Apple audience (bundle ID) is not configured');
  }

  const parts = identityToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed Apple identity token');
  const [headerPart, payloadPart, sigPart] = parts as [string, string, string];

  const header = decodeJsonSegment<{ alg?: string; kid?: string }>(headerPart);
  // 알고리즘을 토큰이 스스로 고르게 두면 안 된다(alg=none / HS256 혼동 공격).
  // 애플은 RS256 만 쓴다.
  if (header.alg !== 'RS256') throw new Error('Unexpected Apple token algorithm');
  if (!header.kid) throw new Error('Apple token has no key id');

  const keys = await fetchAppleJwks(fetchImpl);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Apple signing key not found');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(sigPart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new Error('Apple token signature verification failed');

  const payload = decodeJsonSegment<AppleTokenPayload & { exp: number | string }>(payloadPart);

  if (payload.iss !== APPLE_ISSUER) throw new Error('Invalid Apple token issuer');
  // aud 는 문자열 하나이거나 배열일 수 있다.
  const aud = payload.aud as unknown;
  const audOk = Array.isArray(aud) ? aud.includes(expectedAudience) : aud === expectedAudience;
  if (!audOk) throw new Error('Token audience mismatch');
  if (Number(payload.exp) < Date.now() / 1000) throw new Error('Token expired');
  if (!payload.sub) throw new Error('Apple token has no subject');

  // nonce 대조는 **재생 공격 방지**다. 앱이 nonce 를 넣어 보냈다면 반드시 일치해야 한다.
  // (앱은 원본 nonce 를 SHA-256 해서 요청에 넣고, 애플이 그 해시를 토큰에 그대로 담는다.)
  if (expectedNonce !== undefined && payload.nonce !== expectedNonce) {
    throw new Error('Apple token nonce mismatch');
  }

  // 구글과 같은 이유로, 검증되지 않은 이메일은 신뢰하지 않는다 — 다운스트림이 email 로
  // 기존 계정과 연동하므로 계정 탈취 경로가 된다.
  if (
    payload.email !== undefined &&
    payload.email_verified !== true &&
    payload.email_verified !== 'true'
  ) {
    throw new Error('Apple token email not verified');
  }

  return { ...payload, exp: Number(payload.exp) };
}
