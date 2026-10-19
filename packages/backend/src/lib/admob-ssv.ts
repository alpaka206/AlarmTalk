/**
 * **AdMob 보상형 광고의 서버 측 확인(SSV) 서명 검증.** 스펙: `docs/spec/ad-rewards.md`.
 *
 * 광고를 끝까지 본 사실은 **앱이 아니라 AdMob 서버가** 알려 준다 — 사용자가 보상을 받으면 AdMob 이
 * 광고 단위에 등록한 콜백 URL 을 서명된 쿼리와 함께 부른다. 앱이 "봤어요" 라고 보내는 값은 믿지 않는다
 * (아무나 그 요청을 만들 수 있다).
 *
 * 서명 규칙(Google 문서 그대로):
 * - 서명할 내용 = 쿼리 문자열에서 `&signature=` **앞까지**(인코딩된 그대로의 바이트). `signature`·`key_id`
 *   는 언제나 마지막 두 파라미터다.
 * - `signature` 는 web-safe base64 로 인코딩한 **DER** ECDSA(P-256, SHA-256) 서명이다. WebCrypto 는
 *   r‖s(64바이트)를 받으므로 DER 을 풀어 넘긴다.
 * - 공개키는 `VERIFIER_KEYS_URL` 이 주는 목록에서 `key_id` 로 고른다(키는 돌아가며 바뀐다).
 */

export const VERIFIER_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';

