/**
 * Google 서비스 계정 OAuth2 (JWT Bearer flow).
 *
 * FCM HTTP v1 푸시와 Play Developer API(결제 검증)가 공유한다.
 * crypto.subtle 만 사용 (Workers 호환, 외부 의존성 없음).
 *
 * 토큰은 scope 별로 모듈 레벨에 캐싱한다. Workers isolate 가 살아있는 동안만
 * 유지되는 best-effort 캐시이며, 만료 60초 전에 갱신한다.
 */

export interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
}

interface CachedToken {
  accessToken: string;
  expiresAtMillis: number;
}

const tokenCache = new Map<string, CachedToken>();

export function parseServiceAccountJson(raw: string | undefined): GoogleServiceAccount | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GoogleServiceAccount>;
    if (typeof parsed.client_email === 'string' && typeof parsed.private_key === 'string') {
      return { client_email: parsed.client_email, private_key: parsed.private_key };
    }
    return null;
  } catch {
    return null;
  }
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PEM PKCS8 개인키 → CryptoKey (RS256 서명용). */
async function importPkcs8Key(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function signServiceAccountJwt(
  account: GoogleServiceAccount,
  scope: string,
  nowMillis: number,
): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const issuedAt = Math.floor(nowMillis / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: account.client_email,
      scope,
      aud: 'https://oauth2.googleapis.com/token',
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importPkcs8Key(account.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * 서비스 계정으로 scope 에 대한 access token 을 발급/캐시 반환한다.
 * 실패 시 throw — 호출자가 graceful degradation 을 결정한다.
 */
export async function getGoogleAccessToken(
  account: GoogleServiceAccount,
  scope: string,
): Promise<string> {
  const cacheKey = `${account.client_email}:${scope}`;
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMillis - 60_000 > now) {
    return cached.accessToken;
  }

  const assertion = await signServiceAccountJwt(account, scope, now);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google OAuth token error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error('Google OAuth token response missing access_token');
  }
  tokenCache.set(cacheKey, {
    accessToken: json.access_token,
    expiresAtMillis: now + (json.expires_in ?? 3600) * 1000,
  });
  return json.access_token;
}
