import type { Env } from '../types';

/**
 * Sign in with Apple **토큰 폐기**.
 *
 * ⚠ **이건 선택 기능이 아니다.** 애플 심사 지침 5.1.1(v) 는 계정 삭제를 제공하는 앱이
 * Sign in with Apple 로 만든 연결도 함께 끊도록 요구한다. 안 끊으면 탈퇴한 사용자의
 * 기기 '설정 → Apple 계정 → 암호 및 보안 → Apple로 로그인' 목록에 우리 앱이 **영원히
 * 남는다** — 사용자는 지웠다고 믿는데 연결은 살아 있고, 심사에서 반려된다.
 *
 * ⚠ **로그인 검증과 달리 여기는 `.p8` 개인키가 필요하다.** 로그인은 애플의 공개키(JWKS)로
 * 서명만 확인하면 끝이라 비밀이 없어도 되지만, 폐기는 우리가 **우리임을 증명하고**
 * 애플에 요청하는 것이라 client_secret(ES256 서명 JWT)을 만들어야 한다.
 *
 * ⚠ **env 이름을 `APPLE_KEY_ID`/`APPLE_PRIVATE_KEY` 로 하지 말 것.** 그 둘은 이미
 * **App Store Server API(결제 검증)** 가 쓰는 *다른 키*다(`apple-storekit.ts`). 같은
 * 이름에 로그인 키를 넣으면 애플 결제 검증이 통째로 죽는다 — 그래서 `APPLE_SIGNIN_*`
 * 으로 갈라 둔다.
 */

const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

export interface AppleSignInSecretConfig {
  teamId: string;
  keyId: string;
  /** `.p8` 파일 **내용**(PEM). ⚠ 파일 경로가 아니다 — Workers 에는 파일시스템이 없다. */
  privateKeyPem: string;
  /** client_id. 네이티브는 App ID, 웹은 Services ID. */
  clientId: string;
}

export function appleSignInConfig(
  env: Env,
  clientId: string | undefined,
): AppleSignInSecretConfig | null {
  if (!env.APPLE_TEAM_ID || !env.APPLE_SIGNIN_KEY_ID || !env.APPLE_SIGNIN_PRIVATE_KEY) return null;
  if (!clientId) return null;
  return {
    teamId: env.APPLE_TEAM_ID,
    keyId: env.APPLE_SIGNIN_KEY_ID,
    privateKeyPem: env.APPLE_SIGNIN_PRIVATE_KEY,
    clientId,
  };
}

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * client_secret 을 만든다. 애플 규격: alg=ES256, kid=<Key ID>, iss=<Team ID>,
 * aud='https://appleid.apple.com', sub=<client_id>, exp 최대 6개월.
 *
 * 수명을 **10분**으로 짧게 둔다 — 요청마다 새로 만들면 되고, 긴 수명은 유출됐을 때
 * 그만큼 오래 쓰인다.
 */
export async function signAppleClientSecret(
  config: AppleSignInSecretConfig,
  nowMs: number = Date.now(),
): Promise<string> {
  const now = Math.floor(nowMs / 1000);
  const header = { alg: 'ES256', kid: config.keyId, typ: 'JWT' };
  const payload = {
    iss: config.teamId,
    iat: now,
    exp: now + 10 * 60,
    aud: 'https://appleid.apple.com',
    sub: config.clientId,
  };
  const data = `${b64url(new TextEncoder().encode(JSON.stringify(header)))}.${b64url(
    new TextEncoder().encode(JSON.stringify(payload)),
  )}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(config.privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(data),
  );
  return `${data}.${b64url(sig)}`;
}

/**
 * 앱이 준 `authorization_code` 를 **refresh token** 으로 바꾼다.
 *
 * 이 토큰 하나를 저장해 두는 이유는 탈퇴 때 폐기하기 위해서다 — 애플의 `/auth/revoke` 는
 * 폐기할 토큰을 요구하는데, 로그인 시점의 `id_token` 으로는 못 한다.
 *
 * ⚠ **authorization_code 는 5분·1회용**이다. 로그인 요청에서 곧바로 교환해야 하고,
 * 나중에 쓰려고 저장해 두면 그때는 이미 죽어 있다.
 */
export async function exchangeAppleAuthorizationCode(
  config: AppleSignInSecretConfig,
  authorizationCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ refreshToken: string | null }> {
  const clientSecret = await signAppleClientSecret(config);
  const res = await fetchImpl(APPLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Apple token exchange failed: ${res.status}`);
  }
  const json = (await res.json()) as { refresh_token?: string };
  return { refreshToken: json.refresh_token ?? null };
}

/**
 * 연결을 끊는다. 애플은 성공 시 **본문 없는 200** 을 준다.
 *
 * 이미 폐기됐거나 만료된 토큰에 대해서도 애플은 200 을 주므로, 재시도해도 안전하다.
 */
export async function revokeAppleToken(
  config: AppleSignInSecretConfig,
  token: string,
  tokenTypeHint: 'refresh_token' | 'access_token' = 'refresh_token',
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const clientSecret = await signAppleClientSecret(config);
  const res = await fetchImpl(APPLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: tokenTypeHint,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Apple token revoke failed: ${res.status}`);
  }
}
