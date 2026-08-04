export interface AppJwtPayload {
  sub: string;
  email: string;
  name?: string;
  // 토큰 세대(epoch). 발급 시 users.token_epoch 를 박아 넣고, authMiddleware 가
  // 현재 users.token_epoch 와 비교해 더 낮으면 폐기(TOKEN_REVOKED)된 것으로 본다.
  // 클레임이 없는 토큰(레거시)은 0 으로 간주한다.
  epoch?: number;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

const ISSUER = 'voice-alarm';
const AUDIENCE = 'voice-alarm-clients';
const ALG = 'HS256';
// 90일. 예전에는 7일이었는데, 알람 앱은 **앱을 안 열어도 잘 돌아가는** 게 정상이라
// (알람은 기기의 AlarmManager 가 울린다) 몇 주씩 안 여는 사용자가 흔하다. 그 사이 토큰이
// 죽으면 다음에 열었을 때 조용히 로그아웃돼 있고, 1.2.1 부터는 그게 알람 목록·재예약의
// 소유자 게이트에 걸려 **알람이 사라지고 울리지도 않는** 상태가 된다.
//
// 길게 잡아도 폐기 수단은 그대로다 — users.token_epoch 가 로그아웃(전 기기)·비밀번호
// 재설정에서 +1 되고 authMiddleware 가 매 요청 비교하므로, 만료를 기다리지 않고 즉시 끊을
// 수 있다. 그리고 GET /auth/me 가 열 때마다 새 토큰을 내려 주므로(rolling), 90일 안에 한
// 번이라도 앱을 연 사용자는 사실상 만료를 만나지 않는다.
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 90;

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeString(s: string): string {
  return base64UrlEncode(new TextEncoder().encode(s));
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

export async function signAppJwt(
  payload: { sub: string; email: string; name?: string; epoch?: number },
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  if (!secret) throw new Error('JWT_SECRET is required');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: ALG, typ: 'JWT' };
  const body: AppJwtPayload = {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    epoch: payload.epoch ?? 0,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + ttlSeconds,
  };

  const headerPart = base64UrlEncodeString(JSON.stringify(header));
  const payloadPart = base64UrlEncodeString(JSON.stringify(body));
  const data = `${headerPart}.${payloadPart}`;
  const key = await getKey(secret, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${base64UrlEncode(sig)}`;
}

export async function verifyAppJwt(token: string, secret: string): Promise<AppJwtPayload> {
  if (!secret) throw new Error('JWT_SECRET is required');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [headerPart, payloadPart, sigPart] = parts as [string, string, string];

  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart))) as {
    alg?: string;
  };
  if (header.alg !== ALG) throw new Error('Unsupported algorithm');

  const key = await getKey(secret, 'verify');
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlDecode(sigPart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new Error('Signature verification failed');

  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(payloadPart)),
  ) as AppJwtPayload;

  if (payload.iss !== ISSUER) throw new Error('Invalid issuer');
  if (payload.aud !== AUDIENCE) throw new Error('Token audience mismatch');
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');

  // epoch 클레임이 없는(레거시) 토큰은 0 으로 정규화해 호출자가 항상 숫자를 받게 한다.
  payload.epoch = typeof payload.epoch === 'number' ? payload.epoch : 0;

  return payload;
}

export const APP_JWT_ISSUER = ISSUER;
export const APP_JWT_AUDIENCE = AUDIENCE;
