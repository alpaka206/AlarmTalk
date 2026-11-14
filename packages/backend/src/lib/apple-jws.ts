// **애플이 서명한 JWS 를 직접 검증한다** — App Store Server Notifications V2 의 `signedPayload` 와
// 그 안의 `signedTransactionInfo`.
//
// 왜 여기만 직접 검증하나:
//   결제 확정·재조회(`apple-storekit.ts`)는 JWS 를 **우리가 인증해서 부른 애플 API 의 TLS 응답**으로 받는다 —
//   그 경로는 서명을 안 봐도 된다. 서버 알림은 반대다. **누구나 부를 수 있는 공개 URL** 로 들어오므로,
//   본문을 믿을 근거는 애플의 서명 하나뿐이다. 검증 없이 읽으면 아무나 우리 서버에 "환불됐다" 를 넣을 수 있다.
//
// 검증 순서(애플 공식 라이브러리 `SignedDataVerifier` 와 같은 판정):
//   1. 헤더 `alg` 는 ES256, `x5c` 는 정확히 세 장(잎 → 중간 → 루트).
//   2. 루트는 **Apple Root CA - G3 의 SHA-256 지문**과 바이트 단위로 같아야 한다(고정 — 아래 상수).
//      지문이 다르면 서명 계산을 하기도 전에 끝낸다(위조 요청에 CPU 를 쓰지 않는다).
//   3. 중간은 루트가, 잎은 중간이 서명했다(ECDSA, 인증서의 서명 알고리즘 그대로). 발급자·주체 이름도 잇는다.
//   4. 애플 표식 OID — 잎 `1.2.840.113635.100.6.11.1`, 중간 `1.2.840.113635.100.6.2.1`. 같은 루트 아래의 다른
//      애플 인증서(개발자 인증서 등)로 서명한 것을 막는다. 중간은 CA, 잎은 CA 가 아니어야 한다.
//   5. JWS 서명(ES256)을 잎의 공개키로 확인한다.
//   6. 세 장의 유효기간을 **payload 의 `signedDate`** 시각으로 본다(없으면 지금). 애플 라이브러리의 오프라인
//      판정과 같다 — 애플이 며칠에 걸쳐 같은 알림을 재전송해도 서명 당시 유효했던 인증서면 통과한다.
//      `signedDate` 는 3~5 단계를 통과한 뒤에야 읽으므로 위조할 수 없다.
//
// WebCrypto 만 쓴다(Workers 런타임). X.509 는 필요한 만큼만 DER 로 읽는다 — 확장·이름의 뜻을 해석하지 않고,
// 필요한 필드(서명 대상 바이트·공개키·유효기간·확장 OID·CA 여부)만 꺼낸다.

/**
 * **Apple Root CA - G3** 인증서(DER)의 SHA-256 지문. https://www.apple.com/certificateauthority/ 의
 * `AppleRootCA-G3.cer`(2014-04-30 ~ 2039-04-30, P-384). 루트를 바꾸려면 애플이 새 루트를 공지했을 때뿐이다.
 */
export const APPLE_ROOT_CA_G3_SHA256 =
  '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';

/** 잎 인증서 표식(App Store 서명용). */
export const APPLE_LEAF_MARKER_OID = '1.2.840.113635.100.6.11.1';
/** 중간 인증서 표식(Apple Worldwide Developer Relations CA). */
export const APPLE_INTERMEDIATE_MARKER_OID = '1.2.840.113635.100.6.2.1';

const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const CURVES: Record<string, { name: 'P-256' | 'P-384'; size: number }> = {
  '1.2.840.10045.3.1.7': { name: 'P-256', size: 32 },
  '1.3.132.0.34': { name: 'P-384', size: 48 },
};
const SIGNATURE_HASHES: Record<string, 'SHA-256' | 'SHA-384'> = {
  '1.2.840.10045.4.3.2': 'SHA-256',
  '1.2.840.10045.4.3.3': 'SHA-384',
};

export class AppleJwsVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppleJwsVerificationError';
  }
}

function fail(message: string): never {
  throw new AppleJwsVerificationError(message);
}

// MARK: - DER

interface Tlv {
  tag: number;
  /** 태그 바이트의 자리 — 서명 대상·공개키는 태그·길이까지 포함한 원래 바이트여야 한다. */
  start: number;
  contentStart: number;
  end: number;
}

