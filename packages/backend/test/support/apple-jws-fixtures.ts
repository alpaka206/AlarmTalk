// **애플식 서명 JWS 를 테스트에서 만든다** — 자체 루트(P-384) → 중간(P-384, WWDR 표식) → 잎(P-256, App Store 표식).
//
// 애플의 잎 키는 우리가 가질 수 없으므로, 같은 모양의 체인을 WebCrypto 로 직접 만들고 X.509 를 손으로 DER 인코딩한다.
// 검증기(`src/lib/apple-jws.ts`)와 **따로** 쓴 인코더라, 둘이 같은 실수를 공유하지 않는다. 실제 애플 인증서로 파서를
// 확인하는 것은 `test/apple-jws.test.ts` 가 한다. 개인키를 파일로 커밋하지 않으려고 매번 만든다.

// MARK: - DER 인코더

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
  const n = content.length;
  const length =
    n < 0x80
      ? [n]
      : n < 0x100
        ? [0x81, n]
        : n < 0x10000
          ? [0x82, n >> 8, n & 0xff]
          : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff];
  return concat(new Uint8Array([tag, ...length]), content);
}

const seq = (...parts: Uint8Array[]) => tlv(0x30, concat(...parts));
const set = (...parts: Uint8Array[]) => tlv(0x31, concat(...parts));
const explicit = (n: number, inner: Uint8Array) => tlv(0xa0 + n, inner);
const octets = (bytes: Uint8Array) => tlv(0x04, bytes);
const bool = (value: boolean) => tlv(0x01, new Uint8Array([value ? 0xff : 0]));
const nullValue = () => tlv(0x05, new Uint8Array());
const utf8 = (text: string) => tlv(0x0c, new TextEncoder().encode(text));

function unsignedInteger(bytes: Uint8Array): Uint8Array {
  let value = bytes;
  while (value.length > 1 && value[0] === 0 && !(value[1]! & 0x80)) value = value.subarray(1);
  if (value[0]! & 0x80) value = concat(new Uint8Array([0]), value);
  return tlv(0x02, value);
}

function oid(dotted: string): Uint8Array {
  const [a, b, ...rest] = dotted.split('.').map(Number) as [number, number, ...number[]];
  const bytes = [a * 40 + b];
  for (const part of rest) {
    const chunk = [part & 0x7f];
    let v = Math.floor(part / 128);
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(...chunk);
  }
  return tlv(0x06, new Uint8Array(bytes));
}

function time(date: Date): Uint8Array {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'; // YYYYMMDDHHMMSSZ
  // RFC 5280: 2049 년까지는 UTCTime, 그 뒤는 GeneralizedTime — 둘 다 검증기가 읽는지 본다.
  return date.getUTCFullYear() < 2050
    ? tlv(0x17, new TextEncoder().encode(iso.slice(2)))
    : tlv(0x18, new TextEncoder().encode(iso));
}

const name = (cn: string) => seq(set(seq(oid('2.5.4.3'), utf8(cn))));

/** WebCrypto 의 r||s → DER `SEQUENCE { INTEGER r, INTEGER s }`. */
function rawToDerSignature(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  return seq(unsignedInteger(raw.subarray(0, half)), unsignedInteger(raw.subarray(half)));
}

// MARK: - 인증서

const SHA256_SIG = '1.2.840.10045.4.3.2';
const SHA384_SIG = '1.2.840.10045.4.3.3';
export const LEAF_MARKER = '1.2.840.113635.100.6.11.1';
export const INTERMEDIATE_MARKER = '1.2.840.113635.100.6.2.1';

interface Issued {
  der: Uint8Array;
  keys: CryptoKeyPair;
  subject: string;
}

async function generate(curve: 'P-256' | 'P-384'): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
}

