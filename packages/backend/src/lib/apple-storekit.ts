// Apple 결제(StoreKit 2) 서버 검증 — App Store Server API.
//
// 왜 이 방식인가:
//   클라가 보내는 StoreKit 2 서명 트랜잭션(JWS)을 서버가 **직접** 검증하려면 x5c 인증서
//   체인을 Apple Root CA 까지 타고 올라가며 ASN.1/X.509 를 손으로 파싱해야 한다. 그건
//   이 레포에 넣기엔 과한 코드고, 게다가 시뮬레이터 로컬 StoreKit 테스트는 애플 루트가
//   아니라 **로컬 테스트 인증서**로 서명하므로 어차피 체인 검증이 통과하지 않는다.
//
//   그래서 애플이 권장하는 경로를 쓴다: 클라는 `Transaction.id` 만 보내고, 서버가
//   App Store Server API 로 **애플에 직접 물어본다**. 응답은 우리가 인증한 TLS 연결로
//   애플에서 온 것이라 그 자체가 권위다(구글 경로가 Play Developer API 를 믿는 것과 같다).
//   클라가 보낸 값 중 신뢰하는 것은 transaction id 문자열 하나뿐이고, 그것도 애플에
//   되물어서 확인한다 — 위조해도 애플이 모르는 id 면 404 다.
//
// 필요한 값(전부 App Store Connect 에서 발급, 계정 없으면 못 만든다):
//   APPLE_ISSUER_ID  · APPLE_KEY_ID · APPLE_PRIVATE_KEY(.p8 PEM) · APPLE_BUNDLE_ID
// 미설정이면 라우트가 503 으로 fail-closed 된다(구글 결제 경로와 동일한 규약).

const PRODUCTION_BASE = 'https://api.storekit.itunes.apple.com/inApps/v1';
const SANDBOX_BASE = 'https://api.storekit-sandbox.itunes.apple.com/inApps/v1';
const AUDIENCE = 'appstoreconnect-v1';

export interface AppleStoreKitConfig {
  issuerId: string;
  keyId: string;
  /** .p8 파일 내용 (PEM, `-----BEGIN PRIVATE KEY-----` 포함). */
  privateKeyPem: string;
  bundleId: string;
}

/** App Store Server API 의 JWSTransactionDecodedPayload 중 우리가 쓰는 필드. */
export interface AppleTransactionInfo {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  purchaseDate: number;
  expiresDate?: number;
  type: string;
  revocationDate?: number;
  environment?: string;
}

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** PEM(.p8) → PKCS#8 DER 바이트. */
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
 * App Store Server API 호출용 JWT(ES256) 를 만든다.
 * 애플 규격: alg=ES256, kid=<Key ID>, iss=<Issuer ID>, aud='appstoreconnect-v1',
 * bid=<bundle id>, exp 는 최대 60분(여유 있게 20분으로 둔다).
 */
export async function signAppStoreServerJwt(
  config: AppleStoreKitConfig,
  nowMs: number = Date.now(),
): Promise<string> {
  const now = Math.floor(nowMs / 1000);
  const header = { alg: 'ES256', kid: config.keyId, typ: 'JWT' };
  const payload = {
    iss: config.issuerId,
    iat: now,
    exp: now + 20 * 60,
    aud: AUDIENCE,
    bid: config.bundleId,
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
 * 애플이 돌려준 JWS 의 payload 를 읽는다.
 *
 * ⚠ 서명을 검증하지 **않는다.** 검증이 필요 없는 이유는 이 JWS 가 클라이언트가 아니라
 * **우리가 인증하고 호출한 애플 API 의 TLS 응답**으로 왔기 때문이다. 클라가 보낸 JWS 를
 * 이 함수로 읽으면 안 된다 — 그건 서명 검증 없이 사용자 입력을 믿는 것이다.
 */
function decodeAppleJws<T>(jws: string): T {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('Malformed Apple JWS');
  return JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]!))) as T;
}

export class AppleTransactionNotFoundError extends Error {
  constructor() {
    super('Apple transaction not found');
    this.name = 'AppleTransactionNotFoundError';
  }
}

/**
 * transactionId 로 애플에 트랜잭션을 조회한다.
 *
 * 프로덕션에 없으면 샌드박스를 한 번 더 본다 — 애플 권장 순서다. 심사 중인 앱과
 * TestFlight 빌드는 샌드박스 트랜잭션을 만들기 때문에, 프로덕션만 보면 심사에서 떨어진다.
 */
export async function fetchAppleTransaction(
  transactionId: string,
  config: AppleStoreKitConfig,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<AppleTransactionInfo> {
  const jwt = await signAppStoreServerJwt(config, nowMs);
  const path = `/transactions/${encodeURIComponent(transactionId)}`;

  for (const base of [PRODUCTION_BASE, SANDBOX_BASE]) {
    const res = await fetchImpl(`${base}${path}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (res.status === 404) continue; // 다음 환경에서 다시 본다
    if (!res.ok) {
      throw new Error(`Apple transaction lookup failed (${res.status})`);
    }
    const body = (await res.json()) as { signedTransactionInfo?: string };
    if (!body.signedTransactionInfo) throw new Error('Apple response missing signedTransactionInfo');
    const info = decodeAppleJws<AppleTransactionInfo>(body.signedTransactionInfo);

    // 애플이 준 값이라도 **번들 ID 는 반드시 대조한다.** 다른 앱의 트랜잭션이 우리
    // 구독으로 들어오면 안 된다.
    if (info.bundleId !== config.bundleId) {
      throw new Error('Apple transaction bundle id mismatch');
    }
    return info;
  }
  throw new AppleTransactionNotFoundError();
}

/**
 * App Store Connect 상품 ID → plans.key.
 *
 * 애플 상품 ID 는 전역 유일해야 해서 구글(`personal_monthly`)과 달리 번들 ID 접두사가
 * 붙는다. 이 목록은 `apps/ios-native/AlarmTalk/Configuration/StoreKitConfiguration.storekit`
 * 의 SKU 3개와 **정확히 같아야 한다** — App Store Connect 에 상품을 만들 때도 같은 ID 를 쓴다.
 */
const APPLE_PRODUCT_TO_PLAN_KEY: Record<string, 'personal' | 'couple' | 'family'> = {
  'com.voicealarm.nativeapp.ios.personal_monthly': 'personal',
  'com.voicealarm.nativeapp.ios.couple_monthly': 'couple',
  'com.voicealarm.nativeapp.ios.family_monthly': 'family',
};

export function applePlanKeyFromProductId(
  productId: string,
): 'personal' | 'couple' | 'family' | null {
  return APPLE_PRODUCT_TO_PLAN_KEY[productId] ?? null;
}

export function appleStoreKitConfigFromEnv(env: {
  APPLE_ISSUER_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  APPLE_BUNDLE_ID?: string;
}): AppleStoreKitConfig | null {
  if (!env.APPLE_ISSUER_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY || !env.APPLE_BUNDLE_ID) {
    return null;
  }
  return {
    issuerId: env.APPLE_ISSUER_ID,
    keyId: env.APPLE_KEY_ID,
    privateKeyPem: env.APPLE_PRIVATE_KEY,
    bundleId: env.APPLE_BUNDLE_ID,
  };
}
