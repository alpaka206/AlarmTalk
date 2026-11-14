// **애플 결제 확정 한 번이 워커 subrequest 를 몇 개 쓰는가.**
//
// 워커 한 실행의 subrequest 는 ~50 개이고, DB 왕복 하나·애플 조회 하나가 각각 하나다.
// 확정은 애플을 두 번 묻고(트랜잭션 + 체인 상태, 출시 전에는 각각 프로덕션 → 샌드박스로
// 두 번씩) 쓰기 트랜잭션을 연다. 체인을 넘겨받을 때는 앞 주인의 구독 해지까지 같은
// 트랜잭션에서 한다.
// 한도를 넘기면 트랜잭션이 통째로 롤백되고 **재시도해도 같은 자리에서 죽는다**(2026-09-18
// `DELETE /api/user/me` 가 그렇게 막혔다). 이 테스트는 그 여유가 줄어드는 것을 잡는다.
//
// **운영과 같은 조건으로 잰다** — 푸시가 켜져 있고(FCM, 서명 코드가 실제로 돈다), 사람마다
// 안드로이드 기기 하나·클론 목소리 하나, OAuth 캐시는 매번 비어 있다. 커밋 뒤 알림도 같은 실행의
// subrequest 라 함께 센다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-confirm-subrequests-'));
const raw = createClient({ url: `file:${join(directory, 'test.db')}` });
const counts = { db: 0 };

/** DB 왕복 하나 = subrequest 하나. 트랜잭션은 문장마다 + 커밋 한 번. */
const counted = new Proxy(raw, {
  get(target, prop, receiver) {
    if (prop === 'execute' || prop === 'batch') {
      return async (...args: unknown[]) => {
        counts.db += 1;
        return (target[prop] as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
    if (prop === 'transaction') {
      return async (mode: 'read' | 'write') => {
        const tx = await target.transaction(mode);
        return new Proxy(tx, {
          get(t, p) {
            if (p === 'execute' || p === 'batch' || p === 'commit') {
              return async (...args: unknown[]) => {
                counts.db += 1;
                return (t[p] as (...a: unknown[]) => unknown).apply(t, args);
              };
            }
            const v = Reflect.get(t, p);
            return typeof v === 'function' ? v.bind(t) : v;
          },
        });
      };
    }
    return Reflect.get(target, prop, receiver);
  },
}) as Client;

let latest: Record<string, unknown>;
vi.mock('../src/lib/db', () => ({ getDB: () => counted }));
vi.mock('../src/lib/apple-storekit', async (original) => ({
  ...(await original<typeof import('../src/lib/apple-storekit')>()),
  appleStoreKitConfigFromEnv: () => ({ issuerId: 't', keyId: 't', privateKeyPem: 't', bundleId: 'com.alarmtalk.app' }),
  fetchAppleTransaction: vi.fn(async () => latest),
  fetchAppleSubscriptionStatus: vi.fn(async () => ({
    status: 1, expiresDate: latest.expiresDate, productId: latest.productId, latest,
  })),
}));
import billingApple from '../src/routes/billing-apple';

/** 출시 전 앱: 두 조회가 각각 프로덕션(401) → 샌드박스로 두 번씩 나간다. */
const APPLE_FETCHES = 4;
/** 한도 ~50 에서 **이만큼은 남긴다** — 같은 실행의 로깅·푸시·재시도 여유. */
const BUDGET = 45;

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PERSONAL = '70000000-0000-4000-8000-000000000002';
const DAY = 86_400_000;

let signingKeyPem = '';
let isolate = 0;
/** 나가는 요청(FCM·OAuth) 수 — 애플 조회는 모듈 목이라 `APPLE_FETCHES` 로 따로 더한다. */
let fetches = 0;

async function confirmAs(caller: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('userId', caller); await next(); });
  app.route('/billing', billingApple);
  counts.db = 0;
  fetches = 0;
  // 서비스 계정 이메일을 매번 바꿔 OAuth 캐시를 비운다(새 isolate 와 같다).
  const env = {
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: `svc-${++isolate}@test-project.iam.gserviceaccount.com`,
      private_key: signingKeyPem,
    }),
  };
  const res = await app.request('/billing/apple/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: 'tx-new' }),
  }, env);
  return { status: res.status, subrequests: counts.db + fetches + APPLE_FETCHES };
}

