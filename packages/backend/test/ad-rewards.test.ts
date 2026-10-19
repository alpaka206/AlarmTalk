// 광고 보상 — AdMob 서버 확인(SSV) 서명 검증과 적립·사용·환불. 스펙: `docs/spec/ad-rewards.md`.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import {
  AdMobKeysBusyError,
  derEcdsaToRaw,
  resetAdMobKeyCacheForTest,
  verifyAdMobCallback,
  VERIFIER_KEYS_URL,
} from '../src/lib/admob-ssv';
import {
  AD_REWARD_MONTHLY_LIMIT,
  consumeAdRewardCredit,
  grantAdRewardCredit,
  grantMonthFor,
  isConfiguredRewardedAdUnit,
  readAdRewardStatus,
  refundAdRewardCredit,
} from '../src/lib/ad-reward-credits';

let db: Client;
vi.mock('../src/lib/db', () => ({ getDB: () => db }));

const USER = '20000000-0000-4000-8000-000000000001';
const KEY_ID = '3335741209';
let keyPair: CryptoKeyPair;
let keysJson: string;

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** r‖s → DER. AdMob 이 보내는 모양을 만들기 위한 테스트 쪽 변환. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.subarray(i);
    if (v[0]! & 0x80) v = Uint8Array.from([0, ...v]);
    return [0x02, v.length, ...v];
  };
  const body = [...int(raw.subarray(0, 32)), ...int(raw.subarray(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}

async function signedQuery(params: Record<string, string>, keyId = KEY_ID): Promise<string> {
  const content = new URLSearchParams(params).toString();
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keyPair.privateKey,
      new TextEncoder().encode(content),
    ),
  );
  return `${content}&signature=${b64url(rawToDer(raw))}&key_id=${keyId}`;
}

const fetchKeys = vi.fn(async (url: string) => {
  expect(url).toBe(VERIFIER_KEYS_URL);
  return new Response(keysJson, { status: 200 });
});

const CALLBACK = {
  ad_network: '5450213213286189855',
  ad_unit: '1234567890',
  custom_data: '',
  reward_amount: '1',
  reward_item: 'manual_tts',
  timestamp: '1760860000000',
  transaction_id: 'tx-abc',
  user_id: USER,
};

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  keysJson = JSON.stringify({
    keys: [{ keyId: Number(KEY_ID), pem: 'unused', base64: b64(spki) }],
  });
});

beforeEach(async () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date'] });
  resetAdMobKeyCacheForTest();
  fetchKeys.mockClear();
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  await db.execute({
    sql: `INSERT INTO users (id, email, name, plan) VALUES (?, 'f@example.com', '무료', 'free')`,
    args: [USER],
  });
}, 60_000);

describe('derEcdsaToRaw', () => {
  it('앞의 0x00 을 떼고 짧은 정수는 왼쪽을 채운다', () => {
    const r = new Uint8Array(32).fill(0x81); // 최상위 비트 → DER 에서 0x00 이 붙는다
    const s = new Uint8Array(32);
    s[31] = 7; // 작은 값 → DER 에서 1바이트
    const raw = derEcdsaToRaw(rawToDer(Uint8Array.from([...r, ...s])));
    expect(raw).not.toBeNull();
    expect(Array.from(raw!.subarray(0, 32))).toEqual(Array.from(r));
    expect(Array.from(raw!.subarray(32))).toEqual(Array.from(s));
  });

  it('DER 가 아니면 null', () => {
    expect(derEcdsaToRaw(new Uint8Array(64))).toBeNull();
    expect(derEcdsaToRaw(Uint8Array.from([0x30, 0x02, 0x02, 0x00]))).toBeNull();
  });
});

