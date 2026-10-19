// 광고 보상 — AdMob 서버 확인(SSV) 서명 검증과 적립·사용·환불. 스펙: `docs/spec/ad-rewards.md`.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import {
  derEcdsaToRaw,
  resetAdMobKeyCacheForTest,
  verifyAdMobCallback,
  VERIFIER_KEYS_URL,
} from '../src/lib/admob-ssv';
import {
  AD_REWARD_MONTHLY_LIMIT,
  consumeAdRewardCredit,
  grantAdRewardCredit,
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

  it('모르는 key_id 를 쏟아도 강제 갱신은 간격 안에 한 번뿐이다 — 인증 없는 라우트로 바깥 요청을 부풀리지 못한다', async () => {
    await verifyAdMobCallback(await signedQuery(CALLBACK), fetchKeys);
    fetchKeys.mockClear();
    for (const id of ['901', '902', '903']) {
      expect(await verifyAdMobCallback(await signedQuery(CALLBACK, id), fetchKeys)).toBeNull();
    }
    expect(fetchKeys).toHaveBeenCalledTimes(1);
    // 알던 키는 그대로 받힌다.
    expect(await verifyAdMobCallback(await signedQuery(CALLBACK), fetchKeys)).not.toBeNull();
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

  it('광고 단위가 설정되지 않았으면 아무것도 적립하지 않는다', async () => {
    const res = await call(await signedQuery(CALLBACK), {
      ...ENV,
      ADMOB_REWARDED_AD_UNITS: undefined,
    });
    expect(await res.json()).toEqual({ granted: false });
  });
});
