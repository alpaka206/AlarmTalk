// Sign in with Apple identity token 검증 단위 테스트.
//
// 실제 RSA 키쌍을 만들어 토큰에 서명하고, 애플 JWKS 응답만 목킹한다 —
// 서명 검증 경로를 진짜로 태우기 위해서다. **유료 개발자 계정 없이 전부 검증된다**
// (네이티브 로그인 플로우는 공개키 검증만 하고 .p8 비밀키를 쓰지 않는다).
import { describe, it, expect, beforeEach } from 'vitest';
import { verifyAppleIdToken, __resetAppleJwksCacheForTests } from '../src/lib/apple-oauth';

const BUNDLE_ID = 'com.voicealarm.nativeapp.ios';
const KID = 'test-key-1';

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

let keyPair: CryptoKeyPair;
let jwk: JsonWebKey;

async function ensureKeys() {
  if (keyPair) return;
  keyPair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
}

/** 애플이 발급한 것처럼 서명된 identity token 을 만든다. */
async function makeToken(
  payload: Record<string, unknown>,
  opts: { kid?: string; alg?: string; signWithWrongKey?: boolean } = {},
): Promise<string> {
  await ensureKeys();
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID };
  const data = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  let signingKey = keyPair.privateKey;
  if (opts.signWithWrongKey) {
    const other = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    signingKey = other.privateKey;
  }
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, new TextEncoder().encode(data));
  return `${data}.${b64url(sig)}`;
}

function basePayload(over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://appleid.apple.com',
    aud: BUNDLE_ID,
    sub: 'apple-sub-001',
    iat: now,
    exp: now + 600,
    ...over,
  };
}

