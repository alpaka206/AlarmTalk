// **끝난 구독 체인은 새로 결제한 계정이 넘겨받는다**(2026-09-19 운영 재현).
//
// 애플은 한 App Store 계정의 구독을 같은 체인(`originalTransactionId`)으로 잇는다. A 계정의
// 구독이 끝난 뒤 같은 애플 계정으로 B 계정이 새로 결제하면 **B 의 표식이 박힌 새 트랜잭션이
// 옛 체인 id 로** 올라온다. 예전에는 체인을 먼저 가져간 A 가 영원한 주인이라 B 는 늘 409 였다
// — 돈은 나갔는데 권한이 안 붙고, 앱은 StoreKit 을 믿어 유료처럼 보이는데 서버는 무료라
// 목소리 등록에서 「해당 기능은 유료 이용권에서 사용할 수 있어요」 가 떴다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-chain-transfer-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
let info: Record<string, unknown>;
/** 애플이 말하는 **체인의 가장 최근 트랜잭션**. 비워 두면 앱이 보낸 것이 곧 최신이다. */
let latest: Record<string, unknown> | null = null;
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
vi.mock('../src/lib/apple-storekit', async (original) => ({
  ...(await original<typeof import('../src/lib/apple-storekit')>()),
  appleStoreKitConfigFromEnv: () => ({ issuerId: 't', keyId: 't', privateKeyPem: 't', bundleId: 'com.alarmtalk.app' }),
  fetchAppleTransaction: vi.fn(async () => info),
  fetchAppleSubscriptionStatus: vi.fn(async () => {
    const tx = latest ?? info;
    return { status: 1, expiresDate: tx.expiresDate, productId: tx.productId, latest: tx };
  }),
}));
import billingApple from '../src/routes/billing-apple';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PERSONAL = '70000000-0000-4000-8000-000000000002';

async function confirm(caller: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('userId', caller); await next(); });
  app.route('/billing', billingApple);
  return app.request('/billing/apple/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: 'tx-new' }),
  }, {});
}

async function seedChainOwnedByA(expiresAtIso: string) {
  await db.execute({
    sql: `INSERT INTO subscriptions (id,user_id,plan_id,status,starts_at,expires_at)
          VALUES ('sub-a', ?, ?, 'active', datetime('now','-40 days'), ?)`,
    args: [A, PERSONAL, expiresAtIso],
  });
  await db.execute({
    sql: `INSERT INTO store_transactions
            (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id,expires_at,last_paid_at)
          VALUES ('st-a', ?, 'apple', 'chain-1', 'com.alarmtalk.app.personal_monthly', 'personal', 'sub-a', ?, datetime('now','-40 days'))`,
    args: [A, expiresAtIso],
  });
  await db.execute({ sql: `UPDATE users SET plan = 'plus' WHERE id = ?`, args: [A] });
}

beforeAll(async () => { await runMigrations(db); });
beforeEach(async () => {
  vi.clearAllMocks();
  latest = null;
  for (const table of ['store_transactions', 'subscriptions']) await db.execute(`DELETE FROM ${table}`);
  await db.execute({ sql: `DELETE FROM users WHERE id IN (?, ?)`, args: [A, B] });
  await db.execute({
    sql: `INSERT INTO users (id,email,name) VALUES (?,?,?),(?,?,?)`,
    args: [A, 'a@example.test', 'a', B, 'b@example.test', 'b'],
  });
  info = {
    transactionId: 'tx-new', originalTransactionId: 'chain-1',
    productId: 'com.alarmtalk.app.personal_monthly', purchaseDate: Date.now(),
    expiresDate: Date.now() + 30 * 86_400_000,
    bundleId: 'com.alarmtalk.app', appAccountToken: B,
  };
});
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe('애플 구독 체인의 소유권 — 주인은 애플이 정한다', () => {
  it('앞 주인의 기간이 끝났고 애플이 새 결제를 B 로 찍었으면 B 가 넘겨받는다', async () => {
    await seedChainOwnedByA(new Date(Date.now() - 86_400_000).toISOString());
    const res = await confirm(B);
    expect(res.status).toBe(200);
    const owners = await db.execute(`SELECT user_id FROM store_transactions WHERE provider_transaction_id = 'chain-1'`);
    expect(owners.rows.map((r) => String(r.user_id))).toEqual([B]);
    const plans = await db.execute({ sql: `SELECT id, plan FROM users WHERE id IN (?, ?) ORDER BY id`, args: [A, B] });
    // 앞 주인은 무료로 내려가고, 새 결제자는 개인(plus)이 된다.
    expect(plans.rows.map((r) => `${String(r.id).slice(0, 1)}=${r.plan}`)).toEqual(['a=free', 'b=plus']);
  });

  it('앞 주인의 기간이 DB 에 남아 있어도, 애플이 지금 결제를 B 로 찍었으면 B 것이다', async () => {
    // ⚠ 예전에는 여기서 409 였다. 그 "남은 기간" 은 **우리 DB 의 사본**이다 — A 가 구독 중인
    //   폰에서 B 가 상위 플랜을 사면 애플은 B 에게 청구하고 같은 체인으로 올려 보낸다.
    //   DB 를 근거로 막으면 돈은 나가고 권한은 안 붙는다.
    await seedChainOwnedByA(new Date(Date.now() + 10 * 86_400_000).toISOString());
    const res = await confirm(B);
    expect(res.status).toBe(200);
    const owners = await db.execute(`SELECT user_id FROM store_transactions WHERE provider_transaction_id = 'chain-1'`);
    expect(owners.rows.map((r) => String(r.user_id))).toEqual([B]);
    // 앞 주인의 그 구독은 **정상 해지**로 닫히고 등급이 내려간다(행만 바꾸면 그룹이 남는다).
    const previous = await db.execute(`SELECT status FROM subscriptions WHERE id = 'sub-a'`);
    expect(String(previous.rows[0]!.status)).not.toBe('active');
    const plans = await db.execute({ sql: `SELECT id, plan FROM users WHERE id IN (?, ?) ORDER BY id`, args: [A, B] });
    expect(plans.rows.map((r) => `${String(r.id).slice(0, 1)}=${r.plan}`)).toEqual(['a=free', 'b=plus']);
  });

  it('B 가 옛 영수증을 올려도, 애플의 최신 결제가 A 것이면 A 의 구독이다', async () => {
    // 표식은 **체인의 최신 트랜잭션**에서 읽는다. 보낸 트랜잭션의 표식을 읽으면, 이미 A 에게
    // 넘어간 체인을 B 가 예전에 자기가 샀던 영수증으로 도로 가져간다.
    await seedChainOwnedByA(new Date(Date.now() + 10 * 86_400_000).toISOString());
    latest = { ...info, transactionId: 'tx-latest-a', appAccountToken: A };
    const res = await confirm(B);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error_code: 'TRANSACTION_ACCOUNT_MISMATCH' });
    const owners = await db.execute(`SELECT user_id FROM store_transactions WHERE provider_transaction_id = 'chain-1'`);
    expect(owners.rows.map((r) => String(r.user_id))).toEqual([A]);
    const plan = await db.execute({ sql: `SELECT plan FROM users WHERE id = ?`, args: [A] });
    expect(String(plan.rows[0]!.plan)).toBe('plus');
  });
});