function readTlv(buf: Uint8Array, offset: number, limit: number): Tlv {
  if (offset + 2 > limit) fail('DER: truncated header');
  const tag = buf[offset]!;
  if ((tag & 0x1f) === 0x1f) fail('DER: multi-byte tag');
  let length = buf[offset + 1]!;
  let cursor = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 3) fail('DER: unsupported length');
    length = 0;
    for (let i = 0; i < count; i++) {
      if (cursor >= limit) fail('DER: truncated length');
      length = length * 256 + buf[cursor++]!;
    }
  }
  const end = cursor + length;
  if (end > limit) fail('DER: truncated content');
  return { tag, start: offset, contentStart: cursor, end };
}

function childrenOf(buf: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let offset = parent.contentStart;
  while (offset < parent.end) {
    const child = readTlv(buf, offset, parent.end);
    out.push(child);
    offset = child.end;
  }
  return out;
}

function expectTag(tlv: Tlv | undefined, tag: number, what: string): Tlv {
  if (!tlv || tlv.tag !== tag) fail(`DER: expected ${what}`);
  return tlv;
}

function contentOf(buf: Uint8Array, tlv: Tlv): Uint8Array {
  return buf.subarray(tlv.contentStart, tlv.end);
}

function rawOf(buf: Uint8Array, tlv: Tlv): Uint8Array {
  return buf.subarray(tlv.start, tlv.end);
}