/** JWKS 응답만 목킹하는 fetch. */
function jwksFetch(overrideKeys?: unknown): typeof fetch {
  return (async () => {
    const keys = overrideKeys ?? [{ kty: jwk.kty, kid: KID, use: 'sig', alg: 'RS256', n: jwk.n, e: jwk.e }];
    return new Response(JSON.stringify({ keys }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('verifyAppleIdToken', () => {
  beforeEach(async () => {
    await ensureKeys();
    __resetAppleJwksCacheForTests();
  });

  it('올바른 토큰을 검증하고 payload 를 돌려준다', async () => {
    const token = await makeToken(basePayload({ email: 'a@b.com', email_verified: 'true' }));
    const p = await verifyAppleIdToken(token, BUNDLE_ID, undefined, jwksFetch());
    expect(p.sub).toBe('apple-sub-001');
    expect(p.email).toBe('a@b.com');
  });

  // aud 를 안 보면 **다른 앱용으로 발급된 유효한 애플 토큰**도 통과해, 그 앱 사용자가
  // sub 기준으로 우리 계정을 차지할 수 있다.
  it('aud 가 다르면 거부한다', async () => {
    const token = await makeToken(basePayload({ aud: 'com.someone.else' }));
    await expect(verifyAppleIdToken(token, BUNDLE_ID, undefined, jwksFetch())).rejects.toThrow(
      /audience/i,
    );
  });

  // fail-closed: 번들 ID 미설정 시 검증을 건너뛰지 않는다.
  it('expectedAudience 가 비면 검증을 건너뛰지 않고 실패한다', async () => {
    const token = await makeToken(basePayload());
    await expect(verifyAppleIdToken(token, '', undefined, jwksFetch())).rejects.toThrow(
      /not configured/i,
    );
  });

  it('issuer 가 애플이 아니면 거부한다', async () => {
    const token = await makeToken(basePayload({ iss: 'https://evil.example.com' }));
    await expect(verifyAppleIdToken(token, BUNDLE_ID, undefined, jwksFetch())).rejects.toThrow(
      /issuer/i,
    );
  });

  it('만료된 토큰을 거부한다', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken(basePayload({ exp: now - 10 }));
    await expect(verifyAppleIdToken(token, BUNDLE_ID, undefined, jwksFetch())).rejects.toThrow(
      /expired/i,
    );
  });

  // 서명 위조 방어 — 이게 뚫리면 누구나 임의의 sub 으로 로그인할 수 있다.
  it('다른 키로 서명된 토큰을 거부한다', async () => {
    const token = await makeToken(basePayload(), { signWithWrongKey: true });
    await expect(verifyAppleIdToken(token, BUNDLE_ID, undefined, jwksFetch())).rejects.toThrow(
      /signature/i,
    );
  });

  // alg 를 토큰이 스스로 고르게 두면 alg=none / HS256 혼동 공격이 성립한다.
  it('RS256 이 아닌 alg 를 거부한다', async () => {
    const token = await makeToken(basePayload(), { alg: 'none' });
    await expect(verifyAppleIdToken(token, BUNDLE_ID, undefined, jwksFetch())).rejects.toThrow(
      /algorithm/i,
    );
  });

  it('JWKS 에 없는 kid 를 거부한다', async () => {
    const token = await makeToken(basePayload(), { kid: 'unknown-kid' });
    await expect(verifyAppleIdToken(token, BUNDLE_ID, undefined, jwksFetch())).rejects.toThrow(
      /signing key not found/i,
    );
  });

  // nonce 는 재생 공격 방지다. 앱이 보냈으면 반드시 일치해야 한다.
  //
  // ⚠ 계약: 앱은 **raw nonce** 를 보내고, 토큰에는 그 **SHA-256 hex** 가 들어 있다
  // (앱이 ASAuthorizationAppleIDRequest.nonce 에 해시를 넣기 때문). 서버가 raw 를
  // 그대로 비교하면 모든 애플 로그인이 401 이 된다 — 실제로 그랬다.
  async function sha256Hex(v: string): Promise<string> {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  it('raw nonce 를 해싱해 토큰의 nonce 클레임과 맞춘다', async () => {
    const raw = 'raw-nonce-abc';
    const token = await makeToken(basePayload({ nonce: await sha256Hex(raw) }));
    const p = await verifyAppleIdToken(token, BUNDLE_ID, raw, jwksFetch());
    expect(p.sub).toBe('apple-sub-001');
  });

  it('raw nonce 를 그대로 비교하지 않는다 (해시가 아닌 값이 토큰에 있으면 거부)', async () => {
    const raw = 'raw-nonce-abc';
    const token = await makeToken(basePayload({ nonce: raw }));
    await expect(verifyAppleIdToken(token, BUNDLE_ID, raw, jwksFetch())).rejects.toThrow(/nonce/i);
  });

  it('nonce 가 다르면 거부한다', async () => {
    const token = await makeToken(basePayload({ nonce: await sha256Hex('raw-A') }));
    await expect(verifyAppleIdToken(token, BUNDLE_ID, 'raw-B', jwksFetch())).rejects.toThrow(
      /nonce/i,
    );
  });

  // 검증되지 않은 이메일을 신뢰하면 계정 연동 탈취 경로가 된다(다운스트림이 email 로
  // 기존 계정과 연동한다). 구글 경로와 같은 규칙.
  it('email_verified 가 false 면 거부한다', async () => {
    const token = await makeToken(basePayload({ email: 'a@b.com', email_verified: 'false' }));
    await expect(verifyAppleIdToken(token, BUNDLE_ID, undefined, jwksFetch())).rejects.toThrow(
      /not verified/i,
    );
  });

  // 애플은 재로그인 시 email 클레임을 아예 안 주기도 한다. 그건 정상이다.
  it('email 이 아예 없으면 email_verified 없이도 통과한다', async () => {
    const token = await makeToken(basePayload());
    const p = await verifyAppleIdToken(token, BUNDLE_ID, undefined, jwksFetch());
    expect(p.email).toBeUndefined();
  });

  // aud 가 배열로 오는 경우도 있다.
  it('aud 가 배열이어도 포함돼 있으면 통과한다', async () => {
    const token = await makeToken(basePayload({ aud: ['other.app', BUNDLE_ID] }));
    const p = await verifyAppleIdToken(token, BUNDLE_ID, undefined, jwksFetch());
    expect(p.sub).toBe('apple-sub-001');
  });

  it('형식이 깨진 토큰을 거부한다', async () => {
    await expect(verifyAppleIdToken('not-a-jwt', BUNDLE_ID, undefined, jwksFetch())).rejects.toThrow(
      /Malformed/i,
    );
  });

  // 실패를 캐시하면 애플의 일시적 5xx 가 TTL 동안 모든 로그인을 막는다.
  it('JWKS 조회 실패는 캐시하지 않는다', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) return new Response('nope', { status: 500 });
      return new Response(
        JSON.stringify({ keys: [{ kty: jwk.kty, kid: KID, use: 'sig', alg: 'RS256', n: jwk.n, e: jwk.e }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const token = await makeToken(basePayload());
    await expect(verifyAppleIdToken(token, BUNDLE_ID, undefined, flaky)).rejects.toThrow(/JWKS/i);
    // 두 번째 시도는 성공해야 한다 — 실패가 캐시됐다면 여기서도 실패한다.
    const p = await verifyAppleIdToken(token, BUNDLE_ID, undefined, flaky);
    expect(p.sub).toBe('apple-sub-001');
  });
});
