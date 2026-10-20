import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import { resolvePlanAfterSuspend } from '../src/lib/billing-cancel';
import { withWriteTransaction } from '../src/lib/transactions';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-entitlement-access-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
const { default: billingQuery } = await import('../src/routes/billing-query');

const FUTURE = '2099-01-01T00:00:00.000Z';
function app(user = 'member') {
  const a = new Hono<AppEnv>();
  a.use('*', async (c, next) => {
    c.set('userId', user);
    await next();
  });
  a.route('/billing', billingQuery);
  return a;
}
async function rows(sql: string) {
  return (await db.execute(sql)).rows;
}
async function insertPersonalSubscription(id: string, startsAt: string, expiresAt = FUTURE) {
  await db.execute({
    sql: `INSERT INTO subscriptions(id,user_id,plan_id,status,starts_at,expires_at)
      SELECT ?,'member',id,'active',?,? FROM plans WHERE key='personal'`,
    args: [id, startsAt, expiresAt],
  });
}

beforeAll(async () => {
  await runMigrations(db);
});
beforeEach(async () => {
  for (const table of ['store_transactions', 'subscriptions', 'paid_voice_retention']) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute("DELETE FROM users WHERE id = 'member'");
  await db.execute("INSERT INTO users(id,google_id,email,plan) VALUES ('member','member','member@example.test','free')");
});
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('권한 조회는 등급 재계산과 같은 구독을 선택한다', () => {
  it('보류·미확인 행은 더 최근이어도 건너뛰고, 권한이 돌아오면 그 행을 고른다', async () => {
    await insertPersonalSubscription('older', '2026-02-01');
    await insertPersonalSubscription('newer', '2026-03-01');
    for (const state of ['suspended', 'unverified', 'entitled']) {
      await db.execute({
        sql: 'UPDATE subscriptions SET entitlement_state=? WHERE id=?',
        args: [state, 'newer'],
      });
      await withWriteTransaction(db, (tx) => resolvePlanAfterSuspend(tx, 'member', []));
      const response = await app().request('/billing/subscription');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        subscription: { id: state === 'entitled' ? 'newer' : 'older' },
        plan: { key: 'personal' },
      });
      expect((await rows("SELECT plan FROM users WHERE id='member'"))[0]!.plan).toBe('plus');
    }
  });

  it('보류·미확인만 남아도 갱신 스토어는 보존하고 유료 plan은 반환하지 않는다', async () => {
    await insertPersonalSubscription('held', '2026-02-01');
    await db.execute({
      sql: `INSERT INTO store_transactions(id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id)
        VALUES ('receipt','member','google','test-token','personal_monthly','personal','held')`,
      args: [],
    });
    for (const state of ['suspended', 'unverified']) {
      await db.execute({ sql: 'UPDATE subscriptions SET entitlement_state=?', args: [state] });
      await withWriteTransaction(db, (tx) => resolvePlanAfterSuspend(tx, 'member', []));
      const body = await (await app().request('/billing/subscription')).json();
      expect(body).toMatchObject({
        subscription: null,
        plan: null,
        store_renewal_providers: ['google'],
      });
      expect((await rows("SELECT plan FROM users WHERE id='member'"))[0]!.plan).toBe('free');
    }
  });

  it('같은 등급이면 최신 entitled 행을 선택하고 만료된 행은 제외한다', async () => {
    await insertPersonalSubscription('expired', '2026-04-01', '2000-01-01');
    await insertPersonalSubscription('old', '2026-02-01');
    await insertPersonalSubscription('new', '2026-03-01');
    expect(await (await app().request('/billing/subscription')).json()).toMatchObject({
      subscription: { id: 'new' },
      plan: { key: 'personal' },
    });
  });
});