describe('verifyAdMobCallback', () => {
  it('맞는 서명이면 파라미터를 돌려준다', async () => {
    const parsed = await verifyAdMobCallback(await signedQuery(CALLBACK), fetchKeys);
    expect(parsed).toMatchObject({ adUnit: '1234567890', transactionId: 'tx-abc', userId: USER });
  });

  it('서명 뒤에 값을 바꾸면 거절한다', async () => {
    const q = (await signedQuery(CALLBACK)).replace(`user_id=${USER}`, 'user_id=someone-else');
    expect(await verifyAdMobCallback(q, fetchKeys)).toBeNull();
  });

  it('모르는 key_id 는 키 목록을 한 번 다시 받아 보고 그래도 없으면 거절한다', async () => {
    await verifyAdMobCallback(await signedQuery(CALLBACK), fetchKeys); // 캐시를 채운다
    fetchKeys.mockClear();
    expect(await verifyAdMobCallback(await signedQuery(CALLBACK, '999'), fetchKeys)).toBeNull();
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  it('같은 가짜 key_id 를 되풀이해도 바깥 요청은 한 번뿐이다', async () => {
    await verifyAdMobCallback(await signedQuery(CALLBACK), fetchKeys);
    fetchKeys.mockClear();
    vi.setSystemTime(Date.now() + 3_000);
    expect(await verifyAdMobCallback(await signedQuery(CALLBACK, '901'), fetchKeys)).toBeNull();
    vi.setSystemTime(Date.now() + 3_000);
    expect(await verifyAdMobCallback(await signedQuery(CALLBACK, '901'), fetchKeys)).toBeNull();
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  it('다른 key_id 의 강제 갱신은 2초에 한 번 — 그 사이는 거절이 아니라 다시 부르라는 답이다', async () => {
    await verifyAdMobCallback(await signedQuery(CALLBACK), fetchKeys);
    fetchKeys.mockClear();
    vi.setSystemTime(Date.now() + 3_000);
    expect(await verifyAdMobCallback(await signedQuery(CALLBACK, '901'), fetchKeys)).toBeNull();
    await expect(
      verifyAdMobCallback(await signedQuery(CALLBACK, '902'), fetchKeys),
    ).rejects.toBeInstanceOf(AdMobKeysBusyError);
    expect(fetchKeys).toHaveBeenCalledTimes(1);
    // 알던 키는 그 사이에도 그대로 받힌다.
    expect(await verifyAdMobCallback(await signedQuery(CALLBACK), fetchKeys)).not.toBeNull();
  });

  it('키가 교체되면 새 key_id 의 첫 콜백이 목록을 다시 받아 받힌다', async () => {
    await verifyAdMobCallback(await signedQuery(CALLBACK), fetchKeys); // 옛 목록(KEY_ID 하나)을 캐시
    const rotated = JSON.parse(keysJson) as { keys: Array<Record<string, unknown>> };
    rotated.keys.push({ ...rotated.keys[0], keyId: 4444 });
    const fetchRotated = vi.fn(async () => new Response(JSON.stringify(rotated), { status: 200 }));
    vi.setSystemTime(Date.now() + 3_000);
    expect(
      await verifyAdMobCallback(await signedQuery(CALLBACK, '4444'), fetchRotated),
    ).not.toBeNull();
    expect(fetchRotated).toHaveBeenCalledTimes(1);
  });

  it('강제 갱신이 일시 장애로 실패하면 간격을 재지 않는다 — AdMob 의 재시도가 다시 갱신해 받힌다', async () => {
    await verifyAdMobCallback(await signedQuery(CALLBACK), fetchKeys); // 캐시를 채운다
    const flaky = vi.fn(async () => new Response('', { status: 503 }));
    await expect(verifyAdMobCallback(await signedQuery(CALLBACK, '777'), flaky)).rejects.toThrow();
    fetchKeys.mockClear();
    await verifyAdMobCallback(await signedQuery(CALLBACK, '777'), fetchKeys);
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  it('서명된 보상 시각을 함께 돌려준다', async () => {
    const parsed = await verifyAdMobCallback(await signedQuery(CALLBACK), fetchKeys);
    expect(parsed?.rewardedAtMs).toBe(1760860000000);
  });

  it('서명이 없으면 거절한다', async () => {
    expect(
      await verifyAdMobCallback(new URLSearchParams(CALLBACK).toString(), fetchKeys),
    ).toBeNull();
  });

  it('키 목록을 못 받으면 던진다 — 우리 장애를 서명 실패(재시도 없음)로 삼키지 않는다', async () => {
    const down = vi.fn(async () => new Response('', { status: 503 }));
    await expect(verifyAdMobCallback(await signedQuery(CALLBACK), down)).rejects.toThrow();
  });
});

describe('전역 IP 한도', () => {
  it('보상 콜백은 공용 IP 버킷(300)에서 빠지고 전용 버킷이 센다', async () => {
    const { ipRateLimitMiddleware, adRewardCallbackRateLimitMiddleware } =
      await import('../src/middleware/rateLimit');
    const app = new Hono();
    app.use('*', ipRateLimitMiddleware);
    app.use('/api/ads/*', adRewardCallbackRateLimitMiddleware);
    app.get('/api/ads/admob-ssv', (c) => c.text('ok'));
    app.get('/api/other', (c) => c.text('ok'));
    const headers = { 'cf-connecting-ip': '203.0.113.9' };
    for (let i = 0; i < 301; i++) {
      expect((await app.request('/api/ads/admob-ssv', { headers })).status).toBe(200);
    }
    // 같은 IP 의 다른 공개 요청은 여전히 공용 버킷에 묶인다(콜백이 그 버킷을 쓰지 않았다).
    expect((await app.request('/api/other', { headers })).status).toBe(200);
  });
});

describe('워커 설정 동기화', () => {
  it('광고 단위 목록이 secrets:sync 로 올라간다 — 빠지면 동기화가 성공해도 기능이 꺼진 채다(코덱스 #924)', async () => {
    const { WORKER_SECRET_KEYS } = await import('../scripts/worker-secret-keys');
    expect(WORKER_SECRET_KEYS as readonly string[]).toContain('ADMOB_REWARDED_AD_UNITS');
  });
});

describe('isConfiguredRewardedAdUnit', () => {
  it('전체 id 든 뒤 숫자든 받고, 설정이 비면 아무것도 받지 않는다', () => {
    expect(isConfiguredRewardedAdUnit('ca-app-pub-1/1234567890', '1234567890')).toBe(true);
    expect(isConfiguredRewardedAdUnit(' 111 , 1234567890', '1234567890')).toBe(true);
    expect(isConfiguredRewardedAdUnit('ca-app-pub-1/999', '1234567890')).toBe(false);
    expect(isConfiguredRewardedAdUnit(undefined, '1234567890')).toBe(false);
    expect(isConfiguredRewardedAdUnit('', '1234567890')).toBe(false);
  });
});

describe('grantMonthFor', () => {
  const now = Date.UTC(2026, 10, 1, 0, 30); // KST 11월 1일 09:30

  it('보상을 받은 시각의 KST 달로 센다 — 늦게 온 콜백이 다음 달 몫을 먹지 않는다', () => {
    const lastNightKst = Date.UTC(2026, 9, 31, 14, 59); // KST 10월 31일 23:59
    expect(grantMonthFor(lastNightKst, now)).toBe('2026-10');
    expect(grantMonthFor(Date.UTC(2026, 9, 31, 15, 0), now)).toBe('2026-11'); // KST 11월 1일 00:00
  });

  it('시각이 없거나 믿을 범위 밖이면 처리 시각으로 센다', () => {
    expect(grantMonthFor(null, now)).toBe('2026-11');
    expect(grantMonthFor(Date.UTC(2025, 0, 1), now)).toBe('2026-11');
    expect(grantMonthFor(now + 3 * 24 * 60 * 60 * 1000, now)).toBe('2026-11');
  });
});

describe('적립·사용·환불 (실제 SQLite)', () => {
  const grant = (transactionId: string) =>
    grantAdRewardCredit(db, { transactionId, userPk: USER, adUnit: '1234567890' });

  it('같은 거래는 한 번만 적립한다', async () => {
    expect(await grant('tx-1')).toBe(true);
    expect(await grant('tx-1')).toBe(false);
    expect(await readAdRewardStatus(db, USER)).toEqual({
      credits: 1,
      remaining_grants: AD_REWARD_MONTHLY_LIMIT - 1,
      monthly_limit: AD_REWARD_MONTHLY_LIMIT,
    });
  });

  it('한 달 상한을 넘겨 적립하지 않는다', async () => {
    for (let i = 0; i < AD_REWARD_MONTHLY_LIMIT; i++) expect(await grant(`tx-${i}`)).toBe(true);
    expect(await grant('tx-over')).toBe(false);
    expect((await readAdRewardStatus(db, USER)).remaining_grants).toBe(0);
  });

  it('쓰면 하나 줄고, 없으면 null, 돌려주면 다시 쓸 수 있다', async () => {
    await grant('tx-1');
    const used = await consumeAdRewardCredit(db, USER);
    expect(used).toBe('tx-1');
    expect(await consumeAdRewardCredit(db, USER)).toBeNull();
    expect((await readAdRewardStatus(db, USER)).credits).toBe(0);
    await refundAdRewardCredit(db, used!);
    expect((await readAdRewardStatus(db, USER)).credits).toBe(1);
    // 쓴 것도 이번 달 적립으로 센다 — 쓰고 다시 보는 것으로 상한을 비켜 가지 않는다.
    expect((await readAdRewardStatus(db, USER)).remaining_grants).toBe(AD_REWARD_MONTHLY_LIMIT - 1);
  });
});

describe('GET /api/ads/admob-ssv', () => {
  const ENV = {
    JWT_SECRET: 'x',
    PASSWORD_PEPPER: 'x',
    ENVIRONMENT: 'test',
    ADMOB_REWARDED_AD_UNITS: 'ca-app-pub-1/1234567890',
  } as unknown as Env;

  async function call(query: string, env: Env = ENV) {
    const { default: ads } = await import('../src/routes/ads');
    const app = new Hono<AppEnv>();
    app.route('/api/ads', ads);
    return app.request(`/api/ads/admob-ssv?${query}`, undefined, env);
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchKeys);
  });

  it('맞는 콜백이면 적립한다', async () => {
    const res = await call(await signedQuery(CALLBACK));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ granted: true });
    expect((await readAdRewardStatus(db, USER)).credits).toBe(1);
  });

  it('서명이 틀리면 403 이고 적립하지 않는다', async () => {
    const q = (await signedQuery(CALLBACK)).replace('reward_amount=1', 'reward_amount=9');
    const res = await call(q);
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe('AD_REWARD_SIGNATURE_INVALID');
    expect((await readAdRewardStatus(db, USER)).credits).toBe(0);
  });

  it('설정에 없는 광고 단위·없는 계정은 200 으로 받되 적립하지 않는다 — AdMob 의 재시도를 멈춘다', async () => {
    const otherUnit = await call(await signedQuery({ ...CALLBACK, ad_unit: '555' }));
    expect(otherUnit.status).toBe(200);
    expect(await otherUnit.json()).toEqual({ granted: false });

    const noUser = await call(await signedQuery({ ...CALLBACK, user_id: '' }));
    expect(noUser.status).toBe(200);
    const ghost = await call(
      await signedQuery({ ...CALLBACK, user_id: '20000000-0000-4000-8000-0000000000ff' }),
    );
    expect(await ghost.json()).toEqual({ granted: false });
    expect((await readAdRewardStatus(db, USER)).credits).toBe(0);
  });

  it('UUID 전환 전의 계정 PK(구글 sub)도 적립한다', async () => {
    const legacy = '108234567890123456789';
    await db.execute({
      sql: `INSERT INTO users (id, email, name, plan) VALUES (?, 'old@example.com', '옛계정', 'free')`,
      args: [legacy],
    });
    const res = await call(
      await signedQuery({ ...CALLBACK, user_id: legacy, transaction_id: 'tx-legacy' }),
    );
    expect(await res.json()).toEqual({ granted: true });
    expect((await readAdRewardStatus(db, legacy)).credits).toBe(1);
  });

  it('유료 계정에는 적립하지 않는다 — 고친 앱이 유료일 때 쌓아 두었다가 해지 뒤에 쓰지 못한다', async () => {
    await db.execute({ sql: `UPDATE users SET plan = 'plus' WHERE id = ?`, args: [USER] });
    const res = await call(await signedQuery(CALLBACK));
    expect(await res.json()).toEqual({ granted: false });
    expect((await readAdRewardStatus(db, USER)).credits).toBe(0);
  });

  it('키 목록을 방금 다시 받았으면 429 로 다시 부르게 한다', async () => {
    await call(await signedQuery({ ...CALLBACK, transaction_id: 'warm' })); // 캐시를 채운다
    vi.setSystemTime(Date.now() + 3_000);
    await call(await signedQuery(CALLBACK, '901')); // 강제 갱신 한 번
    const res = await call(await signedQuery(CALLBACK, '902'));
    expect(res.status).toBe(429);
    expect((await res.json()).error_code).toBe('AD_REWARD_RETRY_LATER');
  });

  it('광고 단위가 설정되지 않았으면 아무것도 적립하지 않는다', async () => {
    const res = await call(await signedQuery(CALLBACK), {
      ...ENV,
      ADMOB_REWARDED_AD_UNITS: undefined,
    });
    expect(await res.json()).toEqual({ granted: false });
  });
});
