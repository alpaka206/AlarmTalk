// **애플 결제 확정은 앱이 보낸 트랜잭션이 아니라 _체인의 현재 상태_ 로 판정한다**
// (`docs/spec/billing-lifecycle.md` 「애플 결제 확정」, 2026-09-20).
//
// 앱이 올리는 id 는 애플이 **재전달한 옛 갱신**일 수 있다. 그 한 건만 보면 체인은 살아
// 있는데 `SUBSCRIPTION_EXPIRED` 로 거절한다 — 2026-09-19 운영에서 돈을 내는 사용자가
// "결제가 한 번에 안 된다" 로 겪었다. 어느 트랜잭션이 올라오든 답이 같아야 한다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-chain-authority-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
/** 앱이 올린 트랜잭션. */
let sent: Record<string, unknown>;
/** 애플이 말하는 체인의 현재 상태. `Error` 면 조회가 그 오류로 실패한다. */
let chain: Record<string, unknown> | Error;

vi.mock('../src/lib/db', () => ({ getDB: () => db }));
vi.mock('../src/lib/apple-storekit', async (original) => ({
  ...(await original<typeof import('../src/lib/apple-storekit')>()),
  appleStoreKitConfigFromEnv: () => ({ issuerId: 't', keyId: 't', privateKeyPem: 't', bundleId: 'com.alarmtalk.app' }),
  fetchAppleTransaction: vi.fn(async () => sent),
  fetchAppleSubscriptionStatus: vi.fn(async () => {
    if (chain instanceof Error) throw chain;
    return chain;
  }),
}));
import billingApple from '../src/routes/billing-apple';
import { AppleTransactionNotFoundError } from '../src/lib/apple-storekit';

const USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DAY = 86_400_000;

function transaction(over: Record<string, unknown> = {}) {
  return {
    transactionId: 'tx-latest', originalTransactionId: 'chain-9',
    productId: 'com.alarmtalk.app.personal_monthly', bundleId: 'com.alarmtalk.app',
    purchaseDate: Date.now() - DAY, expiresDate: Date.now() + 29 * DAY,
    appAccountToken: USER, ...over,
  };
}

async function confirm() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('userId', USER); await next(); });
  app.route('/billing', billingApple);
  return app.request('/billing/apple/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: String(sent.transactionId) }),
  }, {});
}

async function userPlan() {
  const res = await db.execute({ sql: `SELECT plan FROM users WHERE id = ?`, args: [USER] });
  return String(res.rows[0]!.plan);
}

beforeAll(async () => { await runMigrations(db); });
beforeEach(async () => {
  vi.clearAllMocks();
  // 자식부터 지운다 — 가족 플랜 확정은 그룹·멤버·초대 코드를 함께 만든다.
  for (const table of [
    'store_transactions', 'voucher_codes', 'plan_group_members', 'subscriptions', 'plan_groups',
  ]) await db.execute(`DELETE FROM ${table}`);
  await db.execute({ sql: `DELETE FROM users WHERE id = ?`, args: [USER] });
  await db.execute({ sql: `INSERT INTO users (id,email,name) VALUES (?,?,?)`, args: [USER, 'c@example.test', 'c'] });
});
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe('애플 확정 — 체인의 현재 상태가 권위다', () => {
  it('앱이 **이미 만료된 옛 갱신**을 올려도, 체인이 살아 있으면 최신 결제로 붙인다', async () => {
    const latest = transaction();
    sent = transaction({ transactionId: 'tx-old', purchaseDate: Date.now() - 40 * DAY, expiresDate: Date.now() - 10 * DAY });
    chain = { status: 1, expiresDate: latest.expiresDate, productId: latest.productId, latest };
    const res = await confirm();
    expect(res.status).toBe(200);
    expect(await userPlan()).toBe('plus');
    const row = await db.execute(`SELECT expires_at FROM subscriptions WHERE status = 'active'`);
    // 옛 영수증의 만료가 아니라 **애플이 말한 지금 기간의 끝**이다.
    expect(Date.parse(String(row.rows[0]!.expires_at))).toBe(latest.expiresDate);
  });

  it.each([[2, 'EXPIRED'], [5, 'REVOKED'], [3, 'IN_BILLING_RETRY']])(
    '애플이 끝났다고 하면(%i %s) 보낸 영수증이 멀쩡해 보여도 유료로 올리지 않는다',
    async (status) => {
      sent = transaction();
      chain = { status, expiresDate: sent.expiresDate, productId: sent.productId, latest: sent };
      const res = await confirm();
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error_code: 'SUBSCRIPTION_EXPIRED' });
      expect(await userPlan()).toBe('free');
    },
  );

  it('유예 중이면 결제된 기간의 끝이 아니라 **유예의 끝**까지 준다', async () => {
    const graceEnds = Date.now() + 3 * DAY;
    sent = transaction({ expiresDate: Date.now() - DAY });
    chain = { status: 4, expiresDate: sent.expiresDate, gracePeriodExpiresDate: graceEnds, productId: sent.productId, latest: sent };
    const res = await confirm();
    expect(res.status).toBe(200);
    const row = await db.execute(`SELECT expires_at FROM subscriptions WHERE status = 'active'`);
    expect(Date.parse(String(row.rows[0]!.expires_at))).toBe(graceEnds);
  });

  it('상위 플랜으로 갈아탔으면 보낸 영수증의 상품이 아니라 **최신 상품**으로 붙인다', async () => {
    const latest = transaction({ productId: 'com.alarmtalk.app.family_monthly' });
    sent = transaction({ transactionId: 'tx-personal' });
    chain = { status: 1, expiresDate: latest.expiresDate, productId: latest.productId, latest };
    const res = await confirm();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ plan_key: 'family' });
    expect(await userPlan()).toBe('family');
  });

  it('애플에 못 물어봤으면 판정한 척하지 않는다 — 재시도 가능한 502, DB 무변경', async () => {
    sent = transaction();
    chain = new Error('Apple down');
    const res = await confirm();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error_code: 'APPLE_VERIFICATION_FAILED' });
    expect(await userPlan()).toBe('free');
    expect((await db.execute(`SELECT 1 FROM store_transactions`)).rows).toHaveLength(0);
  });

  it('모르는 상태값도 502 다 — 권한 부여 근거도 거절 근거도 아니다', async () => {
    sent = transaction();
    chain = { status: 99, expiresDate: sent.expiresDate, productId: sent.productId, latest: sent };
    const res = await confirm();
    expect(res.status).toBe(502);
    expect(await userPlan()).toBe('free');
  });

  it('유효하다는데 끝 시각이 과거면 502 다 — 언제까지 줄지 모르는 채로 주지 않는다', async () => {
    sent = transaction({ expiresDate: Date.now() - 1000 });
    chain = { status: 1, expiresDate: sent.expiresDate, productId: sent.productId, latest: sent };
    const res = await confirm();
    expect(res.status).toBe(502);
    expect(await userPlan()).toBe('free');
  });

  it('상태 API 에 체인이 없으면 보낸 트랜잭션으로 판정한다(예전 동작)', async () => {
    sent = transaction();
    chain = new AppleTransactionNotFoundError();
    const res = await confirm();
    expect(res.status).toBe(200);
    expect(await userPlan()).toBe('plus');
  });
});