async function issue(options: {
  subject: string;
  keys: CryptoKeyPair;
  issuer?: { subject: string; keys: CryptoKeyPair };
  hash: 'SHA-256' | 'SHA-384';
  ca: boolean;
  markers?: string[];
  notBefore?: Date;
  notAfter?: Date;
}): Promise<Issued> {
  const signer = options.issuer ?? { subject: options.subject, keys: options.keys };
  const sigAlg = seq(oid(options.hash === 'SHA-256' ? SHA256_SIG : SHA384_SIG));
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', options.keys.publicKey));
  const extensions = [
    seq(oid('2.5.29.19'), bool(true), octets(options.ca ? seq(bool(true)) : seq())),
    ...(options.markers ?? []).map((marker) => seq(oid(marker), octets(nullValue()))),
  ];
  const tbs = seq(
    explicit(0, unsignedInteger(new Uint8Array([2]))),
    unsignedInteger(crypto.getRandomValues(new Uint8Array(8))),
    sigAlg,
    name(signer.subject),
    seq(
      time(options.notBefore ?? new Date('2020-01-01T00:00:00Z')),
      time(options.notAfter ?? new Date('2099-01-01T00:00:00Z')),
    ),
    name(options.subject),
    spki,
    explicit(3, seq(...extensions)),
  );
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: options.hash }, signer.keys.privateKey, tbs),
  );
  const signatureBits = concat(new Uint8Array([0]), rawToDerSignature(raw));
  return {
    der: seq(tbs, sigAlg, tlv(0x03, signatureBits)),
    keys: options.keys,
    subject: options.subject,
  };
}

export interface TestAppleChain {
  /** JWS 헤더에 싣는 순서(잎 → 중간 → 루트), 표준 base64. */
  x5c: string[];
  leafKey: CryptoKey;
  /** 이 체인의 루트 지문 — 검증기의 `trustedRootSha256` 로 넘긴다. */
  rootSha256: string;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ChainOptions {
  leafMarker?: boolean;
  intermediateMarker?: boolean;
  leafNotAfter?: Date;
  /** 중간 인증서를 **다른 루트 키**로 서명한다(체인에는 원래 루트를 싣는다) — 체인 서명 검증을 본다. */
  intermediateSignedByRogue?: boolean;
}

export async function makeTestAppleChain(options: ChainOptions = {}): Promise<TestAppleChain> {
  const root = await issue({
    subject: 'Test Root CA - G3',
    keys: await generate('P-384'),
    hash: 'SHA-384',
    ca: true,
  });
  const rogue = { subject: root.subject, keys: await generate('P-384') };
  const intermediate = await issue({
    subject: 'Test WWDR CA - G6',
    keys: await generate('P-384'),
    issuer: options.intermediateSignedByRogue ? rogue : root,
    hash: 'SHA-384',
    ca: true,
    markers: options.intermediateMarker === false ? [] : [INTERMEDIATE_MARKER],
  });
  const leaf = await issue({
    subject: 'Test Prod ECC Mac App Store and iTunes Store Receipt Signing',
    keys: await generate('P-256'),
    issuer: intermediate,
    hash: 'SHA-256',
    ca: false,
    markers: options.leafMarker === false ? [] : [LEAF_MARKER],
    notAfter: options.leafNotAfter,
  });
  return {
    x5c: [leaf.der, intermediate.der, root.der].map(toBase64),
    leafKey: leaf.keys.privateKey,
    rootSha256: await sha256Hex(root.der),
  };
}

function b64url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** 애플처럼 서명한 JWS(ES256, x5c 헤더). */
export async function signTestAppleJws(
  payload: unknown,
  chain: TestAppleChain,
  header: Record<string, unknown> = {},
): Promise<string> {
  const head = b64url(
    new TextEncoder().encode(JSON.stringify({ alg: 'ES256', x5c: chain.x5c, ...header })),
  );
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      chain.leafKey,
      new TextEncoder().encode(`${head}.${body}`),
    ),
  );
  return `${head}.${body}.${b64url(signature)}`;
}