/** 키 목록을 다시 받기 전까지 들고 있는 시간. 모르는 `key_id` 가 오면 이 시간과 무관하게 한 번 다시 받는다. */
const KEYS_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 모르는 `key_id` 를 어떻게 다시 받아 보나. 이 라우트는 인증이 없어, 아무 `key_id` 나 붙인 요청을 쏟으면 요청마다 Google 로
 * 나가는 요청과 키 가져오기를 일으킬 수 있다(코덱스 #925). 그런데 진짜 키 교체도 같은 모양으로 온다 — 그리고 AdMob 은
 * 실패한 콜백을 **1초 간격으로 다섯 번만** 다시 부르므로, 긴 냉각 시간을 두면 교체 직후의 보상이 영영 사라진다(코덱스 #925).
 * 그래서 둘로 나눈다:
 * - **같은 `key_id`** 는 한 번 다시 받아 봐도 없었으면 10분 동안 곧바로 거절한다 — 같은 가짜 id 를 되풀이해도 바깥 요청이
 *   없다.
 * - **다른 `key_id`** 마다의 강제 갱신은 전체에서 2초에 한 번까지다. 그 사이에 온 것은 거절이 아니라 **다시 부르라는 답**
 *   ([AdMobKeysBusyError] → 429)이라, 진짜 새 키의 콜백은 1초 뒤 재시도에서 받힌다(그 사이 다른 갱신이 이미 새 목록을
 *   받아 왔으면 캐시에서 바로 찾는다). 가짜 id 를 쏟아도 바깥 요청은 isolate 하나에 분당 30번을 넘지 않는다.
 */
const UNKNOWN_KEY_NEGATIVE_TTL_MS = 10 * 60 * 1000;
const FORCED_REFRESH_MIN_GAP_MS = 2_000;
const UNKNOWN_KEY_CACHE_MAX = 1_000;

/** 강제 갱신을 막 했으니 잠시 뒤에 다시 부르라는 뜻 — 라우트가 다시 시도할 수 있는 4xx 로 답한다. */
export class AdMobKeysBusyError extends Error {
  constructor() {
    super('AdMob verifier keys were refreshed moments ago; retry shortly.');
    this.name = 'AdMobKeysBusyError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let cachedKeys: { at: number; keys: Map<string, CryptoKey> } | null = null;
let lastForcedRefreshAt = 0;
const unknownKeyCheckedAt = new Map<string, number>();

/** 테스트 전용 — 모듈 캐시를 비운다. */
export function resetAdMobKeyCacheForTest(): void {
  cachedKeys = null;
  inFlight = null;
  lastForcedRefreshAt = 0;
  unknownKeyCheckedAt.clear();
}

function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * DER `SEQUENCE { INTEGER r, INTEGER s }` → r‖s(각 32바이트). 형식이 어긋나면 null.
 * INTEGER 는 부호 비트 때문에 앞에 0x00 이 붙어 33바이트일 수 있고, 작은 값이면 32바이트보다 짧다.
 */
export function derEcdsaToRaw(der: Uint8Array): Uint8Array | null {
  let i = 0;
  if (der[i++] !== 0x30) return null;
  let seqLen = der[i++];
  if (seqLen === undefined) return null;
  if (seqLen & 0x80) {
    const n = seqLen & 0x7f;
    if (n !== 1) return null;
    seqLen = der[i++]!;
  }
  if (i + seqLen !== der.length) return null;
  const out = new Uint8Array(64);
  for (let part = 0; part < 2; part++) {
    if (der[i++] !== 0x02) return null;
    const len = der[i++];
    if (len === undefined || len === 0 || i + len > der.length) return null;
    let int = der.subarray(i, i + len);
    i += len;
    while (int.length > 32 && int[0] === 0x00) int = int.subarray(1);
    if (int.length > 32) return null;
    out.set(int, part * 32 + (32 - int.length));
  }
  return i === der.length ? out : null;
}

/**
 * 지금 받고 있는 키 목록. **동시에 온 요청은 같은 받기를 기다린다**(코덱스 #925) — 아니면 모르는 `key_id` 여럿이나 차가운
 * 캐시에 몰린 콜백이 2초 간격 검사를 동시에 지나 요청마다 바깥으로 나가, 하위 요청 한도를 태우고 진짜 콜백까지 실패시킨다.
 */
let inFlight: Promise<Map<string, CryptoKey>> | null = null;

function loadKeys(fetchImpl: FetchLike, force: boolean): Promise<Map<string, CryptoKey>> {
  if (!force && cachedKeys && Date.now() - cachedKeys.at < KEYS_TTL_MS) {
    return Promise.resolve(cachedKeys.keys);
  }
  if (inFlight) return inFlight;
  inFlight = fetchKeys(fetchImpl).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function fetchKeys(fetchImpl: FetchLike): Promise<Map<string, CryptoKey>> {
  const res = await fetchImpl(VERIFIER_KEYS_URL);
  if (!res.ok) throw new Error(`AdMob verifier keys fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: Array<{ keyId?: number | string; base64?: string }> };
  const keys = new Map<string, CryptoKey>();
  for (const entry of body.keys ?? []) {
    if (entry.keyId == null || typeof entry.base64 !== 'string') continue;
    const key = await crypto.subtle.importKey(
      'spki',
      base64ToBytes(entry.base64),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    keys.set(String(entry.keyId), key);
  }
  cachedKeys = { at: Date.now(), keys };
  return keys;
}

export interface AdMobRewardCallback {
  /** 사용자가 보상을 받은 시각(서명된 `timestamp`, epoch ms). 없거나 숫자가 아니면 null. */
  rewardedAtMs: number | null;
  adUnit: string;
  transactionId: string;
  userId: string;
  customData: string;
  rewardItem: string;
  rewardAmount: number;
}

/**
 * 원시 쿼리 문자열(앞의 `?` 없이)을 검증한다. 서명이 맞으면 파라미터를, 아니면 null 을 돌려준다.
 * 키 목록을 못 받으면 **던진다** — 그건 서명이 틀린 것이 아니라 우리 쪽 장애라, 라우트가 5xx 로 답해
 * AdMob 이 나중에 다시 부르게 해야 한다(200 으로 삼키면 그 보상은 영영 적립되지 않는다).
 */
export async function verifyAdMobCallback(
  rawQuery: string,
  fetchImpl: FetchLike = fetch,
): Promise<AdMobRewardCallback | null> {
  const sigAt = rawQuery.indexOf('&signature=');
  if (sigAt <= 0) return null;
  const content = rawQuery.slice(0, sigAt);
  const params = new URLSearchParams(rawQuery);
  const signature = params.get('signature');
  const keyId = params.get('key_id');
  if (!signature || !keyId) return null;

  let raw: Uint8Array | null;
  try {
    raw = derEcdsaToRaw(base64ToBytes(signature));
  } catch {
    return null;
  }
  if (!raw) return null;

  let key = (await loadKeys(fetchImpl, false)).get(keyId);
  if (!key) {
    const checkedAt = unknownKeyCheckedAt.get(keyId);
    if (checkedAt !== undefined && Date.now() - checkedAt < UNKNOWN_KEY_NEGATIVE_TTL_MS)
      return null;
    if (Date.now() - lastForcedRefreshAt < FORCED_REFRESH_MIN_GAP_MS)
      throw new AdMobKeysBusyError();
    // ⚠ 시각은 **받기에 성공한 뒤에** 적는다(코덱스 #924). 먼저 적으면 일시 장애로 던진(5xx) 갱신 뒤의 재시도가 갱신을
    //   건너뛴다.
    key = (await loadKeys(fetchImpl, true)).get(keyId);
    lastForcedRefreshAt = Date.now();
    if (!key) {
      if (unknownKeyCheckedAt.size >= UNKNOWN_KEY_CACHE_MAX) unknownKeyCheckedAt.clear();
      unknownKeyCheckedAt.set(keyId, Date.now());
      return null;
    }
  }

  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    raw,
    new TextEncoder().encode(content),
  );
  if (!ok) return null;

  const timestamp = Number(params.get('timestamp'));
  return {
    rewardedAtMs: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null,
    adUnit: params.get('ad_unit') ?? '',
    transactionId: params.get('transaction_id') ?? '',
    userId: params.get('user_id') ?? '',
    customData: params.get('custom_data') ?? '',
    rewardItem: params.get('reward_item') ?? '',
    rewardAmount: Number(params.get('reward_amount') ?? 0),
  };
}
