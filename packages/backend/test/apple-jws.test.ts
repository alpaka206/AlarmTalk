// **애플 서명 JWS 검증**(`src/lib/apple-jws.ts`) — 서버 알림 V2 의 유일한 신뢰 근거다.
//
// 두 겹으로 본다.
//  1. 실제 애플 인증서(Apple Root CA - G3 → WWDR G6)로 파서·체인 서명 검증이 진짜 DER 을 읽는지.
//     애플의 잎 키는 가질 수 없으니 JWS 째로는 못 하고, 체인 한 고리만 본다.
//  2. 같은 모양의 자체 체인(`support/apple-jws-fixtures.ts`)으로 JWS 전체 — 통과 하나와 거절 갈래 전부.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  APPLE_ROOT_CA_G3_SHA256,
  AppleJwsVerificationError,
  verifyAppleSignedJws,
  verifyCertificateIssuedBy,
} from '../src/lib/apple-jws';
import {
  makeTestAppleChain,
  signTestAppleJws,
  type TestAppleChain,
} from './support/apple-jws-fixtures';

/** https://www.apple.com/certificateauthority/AppleRootCA-G3.cer (공개 인증서). */
const APPLE_ROOT_CA_G3 =
  'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==';
/** https://www.apple.com/certificateauthority/AppleWWDRCAG6.cer (공개 인증서). */
const APPLE_WWDR_G6 =
  'MIIDFjCCApygAwIBAgIUIsGhRwp0c2nvU4YSycafPTjzbNcwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMjEwMzE3MjAzNzEwWhcNMzYwMzE5MDAwMDAwWjB1MUQwQgYDVQQDDDtBcHBsZSBXb3JsZHdpZGUgRGV2ZWxvcGVyIFJlbGF0aW9ucyBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTELMAkGA1UECwwCRzYxEzARBgNVBAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEbsQKC94PrlWmZXnXgtxzdVJL8T0SGYngDRGpngn3N6PT8JMEb7FDi4bBmPhCnZ3/sq6PF/cGcKXWsL5vOteRhyJ45x3ASP7cOB+aao90fcpxSv/EZFbniAbNgZGhIhpIo4H6MIH3MBIGA1UdEwEB/wQIMAYBAf8CAQAwHwYDVR0jBBgwFoAUu7DeoVgziJqkipnevr3rr9rLJKswRgYIKwYBBQUHAQEEOjA4MDYGCCsGAQUFBzABhipodHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLWFwcGxlcm9vdGNhZzMwNwYDVR0fBDAwLjAsoCqgKIYmaHR0cDovL2NybC5hcHBsZS5jb20vYXBwbGVyb290Y2FnMy5jcmwwHQYDVR0OBBYEFD8vlCNR01DJmig97bB85c+lkGKZMA4GA1UdDwEB/wQEAwIBBjAQBgoqhkiG92NkBgIBBAIFADAKBggqhkjOPQQDAwNoADBlAjBAXhSq5IyKogMCPtw490BaB677CaEGJXufQB/EqZGd6CSjiCtOnuMTbXVXmxxcxfkCMQDTSPxarZXvNrkxU3TkUMI33yzvFVVRT4wxWJC994OsdcZ4+RGNsYDyR5gmdr0nDGg=';

