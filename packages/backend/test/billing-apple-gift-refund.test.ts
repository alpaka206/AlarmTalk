import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { migrations, runMigrations } from '../src/lib/migrations';
import { billingRetentionUntil } from '../src/lib/account-deletion';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-gift-refund-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
const purchasedAt = Date.now();
let info: Record<string, unknown>;
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
vi.mock('../src/lib/apple-storekit', async (original) => ({
  ...(await original<typeof import('../src/lib/apple-storekit')>()),
  appleStoreKitConfigFromEnv: () => ({ issuerId: 'test', keyId: 'test', privateKeyPem: 'test', bundleId: 'com.alarmtalk.app' }),
  fetchAppleTransaction: vi.fn(async () => info),
  fetchAppleSubscriptionStatus: vi.fn(async () => { throw new Error('Consumables have no subscription chain'); }),
}));
import { fetchAppleSubscriptionStatus } from '../src/lib/apple-storekit';
import billingApple from '../src/routes/billing-apple';
import userRoutes from '../src/routes/user';

async function confirm(transactionId = 'gift-1', caller = 'owner') {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('userId', caller); await next(); });
  app.route('/billing', billingApple);
  return app.request('/billing/apple/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: transactionId }),
  }, {});
}

async function deleteOwner(caller = 'owner') {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('userId', caller); await next(); });
  app.route('/user', userRoutes);
  return app.request('/user/me', { method: 'DELETE' }, { PASSWORD_PEPPER: 'test-pepper' });
}

