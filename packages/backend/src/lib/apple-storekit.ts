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
  /// 구매 시 클라가 실은 앱 계정 식별자(UUID). 구글의 `obfuscatedExternalAccountId` 짝이다.
  /// ⚠ **이 필드를 읽지 않으면 결제를 계정에 묶을 수 없다** — 끝내지 않은 트랜잭션이
  /// 다른 계정 세션에서 재전달되면 그 계정이 선점한다(2026-08-18 Codex #697 P1).
  appAccountToken?: string;
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
 * 이 상태 코드가 **"그 환경이 우리에게 안 열려 있다"** 인가.
 *
 * ⚠ 이게 없으면 **출시 전·심사 중에 애플 재조회가 통째로 죽는다.** 앱이 아직 프로덕션에
 * 없으면 프로덕션 호스트는 404 가 아니라 **401** 을 준다(2026-08-10 실측: production 401 /
 * sandbox 400 `Invalid transaction id` — 샌드박스는 인증을 통과했다는 뜻이다).
 * 401 에서 바로 throw 하면 **샌드박스에 도달조차 못 해서**, TestFlight·심사 빌드가 만든
 * 샌드박스 구독을 영영 확인할 수 없다 — `docs/spec/billing-lifecycle.md` 가 경고한
 * "프로덕션만 보면 심사에서 떨어진다" 가 정확히 이 경로다.
 */
