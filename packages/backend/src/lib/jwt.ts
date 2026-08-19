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
// 365일. 7일 → 90일 → 365일로 늘려 왔다. 알람 앱은 **앱을 안 열어도 잘 돌아가는** 게
// 정상이라(알람은 기기의 AlarmManager / AlarmKit 이 울린다) 몇 달씩 안 여는 사용자가
// 흔하다. 그 사이 토큰이 죽으면 다음에 열었을 때 조용히 로그아웃돼 있고, 1.2.1 부터는
// 그게 알람 목록·재예약의 소유자 게이트에 걸려 **알람이 사라지고 울리지도 않는** 상태가
// 된다. 목표는 "한 번 로그인하면 다시 안 해도 되는 것" 이다.
//
// **만료를 아예 없애지는 않는다.** 무한 토큰은 유출됐을 때 시간으로 끊을 방법이 사라지고,
// 서명 시크릿을 돌리는 것 말고는 손쓸 데가 없어진다(그건 전원 로그아웃이다). 대신 두
// 장치로 "사실상 무기한" 을 만든다:
//   1. **rolling refresh** — `GET /auth/me` 가 매번 새 토큰을 내려 준다.
//   2. **백그라운드 갱신** — 만료가 가까우면 주기 동기화가 앱을 열지 않아도 갱신한다
//      (안드로이드 `RemoteAlarmSyncWorker`, iOS `BackgroundSyncTask`). 이게 없던 시절엔
//      갱신이 '앱을 여는 것' 에만 걸려 있어, 1년 안 여는 사용자에게는 무의미했다.
// 즉 **1년에 한 번이라도 네트워크에 붙는 기기**는 만료를 만나지 않는다.
//
// 길게 잡아도 폐기 수단은 그대로다 — users.token_epoch 가 로그아웃(전 기기)·비밀번호
// 재설정에서 +1 되고 authMiddleware 가 매 요청 비교하므로, 만료를 기다리지 않고 즉시
// 끊을 수 있다.
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 365;

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
