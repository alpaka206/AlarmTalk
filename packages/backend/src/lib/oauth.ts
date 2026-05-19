export interface ExternalTokenPayload {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  iss: string;
  aud: string;
  exp: number;
  nonce?: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

type AppleJwk = JsonWebKey & { kid?: string };

interface JwksResponse {
  keys?: AppleJwk[];
}

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_JWKS_CACHE_MS = 6 * 60 * 60 * 1000;

let appleJwksCache: { keys: AppleJwk[]; expiresAt: number } | null = null;

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return atob(padded);
}

function decodeBase64UrlBytes(value: string): Uint8Array {
  const binary = decodeBase64Url(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function decodeJwtPayload(token: string): ExternalTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  return JSON.parse(decodeBase64Url(parts[1]!));
}

function decodeJwtHeader(token: string): JwtHeader {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  return JSON.parse(decodeBase64Url(parts[0]!));
}

async function fetchAppleJwks(forceRefresh = false): Promise<AppleJwk[]> {
  const now = Date.now();
  if (!forceRefresh && appleJwksCache && appleJwksCache.expiresAt > now) {
    return appleJwksCache.keys;
  }

  const res = await fetch(APPLE_JWKS_URL);
  if (!res.ok) throw new Error('Apple JWKS fetch failed');

  const body = (await res.json()) as JwksResponse;
  if (!Array.isArray(body.keys)) {
    throw new Error('Apple JWKS response malformed');
  }

  appleJwksCache = {
    keys: body.keys,
    expiresAt: now + APPLE_JWKS_CACHE_MS,
  };
  return body.keys;
}

async function findAppleJwk(kid: string): Promise<AppleJwk> {
  let keys = await fetchAppleJwks();
  let key = keys.find((candidate) => candidate.kid === kid);
  if (!key) {
    keys = await fetchAppleJwks(true);
    key = keys.find((candidate) => candidate.kid === kid);
  }
  if (!key) throw new Error('Apple token signing key not found');
  return key;
}

async function verifyAppleSignature(idToken: string, header: JwtHeader): Promise<void> {
  if (header.alg !== 'RS256') {
    throw new Error('Apple token algorithm unsupported');
  }
  if (!header.kid) {
    throw new Error('Apple token key id missing');
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const jwk = await findAppleJwk(header.kid);
  const key = await crypto.subtle.importKey(
    'jwk',
    { ...jwk, alg: 'RS256', ext: true, key_ops: ['verify'] },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const verified = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    decodeBase64UrlBytes(parts[2]!),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );

  if (!verified) {
    throw new Error('Apple token signature invalid');
  }
}

export async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string,
): Promise<ExternalTokenPayload> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
  if (!res.ok) throw new Error('Google token verification failed');

  const payload = (await res.json()) as ExternalTokenPayload & { exp: number | string };

  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') {
    throw new Error('Invalid Google token issuer');
  }
  if (expectedClientId && payload.aud !== expectedClientId) {
    throw new Error('Token audience mismatch');
  }
  if (Number(payload.exp) < Date.now() / 1000) {
    throw new Error('Token expired');
  }

  return { ...payload, exp: Number(payload.exp) };
}

export async function verifyAppleIdToken(
  idToken: string,
  expectedClientId?: string,
  expectedNonceHash?: string,
): Promise<ExternalTokenPayload> {
  const header = decodeJwtHeader(idToken);
  await verifyAppleSignature(idToken, header);

  const payload = decodeJwtPayload(idToken);

  if (payload.iss !== 'https://appleid.apple.com') {
    throw new Error('Invalid Apple token issuer');
  }
  if (expectedClientId && payload.aud !== expectedClientId) {
    throw new Error('Apple token audience mismatch');
  }
  if (Number(payload.exp) < Date.now() / 1000) {
    throw new Error('Apple token expired');
  }

  // nonce 검증 — Apple 가이드: 클라이언트가 raw nonce 의 SHA256 해시를
  // ASAuthorizationAppleIDRequest.nonce 로 설정하면 발급된 id_token 의
  // nonce 클레임에 동일한 해시가 들어온다. 서버는 클라이언트가 함께 보낸
  // raw nonce 를 다시 해싱해 비교한다. expectedNonceHash 가 명시적으로
  // 전달된 경우에만 검증을 수행하고, 미전달 시(레거시/middleware 경로)
  // 검증을 건너뛰되 경고 로그를 남긴다.
  if (expectedNonceHash !== undefined) {
    if (typeof payload.nonce !== 'string' || payload.nonce !== expectedNonceHash) {
      throw new Error('Apple token nonce mismatch');
    }
  } else {
    console.warn('[oauth] apple token verified without nonce check');
  }

  return { ...payload, exp: Number(payload.exp) };
}