function isEnvironmentClosed(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * 어느 환경도 열리지 않았으면 **NotFound 가 아니라 오류로** 끝낸다.
 *
 * ⚠ 이 구분이 핵심이다. `AppleTransactionNotFoundError` 를 호출부
 * (`billing-cancel.ts` 의 `reconcileAppleBeforeExpiry`)는 **"애플도 모르는 구독" = 즉시
 * `expire`** 로 읽는다. 자격증명이 깨졌거나 키가 만료됐을 때 그 길로 흘리면, 돈을 내고
 * 있는 애플 구독자가 **전원 한 번에 무료로 강등된다.** 일반 오류로 던지면 같은 호출부가
 * `skip`(다음 크론 재시도)으로 처리한다 — fail-closed 다.
 */
function assertNoAuthFailure(authFailure: number | null, what: string): void {
  if (authFailure !== null) {
    throw new Error(`Apple ${what} lookup: no environment authorized (${authFailure})`);
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

  let authFailure: number | null = null;
  for (const base of [PRODUCTION_BASE, SANDBOX_BASE]) {
    const res = await fetchImpl(`${base}${path}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (res.status === 404) continue; // 다음 환경에서 다시 본다
    if (isEnvironmentClosed(res.status)) {
      authFailure = res.status;
      continue; // 이 환경은 우리에게 안 열려 있다 — 다음 환경을 본다
    }
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
  // ⚠ 401 을 "없음" 으로 흘리면 안 된다 — 호출부가 NotFound 를 **즉시 만료**로 읽는다.
  assertNoAuthFailure(authFailure, 'transaction');
  throw new AppleTransactionNotFoundError();
}

/** 애플이 돌려주는 구독 상태 코드. 1·2·3·4 만 쓰이고 나머지는 없다. */
export const APPLE_SUBSCRIPTION_STATUS = {
  ACTIVE: 1,
  EXPIRED: 2,
  /** 결제 실패 후 재시도 중(billing retry). 아직 만료가 아니다. */
  IN_BILLING_RETRY: 3,
  /** 가격 인상 동의 대기. 아직 유효하다. */
  IN_GRACE_PERIOD: 4,
} as const;

export interface AppleSubscriptionStatus {
  /** `APPLE_SUBSCRIPTION_STATUS` 중 하나. */
  status: number;
  /** 가장 최근 갱신 트랜잭션의 만료 시각(ms). 없으면 조회 실패로 본다. */
  expiresDate?: number;
  productId: string;
  /** 자동 갱신이 켜져 있나(0/1). 사용자가 스토어에서 껐으면 0. */
  autoRenewStatus?: number;
}

/**
 * **구독의 현재 상태**를 애플에 묻는다 — 만료 재조회(reconciliation)용.
 *
 * ⚠ `fetchAppleTransaction` 으로는 이걸 못 한다. 자동갱신 구독은 **갱신마다 트랜잭션
 * ID 가 바뀌는데** 우리가 저장한 건 `originalTransactionId`(수명 동안 고정)라, 그걸로
 * 개별 트랜잭션을 조회하면 **첫 결제의 만료일**만 돌아온다. 그러면 갱신을 영영 못 본다.
 * 이 엔드포인트(`/subscriptions/{id}`)는 구독의 **어떤** 트랜잭션 ID 로도 조회되고
 * 최신 갱신 정보를 준다 — 구글의 `getPlaySubscriptionV2` 와 같은 역할이다.
 *
 * 프로덕션에 없으면 샌드박스를 한 번 더 본다(`fetchAppleTransaction` 과 같은 이유).
 */
export async function fetchAppleSubscriptionStatus(
  originalTransactionId: string,
  config: AppleStoreKitConfig,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<AppleSubscriptionStatus> {
  const jwt = await signAppStoreServerJwt(config, nowMs);
  const path = `/subscriptions/${encodeURIComponent(originalTransactionId)}`;

  let authFailure: number | null = null;
  for (const base of [PRODUCTION_BASE, SANDBOX_BASE]) {
    const res = await fetchImpl(`${base}${path}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (res.status === 404) continue;
    if (isEnvironmentClosed(res.status)) {
      authFailure = res.status;
      continue; // 출시 전 프로덕션이 여기 걸린다 — 샌드박스를 마저 본다
    }
    if (!res.ok) throw new Error(`Apple subscription status lookup failed (${res.status})`);

    const body = (await res.json()) as {
      bundleId?: string;
      data?: Array<{
        lastTransactions?: Array<{
          originalTransactionId?: string;
          status?: number;
          signedTransactionInfo?: string;
          signedRenewalInfo?: string;
        }>;
      }>;
    };

    // 다른 앱의 구독이 우리 것으로 들어오면 안 된다(`fetchAppleTransaction` 과 같은 규칙).
    if (body.bundleId && body.bundleId !== config.bundleId) {
      throw new Error('Apple subscription bundle id mismatch');
    }

    // `data` 는 구독 그룹별 배열이고 `lastTransactions` 는 그룹 안의 구독들이다.
    // 우리가 물은 originalTransactionId 와 일치하는 항목만 본다 — 같은 그룹의 다른
    // 구독(예: 개인 → 가족으로 갈아탄 흔적)을 집으면 엉뚱한 만료일을 쓰게 된다.
    const entry = (body.data ?? [])
      .flatMap((group) => group.lastTransactions ?? [])
      .find((t) => t.originalTransactionId === originalTransactionId);
    if (!entry) continue;

    if (!entry.signedTransactionInfo) throw new Error('Apple response missing signedTransactionInfo');
    const info = decodeAppleJws<AppleTransactionInfo>(entry.signedTransactionInfo);
    if (info.bundleId !== config.bundleId) {
      throw new Error('Apple subscription bundle id mismatch');
    }
    const renewal = entry.signedRenewalInfo
      ? decodeAppleJws<{ autoRenewStatus?: number }>(entry.signedRenewalInfo)
      : undefined;

    return {
      status: Number(entry.status ?? APPLE_SUBSCRIPTION_STATUS.EXPIRED),
      expiresDate: info.expiresDate,
      productId: info.productId,
      autoRenewStatus: renewal?.autoRenewStatus,
    };
  }
  // ⚠ 401 을 "없음" 으로 흘리면 재조회가 **즉시 만료**로 떨어진다 — 위 헬퍼 주석 참조.
  assertNoAuthFailure(authFailure, 'subscription status');
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
  'com.alarmtalk.app.personal_monthly': 'personal',
  'com.alarmtalk.app.couple_monthly': 'couple',
  'com.alarmtalk.app.family_monthly': 'family',
  // ⚠ **선물 상품은 구독이 아니라 소모성(consumable)이다.** 자동 갱신 구독은 남에게
  // 줄 수 없어서(스토어가 구매자 계정에 묶는다), 선물은 1회성 상품을 팔고 그 대금으로
  // **바우처 코드**를 발급한다. 그래서 이 상품의 결제는 구독 갈래를 타면 안 된다 —
  // `isAppleGiftProductId` 로 갈라 `billing-apple.ts` 가 바우처를 만든다.
  'com.alarmtalk.app.personal_gift_1m': 'personal',
};

/** 선물용 1회성 상품 ID. 구독 갈래로 새면 구매자 본인이 이용권을 받게 된다. */
const APPLE_GIFT_PRODUCT_IDS = new Set<string>([
  'com.alarmtalk.app.personal_gift_1m',
]);

export function isAppleGiftProductId(productId: string): boolean {
  return APPLE_GIFT_PRODUCT_IDS.has(productId);
}

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