const rows = async (sql: string) => (await db.execute(sql)).rows;
beforeAll(async () => { await runMigrations(db); });
beforeEach(async () => {
  vi.clearAllMocks();
  for (const table of ['apple_gift_deliveries', 'voucher_redemptions', 'voucher_codes', 'store_transactions', 'retained_billing_records']) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute("INSERT OR IGNORE INTO users (id,email,name) VALUES ('owner','owner@example.test','owner'),('other','other@example.test','other')");
  info = {
    transactionId: 'gift-1', originalTransactionId: 'not-a-subscription',
    productId: 'com.alarmtalk.app.personal_gift_1m', purchaseDate: purchasedAt,
    bundleId: 'com.alarmtalk.app', appAccountToken: 'owner',
  };
});
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe('Apple 소모성 선물 환불', () => {
  it('발급 연결로 미사용 코드만 만료시키고 재전송은 멱등이며 구독 API를 부르지 않는다', async () => {
    expect((await confirm()).status).toBe(200);
    const before = await rows('SELECT * FROM apple_gift_deliveries');
    expect(before[0]?.voucher_id).toBeTruthy();
    info = { ...info, revocationDate: purchasedAt + 1000 };
    const response = await confirm('gift-1', 'other');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error_code: 'TRANSACTION_REVOKED' });
    expect(await rows('SELECT status FROM voucher_codes')).toEqual([{ status: 'expired' }]);
    const revoked = await rows('SELECT * FROM apple_gift_deliveries');
    expect(revoked[0]?.revoked_at).toBeTruthy();
    expect((await confirm()).status).toBe(400);
    expect(await rows('SELECT * FROM apple_gift_deliveries')).toEqual(revoked);
    expect(fetchAppleSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('이미 사용한 코드는 기록만 하고 다른 선물은 건드리지 않는다', async () => {
    await confirm();
    await db.execute("UPDATE voucher_codes SET status='used', redeemed_by_user_id='other'");
    info = { ...info, transactionId: 'gift-2', purchaseDate: purchasedAt + 1 };
    await confirm('gift-2');
    info = { ...info, transactionId: 'gift-1', revocationDate: purchasedAt + 1000 };
    expect((await confirm()).status).toBe(400);
    expect(await rows('SELECT status FROM voucher_codes ORDER BY issued_at')).toEqual([{ status: 'used' }, { status: 'issued' }]);
    expect(await rows('SELECT plan FROM users WHERE id IN (\'owner\',\'other\')')).toEqual([{ plan: 'free' }, { plan: 'free' }]);
  });

  it('환불이 발급을 앞질러도 늦은 정상 응답으로 코드를 발급하지 않는다', async () => {
    const unrevoked = { ...info };
    info = { ...info, revocationDate: purchasedAt + 1000 };
    expect((await confirm()).status).toBe(400);
    info = unrevoked; // 먼저 조회한 미환불 응답이 늦게 쓰기를 시도하는 상황.
    expect((await confirm()).status).toBe(400);
    expect(await rows('SELECT * FROM voucher_codes')).toEqual([]);
    expect(await rows('SELECT user_id, provider_transaction_id, subscription_id, last_paid_at FROM store_transactions')).toEqual([{
      user_id: 'owner', provider_transaction_id: 'gift-1', subscription_id: null,
      last_paid_at: new Date(purchasedAt).toISOString(),
    }]);
  });

  it('기존 무연결 환불 표식도 Apple 구매자로 연결하고 재전송은 원장을 중복 생성하지 않는다', async () => {
    await db.execute("INSERT INTO apple_gift_deliveries (transaction_id, revoked_at) VALUES ('gift-1', '2026-01-01T00:00:00.000Z')");
    info = { ...info, revocationDate: purchasedAt + 1000 };
    expect((await confirm('gift-1', 'other')).status).toBe(400);
    const receipt = await rows('SELECT * FROM store_transactions');
    expect(receipt).toHaveLength(1);
    expect(receipt[0]?.user_id).toBe('owner');
    expect((await confirm('gift-1', 'other')).status).toBe(400);
    expect(await rows('SELECT * FROM store_transactions')).toEqual(receipt);
    expect(await rows('SELECT * FROM voucher_codes')).toEqual([]);
  });

  it('제보자 탈퇴는 구매자 환불 표식을 보존하고 구매자 파기 후 재전송은 고아를 만들지 않는다', async () => {
    info = { ...info, revocationDate: purchasedAt + 1000 };
    expect((await confirm('gift-1', 'other')).status).toBe(400);
    expect((await deleteOwner('other')).status).toBe(200);
    expect(await rows('SELECT transaction_id FROM apple_gift_deliveries')).toEqual([{ transaction_id: 'gift-1' }]);
    expect((await deleteOwner()).status).toBe(200);
    const retained = await rows('SELECT * FROM retained_billing_records');
    expect(retained).toHaveLength(1);
    await db.execute("INSERT INTO users (id,email,name) VALUES ('other','other@example.test','other')");
    expect((await confirm('gift-1', 'other')).status).toBe(400);
    expect(await rows('SELECT * FROM apple_gift_deliveries')).toEqual([]);
    expect(await rows('SELECT * FROM store_transactions')).toEqual([]);
    expect(await rows('SELECT * FROM retained_billing_records')).toEqual(retained);
  });

  it.each([undefined, '', 'deleted-owner'])('구매자를 확인할 수 없는 환불(%s)은 제보자 원장이나 고아 표식을 만들지 않는다', async (appAccountToken) => {
    info = { ...info, appAccountToken, revocationDate: purchasedAt + 1000 };
    await db.execute("INSERT INTO apple_gift_deliveries (transaction_id, revoked_at) VALUES ('gift-1', '2026-01-01T00:00:00.000Z')");
    expect((await confirm('gift-1', 'other')).status).toBe(400);
    expect(await rows('SELECT * FROM apple_gift_deliveries')).toEqual([]);
    expect(await rows('SELECT * FROM store_transactions')).toEqual([]);
    info = { ...info, revocationDate: undefined };
    expect((await confirm('gift-1', 'other')).status).toBe(403);
    expect(await rows('SELECT * FROM voucher_codes')).toEqual([]);
  });

  it('발급 전 환불 표식 쓰기 실패는 구매자 원장도 롤백한다', async () => {
    info = { ...info, revocationDate: purchasedAt + 1000 };
    await db.execute("CREATE TRIGGER reject_refund_marker BEFORE INSERT ON apple_gift_deliveries BEGIN SELECT RAISE(ABORT,'test failure'); END");
    try { expect((await confirm('gift-1', 'other')).status).toBe(500); }
    finally { await db.execute('DROP TRIGGER reject_refund_marker'); }
    expect(await rows('SELECT * FROM store_transactions')).toEqual([]);
    expect(await rows('SELECT * FROM apple_gift_deliveries')).toEqual([]);
    expect((await confirm('gift-1', 'other')).status).toBe(400);
  });

  it('회수 쓰기 실패는 코드·환불 표식을 함께 롤백한다', async () => {
    await confirm();
    info = { ...info, revocationDate: purchasedAt + 1000 };
    await db.execute("CREATE TRIGGER reject_gift_expiry BEFORE UPDATE ON voucher_codes BEGIN SELECT RAISE(ABORT,'test failure'); END");
    try { expect((await confirm()).status).toBe(500); }
    finally { await db.execute('DROP TRIGGER reject_gift_expiry'); }
    expect(await rows('SELECT status FROM voucher_codes')).toEqual([{ status: 'issued' }]);
    expect(await rows('SELECT revoked_at FROM apple_gift_deliveries')).toEqual([{ revoked_at: null }]);
    expect((await confirm()).status).toBe(400);
  });

  it('기존 결제는 유일한 코드만 백필하고 불명확한 연결은 502로 남긴다', async () => {
    await confirm();
    await db.execute('DELETE FROM apple_gift_deliveries');
    const migration = migrations.find((m) => m.id === 117)!;
    for (const sql of migration.statements) await db.execute(sql);
    expect((await rows('SELECT voucher_id FROM apple_gift_deliveries'))[0]?.voucher_id).toBeTruthy();
    await db.execute('DELETE FROM apple_gift_deliveries');
    await db.execute("UPDATE store_transactions SET last_paid_at=NULL");
    for (const sql of migration.statements) await db.execute(sql);
    info = { ...info, revocationDate: purchasedAt + 1000 };
    expect((await confirm()).status).toBe(502);
    expect(await rows('SELECT status FROM voucher_codes')).toEqual([{ status: 'issued' }]);
    expect(fetchAppleSubscriptionStatus).not.toHaveBeenCalled();
  });
});

describe('Apple 선물 구매자 영구 탈퇴', () => {
  it.each(['issued', 'refunded', 'unlinked', 'expired', 'refund-first', 'refund-first-expired'] as const)(
    '%s 선물 연결을 파기하고 기한 내 증빙과 다른 계정의 선물을 보존한다',
    async (state) => {
      const expired = state === 'expired' || state === 'refund-first-expired';
      const refundFirst = state === 'refund-first' || state === 'refund-first-expired';
      const paidAt = expired ? Date.parse('2018-01-01T00:00:00.000Z') : purchasedAt;
      info = { ...info, purchaseDate: paidAt };
      if (refundFirst) {
        info = { ...info, revocationDate: paidAt + 1000 };
        expect((await confirm('gift-1', 'other')).status).toBe(400);
        expect(await rows('SELECT * FROM voucher_codes')).toEqual([]);
        expect(await rows('SELECT user_id FROM store_transactions')).toEqual([{ user_id: 'owner' }]);
      } else {
        expect((await confirm()).status).toBe(200);
      }
      if (state === 'refunded') {
        info = { ...info, revocationDate: paidAt + 1000 };
        expect((await confirm()).status).toBe(400);
      } else if (state === 'unlinked') {
        await db.execute('DELETE FROM voucher_codes');
        expect(await rows('SELECT voucher_id FROM apple_gift_deliveries')).toEqual([{ voucher_id: null }]);
      }
      info = {
        ...info, transactionId: 'other-gift', appAccountToken: 'other',
        purchaseDate: purchasedAt, revocationDate: undefined,
      };
      expect((await confirm('other-gift', 'other')).status).toBe(200);
      const otherMapping = await rows("SELECT * FROM apple_gift_deliveries WHERE transaction_id = 'other-gift'");
      const otherVoucher = await rows("SELECT * FROM voucher_codes WHERE issuer_user_id = 'other'");
      // provider를 빼먹으면 탈퇴자의 Google 거래 ID와 같은 타인 Apple 선물까지 지운다.
      await db.execute(`INSERT INTO store_transactions
        (id, user_id, provider, provider_transaction_id, product_id, plan_key, last_paid_at)
        VALUES ('google-collision', 'owner', 'google', 'other-gift', 'personal_monthly', 'personal', '2018-01-01T00:00:00.000Z')`);

      expect((await deleteOwner()).status).toBe(200);
      expect(await rows("SELECT id FROM users WHERE id = 'owner'")).toEqual([]);
      expect(await rows("SELECT id FROM store_transactions WHERE user_id = 'owner'")).toEqual([]);
      expect(await rows('SELECT * FROM apple_gift_deliveries')).toEqual(otherMapping);
      expect(await rows('SELECT * FROM voucher_codes')).toEqual(otherVoucher);
      const retained = await rows('SELECT provider, provider_transaction_id, retain_until FROM retained_billing_records');
      expect(retained).toEqual(expired ? [] : [{
        provider: 'apple', provider_transaction_id: 'gift-1',
        retain_until: billingRetentionUntil(new Date(paidAt)).toISOString(),
      }]);
    },
  );

  it('뒤쪽 원장 삭제가 실패하면 선물 연결·코드·증빙 이관도 함께 롤백한다', async () => {
    expect((await confirm()).status).toBe(200);
    const mapping = await rows('SELECT * FROM apple_gift_deliveries');
    const voucher = await rows('SELECT * FROM voucher_codes');
    const transaction = await rows('SELECT * FROM store_transactions');
    await db.execute("CREATE TRIGGER reject_gift_purge BEFORE DELETE ON store_transactions BEGIN SELECT RAISE(ABORT,'test failure'); END");
    try { expect((await deleteOwner()).status).toBe(500); }
    finally { await db.execute('DROP TRIGGER reject_gift_purge'); }
    expect(await rows('SELECT * FROM apple_gift_deliveries')).toEqual(mapping);
    expect(await rows('SELECT * FROM voucher_codes')).toEqual(voucher);
    expect(await rows('SELECT * FROM store_transactions')).toEqual(transaction);
    expect(await rows('SELECT * FROM retained_billing_records')).toEqual([]);
    expect(await rows("SELECT id FROM users WHERE id = 'owner'")).toEqual([{ id: 'owner' }]);
  });
});