function der(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('실제 애플 인증서', () => {
  it('고정한 지문은 Apple Root CA - G3 의 것이다', async () => {
    expect(await sha256Hex(der(APPLE_ROOT_CA_G3))).toBe(APPLE_ROOT_CA_G3_SHA256);
  });

  it('WWDR G6 는 G3 가 서명했다 — 파서가 진짜 DER(P-384, SHA-384)을 읽는다', async () => {
    await expect(
      verifyCertificateIssuedBy(der(APPLE_WWDR_G6), der(APPLE_ROOT_CA_G3)),
    ).resolves.toBeUndefined();
  });

  it('거꾸로(G3 를 G6 가 서명했다)는 거절한다', async () => {
    await expect(
      verifyCertificateIssuedBy(der(APPLE_ROOT_CA_G3), der(APPLE_WWDR_G6)),
    ).rejects.toBeInstanceOf(AppleJwsVerificationError);
  });
});

describe('verifyAppleSignedJws — 자체 체인', () => {
  let chain: TestAppleChain;
  const payload = { notificationType: 'TEST', signedDate: Date.now(), hello: '애플' };

  beforeAll(async () => {
    chain = await makeTestAppleChain();
  });

  const trust = () => ({ trustedRootSha256: [chain.rootSha256] });

  it('체인·서명·표식이 맞으면 payload 를 돌려준다', async () => {
    const jws = await signTestAppleJws(payload, chain);
    await expect(verifyAppleSignedJws(jws, trust())).resolves.toEqual(payload);
  });

  it('루트가 Apple Root CA - G3 가 아니면 거절한다(기본 신뢰 목록)', async () => {
    const jws = await signTestAppleJws(payload, chain);
    await expect(verifyAppleSignedJws(jws)).rejects.toThrow('untrusted root certificate');
  });

  it('중간 인증서를 루트가 서명하지 않았으면 거절한다', async () => {
    const rogue = await makeTestAppleChain({ intermediateSignedByRogue: true });
    const jws = await signTestAppleJws(payload, rogue);
    await expect(
      verifyAppleSignedJws(jws, { trustedRootSha256: [rogue.rootSha256] }),
    ).rejects.toThrow('certificate chain signature invalid');
  });

  it('애플 표식이 없는 잎·중간은 거절한다 — 같은 루트 아래의 다른 인증서로 서명한 것', async () => {
    const noLeaf = await makeTestAppleChain({ leafMarker: false });
    await expect(
      verifyAppleSignedJws(await signTestAppleJws(payload, noLeaf), {
        trustedRootSha256: [noLeaf.rootSha256],
      }),
    ).rejects.toThrow('leaf certificate');
    const noIntermediate = await makeTestAppleChain({ intermediateMarker: false });
    await expect(
      verifyAppleSignedJws(await signTestAppleJws(payload, noIntermediate), {
        trustedRootSha256: [noIntermediate.rootSha256],
      }),
    ).rejects.toThrow('intermediate certificate');
  });

  it('payload 를 바꾸면 서명이 맞지 않는다', async () => {
    const jws = await signTestAppleJws(payload, chain);
    const [head, , sig] = jws.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, notificationType: 'REFUND' })).toString(
      'base64url',
    );
    await expect(verifyAppleSignedJws(`${head}.${forged}.${sig}`, trust())).rejects.toThrow(
      'JWS signature invalid',
    );
  });

  it('다른 키로 서명한 JWS 에 애플 체인만 붙이면 거절한다', async () => {
    const other = await makeTestAppleChain();
    const jws = await signTestAppleJws(payload, { ...other, x5c: chain.x5c });
    await expect(verifyAppleSignedJws(jws, trust())).rejects.toThrow('JWS signature invalid');
  });

  it('ES256 이 아니거나 x5c 가 세 장이 아니면 거절한다', async () => {
    await expect(
      verifyAppleSignedJws(await signTestAppleJws(payload, chain, { alg: 'none' }), trust()),
    ).rejects.toThrow('unsupported JWS alg');
    await expect(
      verifyAppleSignedJws(
        await signTestAppleJws(payload, chain, { x5c: chain.x5c.slice(0, 2) }),
        trust(),
      ),
    ).rejects.toThrow('x5c');
    await expect(verifyAppleSignedJws('not-a-jws', trust())).rejects.toBeInstanceOf(
      AppleJwsVerificationError,
    );
  });

  it('유효기간은 서명 시각(signedDate)으로 본다 — 지난 잎으로 지금 서명한 것은 거절한다', async () => {
    const expiring = await makeTestAppleChain({ leafNotAfter: new Date('2025-01-01T00:00:00Z') });
    const opts = { trustedRootSha256: [expiring.rootSha256] };
    await expect(
      verifyAppleSignedJws(await signTestAppleJws({ signedDate: Date.now() }, expiring), opts),
    ).rejects.toThrow('certificate not valid at signing time');
    // 잎이 유효하던 때 서명한 알림의 재전송은 통과한다(애플 라이브러리의 오프라인 판정과 같다).
    const signedDate = Date.parse('2024-06-01T00:00:00Z');
    await expect(
      verifyAppleSignedJws(await signTestAppleJws({ signedDate }, expiring), opts),
    ).resolves.toEqual({
      signedDate,
    });
  });
});
