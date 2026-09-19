// **애플 결제 확정 한 번이 워커 subrequest 를 몇 개 쓰는가.**
//
// 워커 한 실행의 subrequest 는 ~50 개이고, DB 왕복 하나·애플 조회 하나가 각각 하나다.
// 확정은 애플을 두 번 묻고(트랜잭션 + 체인 상태, 출시 전에는 각각 프로덕션 → 샌드박스로
// 두 번씩) 쓰기 트랜잭션을 연다. 체인을 넘겨받을 때는 앞 주인의 구독 해지까지 같은
// 트랜잭션에서 한다 — 앞 주인이 가족 그룹 소유자면 멤버 전원이 함께 내려간다.
// 한도를 넘기면 트랜잭션이 통째로 롤백되고 **재시도해도 같은 자리에서 죽는다**(2026-09-18
// `DELETE /api/user/me` 가 그렇게 막혔다). 이 테스트는 그 여유가 줄어드는 것을 잡는다.
//
// **운영과 같은 조건으로 잰다** — 푸시가 켜져 있고(FCM, 서명 코드가 실제로 돈다), 사람마다
// 안드로이드 기기 하나·클론 목소리 하나, 가족 초대 코드는 네 번 쓰였고, OAuth 캐시는 매번
// 비어 있다. 커밋 뒤 알림도 같은 실행의 subrequest 라 함께 센다.
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
const MEMBERS = [1, 2, 3, 4].map((n) => `dddddddd-dddd-4ddd-8ddd-00000000000${n}`);
const PERSONAL = '70000000-0000-4000-8000-000000000002';
const FAMILY = '70000000-0000-4000-8000-000000000003';
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

async function seedChain(owner: string, planId: string, groupId: string | null) {
  await raw.execute({
    sql: `INSERT INTO subscriptions (id,user_id,plan_id,plan_group_id,status,starts_at,expires_at)
          VALUES ('sub-owner', ?, ?, ?, 'active', datetime('now','-3 days'), ?)`,
    args: [owner, planId, groupId, new Date(Date.now() + 27 * DAY).toISOString()],
  });
  await raw.execute({
    sql: `INSERT INTO store_transactions
            (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id,expires_at,last_paid_at)
          VALUES ('st-owner', ?, 'apple', 'chain-1', 'com.alarmtalk.app.personal_monthly', 'personal', 'sub-owner', ?, datetime('now','-3 days'))`,
    args: [owner, new Date(Date.now() + 27 * DAY).toISOString()],
  });
}

/** A 가 가족 그룹(멤버 4명)의 소유자이고, 체인 `chain-1` 이 그 가족 구독이다. */
async function seedFamilyOwnedBy(owner: string) {
  await raw.execute({
    sql: `INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members) VALUES ('g1', ?, ?, 5)`,
    args: [owner, FAMILY],
  });
  await seedChain(owner, FAMILY, 'g1');
  await raw.execute({ sql: `UPDATE store_transactions SET product_id = 'com.alarmtalk.app.family_monthly', plan_key = 'family' WHERE id = 'st-owner'` });
  await raw.execute({ sql: `UPDATE users SET plan = 'family' WHERE id = ?`, args: [owner] });
  await raw.execute({
    sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES ('m0', 'g1', ?, 'owner')`,
    args: [owner],
  });
  await raw.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id) VALUES ('vp-owner', ?, 'v', 'el-owner')`,
    args: [owner],
  });
  // 가족 초대 코드 — 멤버 넷이 썼다.
  await raw.execute({
    sql: `INSERT INTO voucher_codes (id, code, code_hash, plan_id, issuer_user_id, issuer_subscription_id, status, expires_at, max_uses)
          VALUES ('inv', 'INV-1', 'h-inv', ?, ?, 'sub-owner', 'used', datetime('now','+27 days'), 4)`,
    args: [FAMILY, owner],
  });
  for (const [i, m] of MEMBERS.entries()) {
    await raw.execute({
      sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id) VALUES (?, 'g1', ?)`,
      args: [`m${i + 1}`, m],
    });
    await raw.execute({
      sql: `INSERT INTO voucher_redemptions (id, voucher_id, user_id) VALUES (?, 'inv', ?)`,
      args: [`vr-${i + 1}`, m],
    });
    await raw.execute({
      sql: `INSERT INTO subscriptions (id,user_id,plan_id,plan_group_id,status,starts_at,expires_at)
            VALUES (?, ?, ?, 'g1', 'active', datetime('now','-3 days'), datetime('now','+27 days'))`,
      args: [`sub-m${i + 1}`, m, FAMILY],
    });
    await raw.execute({ sql: `UPDATE users SET plan = 'family' WHERE id = ?`, args: [m] });
    // 멤버마다 클론 목소리 하나 — 무료로 내려가면 반납 큐에 들어간다.
    await raw.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id) VALUES (?, ?, 'v', ?)`,
      args: [`vp-m${i + 1}`, m, `el-m${i + 1}`],
    });
  }
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
    if (String(url).includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});
