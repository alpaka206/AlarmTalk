// Apple 결제 서버 검증(App Store Server API) 단위 테스트.
//
// 실제 P-256 키쌍을 만들어 서버 JWT 서명 경로를 진짜로 태우고, 애플 API 응답만 목킹한다.
// **유료 계정 없이 전부 검증된다** — 계정에서 오는 값(Issuer ID / Key ID / .p8)은
// 형식만 맞으면 되고, 실제 값은 아침에 채운다.
import { describe, it, expect } from 'vitest';
import {
  signAppStoreServerJwt,
  fetchAppleTransaction,
  applePlanKeyFromProductId,
  appleStoreKitConfigFromEnv,
  AppleTransactionNotFoundError,
  fetchAppleSubscriptionStatus,
  type AppleStoreKitConfig,
} from '../src/lib/apple-storekit';

const BUNDLE_ID = 'com.voicealarm.nativeapp.ios';

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function decodeSeg<T>(seg: string): T {
  const pad = seg.length % 4 === 0 ? '' : '='.repeat(4 - (seg.length % 4));
  const b64 = (seg + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(u8)) as T;
}

let cachedConfig: AppleStoreKitConfig | null = null;
async function makeConfig(): Promise<AppleStoreKitConfig> {
  if (cachedConfig) return cachedConfig;
  const kp = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  cachedConfig = {
    issuerId: '57246542-96fe-1a63-e053-0824d011072a',
    keyId: 'ABC123DEFG',
    privateKeyPem: pem,
    bundleId: BUNDLE_ID,
  };
  return cachedConfig;
}