function decodeOid(bytes: Uint8Array): string {
  if (bytes.length === 0) fail('DER: empty OID');
  const parts: number[] = [];
  const first = bytes[0]!;
  parts.push(first < 80 ? Math.floor(first / 40) : 2, first < 80 ? first % 40 : first - 80);
  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    const byte = bytes[i]!;
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

function parseTime(buf: Uint8Array, tlv: Tlv): number {
  const text = new TextDecoder().decode(contentOf(buf, tlv));
  let match: RegExpMatchArray | null;
  let year: number;
  if (tlv.tag === 0x17) {
    // UTCTime YYMMDDHHMMSSZ — RFC 5280: 50 이상은 19xx.
    match = text.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
    if (!match) fail('DER: bad UTCTime');
    const yy = Number(match[1]);
    year = yy >= 50 ? 1900 + yy : 2000 + yy;
  } else if (tlv.tag === 0x18) {
    match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
    if (!match) fail('DER: bad GeneralizedTime');
    year = Number(match[1]);
  } else {
    fail('DER: expected time');
  }
  return Date.UTC(
    year,
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

interface ParsedCertificate {
  tbs: Uint8Array;
  signatureHash: 'SHA-256' | 'SHA-384';
  /** DER 인코딩된 ECDSA 서명(SEQUENCE { r, s }). */
  signature: Uint8Array;
  issuer: Uint8Array;
  subject: Uint8Array;
  notBefore: number;
  notAfter: number;
  /** SubjectPublicKeyInfo 전체(DER) — WebCrypto `spki` 로 그대로 넣는다. */
  spki: Uint8Array;
  curve: { name: 'P-256' | 'P-384'; size: number };
  extensionOids: Set<string>;
  isCa: boolean;
}

function parseCertificate(der: Uint8Array): ParsedCertificate {
  const cert = expectTag(readTlv(der, 0, der.length), 0x30, 'Certificate');
  if (cert.end !== der.length) fail('DER: trailing bytes');
  const [tbsTlv, outerAlg, sigValue] = childrenOf(der, cert);
  expectTag(tbsTlv, 0x30, 'TBSCertificate');
  const outerAlgOid = decodeOid(
    contentOf(
      der,
      expectTag(childrenOf(der, expectTag(outerAlg, 0x30, 'AlgorithmIdentifier'))[0], 0x06, 'OID'),
    ),
  );
  const signatureHash = SIGNATURE_HASHES[outerAlgOid];
  if (!signatureHash) fail(`unsupported certificate signature algorithm ${outerAlgOid}`);
  const bitString = contentOf(der, expectTag(sigValue, 0x03, 'BIT STRING'));
  if (bitString[0] !== 0) fail('DER: signature has unused bits');

  const fields = childrenOf(der, tbsTlv!);
  let i = 0;
  if (fields[i]?.tag === 0xa0) i++; // version
  expectTag(fields[i++], 0x02, 'serialNumber');
  const innerAlg = expectTag(fields[i++], 0x30, 'signature');
  const innerAlgOid = decodeOid(
    contentOf(der, expectTag(childrenOf(der, innerAlg)[0], 0x06, 'OID')),
  );
  // RFC 5280 4.1.1.2 — 두 자리의 알고리즘은 같아야 한다.
  if (innerAlgOid !== outerAlgOid) fail('certificate signature algorithm mismatch');
  const issuerTlv = expectTag(fields[i++], 0x30, 'issuer');
  const validity = childrenOf(der, expectTag(fields[i++], 0x30, 'validity'));
  if (validity.length !== 2) fail('DER: bad validity');
  const subjectTlv = expectTag(fields[i++], 0x30, 'subject');
  const spkiTlv = expectTag(fields[i++], 0x30, 'subjectPublicKeyInfo');
  const spkiAlg = childrenOf(der, expectTag(childrenOf(der, spkiTlv)[0], 0x30, 'SPKI algorithm'));
  if (decodeOid(contentOf(der, expectTag(spkiAlg[0], 0x06, 'OID'))) !== OID_EC_PUBLIC_KEY) {
    fail('certificate key is not EC');
  }
  const curveOid = decodeOid(contentOf(der, expectTag(spkiAlg[1], 0x06, 'curve OID')));
  const curve = CURVES[curveOid];
  if (!curve) fail(`unsupported curve ${curveOid}`);

  const extensionOids = new Set<string>();
  let isCa = false;
  for (; i < fields.length; i++) {
    if (fields[i]!.tag !== 0xa3) continue;
    const list = expectTag(childrenOf(der, fields[i]!)[0], 0x30, 'Extensions');
    for (const ext of childrenOf(der, list)) {
      const parts = childrenOf(der, expectTag(ext, 0x30, 'Extension'));
      const oid = decodeOid(contentOf(der, expectTag(parts[0], 0x06, 'extension OID')));
      extensionOids.add(oid);
      if (oid === OID_BASIC_CONSTRAINTS) {
        const value = expectTag(parts[parts.length - 1], 0x04, 'extension value');
        const inner = readTlv(der, value.contentStart, value.end);
        const first = childrenOf(der, expectTag(inner, 0x30, 'BasicConstraints'))[0];
        isCa = first?.tag === 0x01 && der[first.contentStart] !== 0;
      }
    }
  }

  return {
    tbs: rawOf(der, tbsTlv!),
    signatureHash,
    signature: bitString.subarray(1),
    issuer: rawOf(der, issuerTlv),
    subject: rawOf(der, subjectTlv),
    notBefore: parseTime(der, validity[0]!),
    notAfter: parseTime(der, validity[1]!),
    spki: rawOf(der, spkiTlv),
    curve,
    extensionOids,
    isCa,
  };
}

/** DER ECDSA 서명 → WebCrypto 가 받는 r||s(곡선 크기 고정). */
function derSignatureToRaw(der: Uint8Array, size: number): Uint8Array {
  const seq = expectTag(readTlv(der, 0, der.length), 0x30, 'ECDSA signature');
  if (seq.end !== der.length) fail('DER: trailing signature bytes');
  const ints = childrenOf(der, seq);
  if (ints.length !== 2) fail('DER: bad ECDSA signature');
  const out = new Uint8Array(size * 2);
  ints.forEach((tlv, index) => {
    let value = contentOf(der, expectTag(tlv, 0x02, 'INTEGER'));
    while (value.length > 1 && value[0] === 0) value = value.subarray(1);
    if (value.length > size) fail('DER: ECDSA integer too long');
    out.set(value, index * size + (size - value.length));
  });
  return out;
}

async function verifyEcdsa(
  signer: ParsedCertificate,
  hash: 'SHA-256' | 'SHA-384',
  rawSignature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'spki',
    signer.spki,
    { name: 'ECDSA', namedCurve: signer.curve.name },
    false,
    ['verify'],
  );
  return crypto.subtle.verify({ name: 'ECDSA', hash }, key, rawSignature, data);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    fail('bad base64');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) fail('bad base64url');
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  return base64ToBytes(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

async function verifyIssuedBy(child: ParsedCertificate, parent: ParsedCertificate): Promise<void> {
  if (!sameBytes(child.issuer, parent.subject)) fail('certificate chain name mismatch');
  const ok = await verifyEcdsa(
    parent,
    child.signatureHash,
    derSignatureToRaw(child.signature, parent.curve.size),
    child.tbs,
  );
  if (!ok) fail('certificate chain signature invalid');
}

// MARK: - 공개 API

/**
 * 인증서 한 장(`childDer`)이 다른 한 장(`parentDer`)의 키로 서명됐는가 — 체인 한 고리.
 * `verifyAppleSignedJws` 안에서 쓰는 것과 같은 판정이고, 실제 애플 인증서(G3 → WWDR G6)로 파서를
 * 시험하는 자리에서 따로 부른다(애플의 잎 키는 우리가 가질 수 없어 JWS 째로는 시험할 수 없다).
 */
export async function verifyCertificateIssuedBy(
  childDer: Uint8Array,
  parentDer: Uint8Array,
): Promise<void> {
  await verifyIssuedBy(parseCertificate(childDer), parseCertificate(parentDer));
}

export interface AppleJwsVerifyOptions {
  /**
   * 믿는 루트 인증서의 SHA-256 지문(소문자 hex). 기본은 Apple Root CA - G3 하나다.
   * ⚠ **운영 코드에서 넘기지 말 것** — 테스트가 자체 루트로 바꿔 끼우는 자리다.
   */
  trustedRootSha256?: readonly string[];
  /** 인증서 유효기간을 볼 시각(ms). 없으면 payload 의 `signedDate`, 그것도 없으면 지금. */
  effectiveDate?: number;
}

/**
 * 애플이 서명한 JWS 를 검증하고 payload 를 돌려준다. 하나라도 어긋나면 `AppleJwsVerificationError`.
 * 검증 순서와 근거는 이 파일 머리말.
 */
export async function verifyAppleSignedJws<T = Record<string, unknown>>(
  jws: string,
  options: AppleJwsVerifyOptions = {},
): Promise<T> {
  const parts = jws.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) fail('malformed JWS');
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { alg?: unknown; x5c?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
  } catch (error) {
    if (error instanceof AppleJwsVerificationError) throw error;
    fail('bad JWS header');
  }
  if (header.alg !== 'ES256') fail('unsupported JWS alg');
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length !== 3 || !x5c.every((c) => typeof c === 'string')) {
    fail('x5c must hold exactly three certificates');
  }
  const ders = (x5c as string[]).map(base64ToBytes);

  // 루트 지문을 먼저 본다 — 아니면 서명 계산까지 가지 않는다.
  const trusted = options.trustedRootSha256 ?? [APPLE_ROOT_CA_G3_SHA256];
  if (!trusted.includes(await sha256Hex(ders[2]!))) fail('untrusted root certificate');

  const [leaf, intermediate, root] = ders.map(parseCertificate) as [
    ParsedCertificate,
    ParsedCertificate,
    ParsedCertificate,
  ];
  if (!intermediate.isCa || !intermediate.extensionOids.has(APPLE_INTERMEDIATE_MARKER_OID)) {
    fail('intermediate certificate is not an Apple WWDR CA');
  }
  if (leaf.isCa || !leaf.extensionOids.has(APPLE_LEAF_MARKER_OID)) {
    fail('leaf certificate is not an App Store signing certificate');
  }
  await verifyIssuedBy(intermediate, root);
  await verifyIssuedBy(leaf, intermediate);

  if (leaf.curve.name !== 'P-256') fail('ES256 needs a P-256 leaf key');
  const signature = base64UrlToBytes(signatureB64);
  if (signature.length !== 64) fail('bad ES256 signature length');
  const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  if (!(await verifyEcdsa(leaf, 'SHA-256', signature, signed))) fail('JWS signature invalid');

  let payload: T & { signedDate?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  } catch {
    fail('bad JWS payload');
  }
  if (!payload || typeof payload !== 'object') fail('bad JWS payload');

  const at =
    options.effectiveDate ??
    (typeof payload.signedDate === 'number' && Number.isFinite(payload.signedDate)
      ? payload.signedDate
      : Date.now());
  for (const cert of [leaf, intermediate, root]) {
    if (at < cert.notBefore || at > cert.notAfter) fail('certificate not valid at signing time');
  }
  return payload;
}