/** 사람마다 안드로이드 기기 하나(커밋 뒤 알림 대상). */
async function giveDevices(users: string[]) {
  for (const u of users) {
    await raw.execute({
      sql: `INSERT INTO push_tokens (id, user_id, token, platform) VALUES (?, ?, ?, 'android')`,
      args: [`pt-${u}`, u, `tok-${u}`],
    });
  }
}

async function seedChain(owner: string, planId: string) {
  await raw.execute({
    sql: `INSERT INTO subscriptions (id,user_id,plan_id,status,starts_at,expires_at)
          VALUES ('sub-owner', ?, ?, 'active', datetime('now','-3 days'), ?)`,
    args: [owner, planId, new Date(Date.now() + 27 * DAY).toISOString()],
  });
  await raw.execute({
    sql: `INSERT INTO store_transactions
            (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id,expires_at,last_paid_at)
          VALUES ('st-owner', ?, 'apple', 'chain-1', 'com.alarmtalk.app.personal_monthly', 'personal', 'sub-owner', ?, datetime('now','-3 days'))`,
    args: [owner, new Date(Date.now() + 27 * DAY).toISOString()],
  });
}

beforeAll(async () => {
  await runMigrations(raw);
  const keys = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const b64 = btoa(String.fromCharCode(...pkcs8));
  signingKeyPem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    fetches += 1;
    if (new URL(String(url)).hostname === 'oauth2.googleapis.com') {
      return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});
beforeEach(async () => {
  vi.clearAllMocks();
  for (const table of [
    'store_transactions', 'paid_voice_retention', 'pending_external_deletions', 'push_tokens', 'voice_profiles',
    'subscriptions',
  ]) await raw.execute(`DELETE FROM ${table}`);
  const everyone = [A, B];
  await raw.execute({ sql: `DELETE FROM users WHERE id IN (${everyone.map(() => '?').join(',')})`, args: everyone });
  for (const id of everyone) {
    await raw.execute({ sql: `INSERT INTO users (id,email) VALUES (?,?)`, args: [id, `${id}@example.test`] });
  }
  await giveDevices(everyone);
  // 사는 사람도 클론이 있다(예전 결제로 만든 목소리).
  await raw.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id) VALUES ('vp-b', ?, 'v', 'el-b')`,
    args: [B],
  });
  latest = {
    transactionId: 'tx-new', originalTransactionId: 'chain-1',
    productId: 'com.alarmtalk.app.personal_monthly', bundleId: 'com.alarmtalk.app',
    purchaseDate: Date.now(), expiresDate: Date.now() + 30 * DAY, appAccountToken: B,
  };
});
afterAll(() => { vi.unstubAllGlobals(); raw.close(); rmSync(directory, { recursive: true, force: true }); });

describe('애플 확정의 subrequest 수', () => {
  it('처음 사는 결제', async () => {
    const { status, subrequests } = await confirmAs(B);
    expect(status).toBe(200);
    console.log(expect.getState().currentTestName, 'subrequests =', subrequests);
    expect(subrequests).toBeLessThanOrEqual(BUDGET);
  });

  it('개인 구독 중인 앞 주인에게서 넘겨받기', async () => {
    await seedChain(A, PERSONAL);
    await raw.execute({ sql: `UPDATE users SET plan = 'plus' WHERE id = ?`, args: [A] });
    const { status, subrequests } = await confirmAs(B);
    expect(status).toBe(200);
    console.log(expect.getState().currentTestName, 'subrequests =', subrequests);
    expect(subrequests).toBeLessThanOrEqual(BUDGET);
  });

  it('개인 소유자의 같은 플랜 갱신 — 매달 도는 경로', async () => {
    await seedChain(A, PERSONAL);
    await raw.execute({ sql: `UPDATE users SET plan = 'plus' WHERE id = ?`, args: [A] });
    const renewedUntil = Date.now() + 57 * DAY;
    latest = { ...latest, appAccountToken: A, transactionId: 'tx-renew', expiresDate: renewedUntil };
    const { status, subrequests } = await confirmAs(A);
    expect(status).toBe(200);
    const row = await raw.execute(`SELECT user_id, expires_at FROM subscriptions WHERE id = 'sub-owner'`);
    expect(String(row.rows[0]!.user_id)).toBe(A);
    expect(Date.parse(String(row.rows[0]!.expires_at))).toBe(renewedUntil);
    console.log(expect.getState().currentTestName, 'subrequests =', subrequests);
    expect(subrequests).toBeLessThanOrEqual(BUDGET);
  });
});