/** 애플이 돌려주는 signedTransactionInfo 흉내 (서명은 우리가 검증하지 않는다). */
function signedTransactionInfo(payload: Record<string, unknown>): string {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256' })));
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${header}.${body}.c2ln`;
}

function txPayload(over: Record<string, unknown> = {}) {
  return {
    transactionId: '2000000900000001',
    originalTransactionId: '2000000800000001',
    bundleId: BUNDLE_ID,
    productId: 'com.voicealarm.nativeapp.ios.personal_monthly',
    purchaseDate: Date.now() - 1000,
    expiresDate: Date.now() + 30 * 24 * 3600 * 1000,
    type: 'Auto-Renewable Subscription',
    environment: 'Production',
    ...over,
  };
}

describe('signAppStoreServerJwt', () => {
  it('애플 규격대로 헤더·클레임을 채운다', async () => {
    const config = await makeConfig();
    const jwt = await signAppStoreServerJwt(config, 1_700_000_000_000);
    const [h, p] = jwt.split('.') as [string, string, string];
    const header = decodeSeg<{ alg: string; kid: string; typ: string }>(h);
    const payload = decodeSeg<{ iss: string; aud: string; bid: string; exp: number; iat: number }>(p);

    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe(config.keyId);
    expect(payload.iss).toBe(config.issuerId);
    expect(payload.aud).toBe('appstoreconnect-v1');
    expect(payload.bid).toBe(BUNDLE_ID);
    // 애플은 exp 를 최대 60분까지만 허용한다.
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(3600);
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });
});

describe('fetchAppleTransaction', () => {
  it('프로덕션에서 찾으면 그 값을 돌려준다', async () => {
    const config = await makeConfig();
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ signedTransactionInfo: signedTransactionInfo(txPayload()) }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const info = await fetchAppleTransaction('2000000900000001', config, f);
    expect(info.originalTransactionId).toBe('2000000800000001');
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('api.storekit.itunes.apple.com');
  });

  // 심사 중인 앱과 TestFlight 빌드는 샌드박스 트랜잭션을 만든다. 프로덕션만 보면 심사에서 떨어진다.
  it('프로덕션 404 면 샌드박스를 본다', async () => {
    const config = await makeConfig();
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('sandbox')) {
        return new Response(
          JSON.stringify({ signedTransactionInfo: signedTransactionInfo(txPayload()) }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const info = await fetchAppleTransaction('2000000900000001', config, f);
    expect(info.productId).toContain('personal_monthly');
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('sandbox');
  });

  it('양쪽 다 404 면 NotFound 를 던진다', async () => {
    const config = await makeConfig();
    const f = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchAppleTransaction('x', config, f)).rejects.toBeInstanceOf(
      AppleTransactionNotFoundError,
    );
  });

  // 다른 앱의 트랜잭션이 우리 구독으로 들어오면 안 된다.
  it('번들 ID 가 다르면 거부한다', async () => {
    const config = await makeConfig();
    const f = (async () =>
      new Response(
        JSON.stringify({
          signedTransactionInfo: signedTransactionInfo(txPayload({ bundleId: 'com.other.app' })),
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    await expect(fetchAppleTransaction('x', config, f)).rejects.toThrow(/bundle id mismatch/i);
  });

  it('Authorization 헤더에 Bearer JWT 를 싣는다', async () => {
    const config = await makeConfig();
    let auth = '';
    const f = (async (_url: string, init?: RequestInit) => {
      auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      return new Response(
        JSON.stringify({ signedTransactionInfo: signedTransactionInfo(txPayload()) }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    await fetchAppleTransaction('x', config, f);
    expect(auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('5xx 는 조용히 넘기지 않고 던진다', async () => {
    const config = await makeConfig();
    const f = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchAppleTransaction('x', config, f)).rejects.toThrow(/lookup failed/i);
  });
});

describe('applePlanKeyFromProductId', () => {
  // 이 ID 들은 StoreKitConfiguration.storekit 의 SKU 3개와 정확히 같아야 한다.
  it('세 상품을 매핑한다', () => {
    expect(applePlanKeyFromProductId('com.voicealarm.nativeapp.ios.personal_monthly')).toBe('personal');
    expect(applePlanKeyFromProductId('com.voicealarm.nativeapp.ios.couple_monthly')).toBe('couple');
    expect(applePlanKeyFromProductId('com.voicealarm.nativeapp.ios.family_monthly')).toBe('family');
  });

  it('모르는 상품은 null', () => {
    expect(applePlanKeyFromProductId('com.voicealarm.nativeapp.ios.lifetime')).toBeNull();
    // 구글 쪽 짧은 ID 가 애플 경로로 새면 안 된다.
    expect(applePlanKeyFromProductId('personal_monthly')).toBeNull();
  });
});

describe('appleStoreKitConfigFromEnv', () => {
  // 하나라도 빠지면 라우트가 503 fail-closed 돼야 한다 — 물어보지 못한 채 통과시키면
  // 클라 주장을 그대로 믿는 것이 된다.
  it('값이 하나라도 없으면 null', () => {
    expect(appleStoreKitConfigFromEnv({})).toBeNull();
    expect(
      appleStoreKitConfigFromEnv({
        APPLE_ISSUER_ID: 'i',
        APPLE_KEY_ID: 'k',
        APPLE_PRIVATE_KEY: 'p',
      }),
    ).toBeNull();
    expect(
      appleStoreKitConfigFromEnv({ APPLE_ISSUER_ID: 'i', APPLE_KEY_ID: 'k', APPLE_BUNDLE_ID: 'b' }),
    ).toBeNull();
  });

  it('전부 있으면 config', () => {
    const cfg = appleStoreKitConfigFromEnv({
      APPLE_ISSUER_ID: 'i',
      APPLE_KEY_ID: 'k',
      APPLE_PRIVATE_KEY: 'p',
      APPLE_BUNDLE_ID: 'b',
    });
    expect(cfg).toEqual({ issuerId: 'i', keyId: 'k', privateKeyPem: 'p', bundleId: 'b' });
  });
});

// ---------------------------------------------------------------------------
// fetchAppleSubscriptionStatus — 만료 재조회의 근거
//
// ⚠ `fetchAppleTransaction` 으로는 이걸 못 한다. 자동갱신 구독은 갱신마다 트랜잭션 ID 가
// 바뀌는데 우리가 저장한 건 originalTransactionId 라, 개별 트랜잭션 조회는 **첫 결제의
// 만료일**만 준다 — 그러면 갱신을 영영 못 보고, 돈은 내는데 무료로 강등된다.
// ---------------------------------------------------------------------------
describe('fetchAppleSubscriptionStatus', () => {
  const ORIGINAL_ID = '2000000800000001';

  function signedRenewalInfo(payload: Record<string, unknown>): string {
    const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256' })));
    const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
    return `${header}.${body}.c2ln`;
  }

  function statusBody(over: {
    status?: number;
    expiresDate?: number;
    autoRenewStatus?: number;
    originalTransactionId?: string;
    bundleId?: string;
  } = {}) {
    return {
      bundleId: over.bundleId ?? BUNDLE_ID,
      data: [
        {
          lastTransactions: [
            {
              originalTransactionId: over.originalTransactionId ?? ORIGINAL_ID,
              status: over.status ?? 1,
              signedTransactionInfo: signedTransactionInfo(
                txPayload({
                  originalTransactionId: over.originalTransactionId ?? ORIGINAL_ID,
                  expiresDate: over.expiresDate ?? Date.now() + 30 * 24 * 3600 * 1000,
                }),
              ),
              signedRenewalInfo: signedRenewalInfo({
                autoRenewStatus: over.autoRenewStatus ?? 1,
              }),
            },
          ],
        },
      ],
    };
  }

  it('구독 상태 엔드포인트를 부르고 최신 만료일을 돌려준다', async () => {
    const config = await makeConfig();
    const expires = Date.now() + 30 * 24 * 3600 * 1000;
    const fetchMock = async (url: string) => {
      expect(String(url)).toContain(`/subscriptions/${ORIGINAL_ID}`);
      return new Response(JSON.stringify(statusBody({ expiresDate: expires })), { status: 200 });
    };
    const result = await fetchAppleSubscriptionStatus(
      ORIGINAL_ID,
      config,
      fetchMock as unknown as typeof fetch,
    );
    expect(result.status).toBe(1);
    expect(result.expiresDate).toBe(expires);
    expect(result.autoRenewStatus).toBe(1);
  });

  it('사용자가 App Store 에서 해지하면 autoRenewStatus=0 을 준다', async () => {
    const config = await makeConfig();
    const fetchMock = async () =>
      new Response(JSON.stringify(statusBody({ autoRenewStatus: 0 })), { status: 200 });
    const result = await fetchAppleSubscriptionStatus(
      ORIGINAL_ID,
      config,
      fetchMock as unknown as typeof fetch,
    );
    expect(result.autoRenewStatus).toBe(0);
  });

  it('프로덕션에 없으면 샌드박스를 한 번 더 본다', async () => {
    const config = await makeConfig();
    const seen: string[] = [];
    const fetchMock = async (url: string) => {
      seen.push(String(url));
      if (seen.length === 1) return new Response('', { status: 404 });
      return new Response(JSON.stringify(statusBody()), { status: 200 });
    };
    const result = await fetchAppleSubscriptionStatus(
      ORIGINAL_ID,
      config,
      fetchMock as unknown as typeof fetch,
    );
    expect(result.status).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain('sandbox');
  });

  it('양쪽 다 없으면 AppleTransactionNotFoundError', async () => {
    const config = await makeConfig();
    const fetchMock = async () => new Response('', { status: 404 });
    await expect(
      fetchAppleSubscriptionStatus(ORIGINAL_ID, config, fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(AppleTransactionNotFoundError);
  });

  // ⚠ 다른 앱의 구독이 우리 것으로 들어오면 안 된다.
  it('번들 ID 가 다르면 거절한다', async () => {
    const config = await makeConfig();
    const fetchMock = async () =>
      new Response(JSON.stringify(statusBody({ bundleId: 'com.someone.else' })), { status: 200 });
    await expect(
      fetchAppleSubscriptionStatus(ORIGINAL_ID, config, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/bundle id mismatch/);
  });

  // 같은 구독 그룹 안의 **다른** 구독을 집으면 엉뚱한 만료일로 연장하게 된다
  // (예: 개인 → 가족으로 갈아탄 흔적이 같은 그룹에 남는다).
  it('같은 그룹의 다른 구독을 집지 않는다', async () => {
    const config = await makeConfig();
    const fetchMock = async () =>
      new Response(
        JSON.stringify(statusBody({ originalTransactionId: '9999999999999999' })),
        { status: 200 },
      );
    await expect(
      fetchAppleSubscriptionStatus(ORIGINAL_ID, config, fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(AppleTransactionNotFoundError);
  });
});