beforeEach(async () => {
  vi.clearAllMocks();
  for (const table of [
    'store_transactions', 'voucher_redemptions', 'voucher_codes', 'paid_voice_retention', 'pending_external_deletions',
    'push_tokens', 'voice_profiles', 'plan_group_members', 'subscriptions', 'plan_groups',
  ]) await raw.execute(`DELETE FROM ${table}`);
  const everyone = [A, B, ...MEMBERS];
  await raw.execute({ sql: `DELETE FROM users WHERE id IN (${everyone.map(() => '?').join(',')})`, args: everyone });
  for (const id of everyone) {
    await raw.execute({ sql: `INSERT INTO users (id,email,name) VALUES (?,?,?)`, args: [id, `${id}@example.test`, 'u'] });
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
    await seedChain(A, PERSONAL, null);
    await raw.execute({ sql: `UPDATE users SET plan = 'plus' WHERE id = ?`, args: [A] });
    const { status, subrequests } = await confirmAs(B);
    expect(status).toBe(200);
    console.log(expect.getState().currentTestName, 'subrequests =', subrequests);
    expect(subrequests).toBeLessThanOrEqual(BUDGET);
  });

  // 예전에는 81 이었다 — 그룹 해체(`disbandOwnedPlanGroup`)가 멤버마다 조회·강등·클론
  //   반납·보관 기한을 따로 왕복했다. 지금은 멤버 수와 무관하게 읽기 한 번·쓰기 한 번이다.
  it('가족 그룹(멤버 4명) 소유자에게서 넘겨받기 — 가장 무거운 경우', async () => {
    await seedFamilyOwnedBy(A);
    const { status, subrequests } = await confirmAs(B);
    expect(status).toBe(200);
    console.log(expect.getState().currentTestName, 'subrequests =', subrequests);
    // 앞 주인과 멤버 전원이 내려가고, 무료가 된 사람마다 보관 기한이 걸린다.
    const plans = await raw.execute(`SELECT plan FROM users WHERE plan = 'family'`);
    expect(plans.rows).toHaveLength(0);
    const retention = await raw.execute(`SELECT user_id FROM paid_voice_retention`);
    expect(retention.rows.map((r) => String(r.user_id)).sort()).toEqual([A, ...MEMBERS].sort());
    expect(subrequests).toBeLessThanOrEqual(BUDGET);
  });
  it('가족 소유자의 같은 플랜 갱신(멤버 4명) — 매달 도는 경로', async () => {
    await seedFamilyOwnedBy(A);
    latest = {
      ...latest, appAccountToken: A, transactionId: 'tx-renew',
      productId: 'com.alarmtalk.app.family_monthly', expiresDate: Date.now() + 57 * DAY,
    };
    const { status, subrequests } = await confirmAs(A);
    expect(status).toBe(200);
    console.log(expect.getState().currentTestName, 'subrequests =', subrequests);
    expect(subrequests).toBeLessThanOrEqual(BUDGET);
  });

  it('가족 소유자 본인이 개인으로 전환(멤버 4명 해체)', async () => {
    await seedFamilyOwnedBy(A);
    latest = { ...latest, appAccountToken: A, transactionId: 'tx-down' };
    const { status, subrequests } = await confirmAs(A);
    expect(status).toBe(200);
    // 멤버는 전원 무료로 내려가고 클론을 반납한다(음성 데이터는 보관 기한까지 남는다).
    const members = await raw.execute({
      sql: `SELECT plan FROM users WHERE id IN (${MEMBERS.map(() => '?').join(',')})`, args: MEMBERS,
    });
    expect(members.rows.map((r) => String(r.plan))).toEqual(['free', 'free', 'free', 'free']);
    const queued = await raw.execute(`SELECT ref FROM pending_external_deletions ORDER BY ref`);
    // 멤버 넷의 클론은 반납된다. (소유자 본인 것은 여기서 단언하지 않는다 — 전환 중 잠깐 무료로
    // 판정돼 반납되는 문제가 따로 있다. 이 테스트가 그 동작을 굳히지 않게 한다.)
    expect(queued.rows.map((r) => String(r.ref))).toEqual(
      expect.arrayContaining(['el-m1', 'el-m2', 'el-m3', 'el-m4']),
    );
    console.log(expect.getState().currentTestName, 'subrequests =', subrequests);
    expect(subrequests).toBeLessThanOrEqual(BUDGET);
  });
});
