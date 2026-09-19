// **표식의 주인이 사라진 결제는 새 계정이 이어받는다**(2026-09-19).
//
// 애플 구독은 App Store 계정에 달려 있어 앱 계정을 지워도 계속 갱신된다. 그래서 탈퇴했다가
// 같은 사람이 다시 가입하면 그 구독을 영원히 되찾을 수 없었다 — 애플은 "이미 구독 중" 이라
// 새 결제를 만들지 않고, 서버는 `appAccountToken` 이 다르다며 403 으로 막는다. 사용자가 할
// 수 있는 일이 없어 실제로 갇혔다(2026-09-18 실기기).
//
// 주인이 **살아 있을 때만** 막는 것이 이 검사의 본래 뜻이다. 선물(소모성)은 값을 새로
// 발행하는 일이라 예외로 계속 막는다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-orphan-binding-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
const purchasedAt = Date.now();
let info: Record<string, unknown>;
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
vi.mock('../src/lib/apple-storekit', async (original) => ({
  ...(await original<typeof import('../src/lib/apple-storekit')>()),
  appleStoreKitConfigFromEnv: () => ({ issuerId: 't', keyId: 't', privateKeyPem: 't', bundleId: 'com.alarmtalk.app' }),
  fetchAppleTransaction: vi.fn(async () => info),
  fetchAppleSubscriptionStatus: vi.fn(async () => ({ status: 1, expiresDate: purchasedAt + 30 * 86_400_000 })),
}));
import billingApple from '../src/routes/billing-apple';

const LIVE = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';
const CALLER = '33333333-3333-4333-8333-333333333333';

async function confirm(caller = CALLER) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('userId', caller); await next(); });
  app.route('/billing', billingApple);
  return app.request('/billing/apple/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: 'tx-1' }),
  }, {});
}

beforeAll(async () => { await runMigrations(db); });
beforeEach(async () => {
  vi.clearAllMocks();
  for (const table of ['store_transactions', 'subscriptions']) await db.execute(`DELETE FROM ${table}`);
  await db.execute(`DELETE FROM users WHERE id IN ('${LIVE}', '${CALLER}')`);
  await db.execute(
    `INSERT INTO users (id,email,name) VALUES ('${LIVE}','live@example.test','live'),('${CALLER}','caller@example.test','caller')`,
  );
  info = {
    transactionId: 'tx-1', originalTransactionId: 'orig-1',
    productId: 'com.alarmtalk.app.personal_monthly', purchaseDate: purchasedAt,
    expiresDate: purchasedAt + 30 * 86_400_000,
    bundleId: 'com.alarmtalk.app', appAccountToken: GONE,
  };
});
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe('주인이 사라진 애플 결제', () => {
  it('표식의 계정이 없으면 지금 계정이 이어받는다', async () => {
    const res = await confirm();
    expect(res.status).toBe(200);
    const owners = await db.execute('SELECT user_id FROM store_transactions');
    expect(owners.rows.map((r) => String(r.user_id))).toEqual([CALLER]);
  });

  it('표식의 계정이 살아 있으면 그대로 막는다', async () => {
    info = { ...info, appAccountToken: LIVE };
    const res = await confirm();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error_code: 'TRANSACTION_ACCOUNT_MISMATCH' });
    expect((await db.execute('SELECT * FROM store_transactions')).rows).toEqual([]);
  });

  it('선물(소모성)은 주인이 없어도 막는다 — 값을 새로 발행하는 일이다', async () => {
    info = { ...info, productId: 'com.alarmtalk.app.personal_gift_1m', appAccountToken: GONE };
    const res = await confirm();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error_code: 'TRANSACTION_ACCOUNT_MISMATCH' });
  });
});
