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
const { default: billingMutation } = await import('../src/routes/billing-mutation');
const { default: codeRoutes } = await import('../src/routes/code');

const FUTURE = '2099-01-01T00:00:00.000Z';
function app(user = 'owner') {
  const a = new Hono<AppEnv>();
  a.use('*', async (c, next) => {
    c.set('userId', user);
    await next();
  });
  a.route('/billing', billingQuery);
  a.route('/billing', billingMutation);
  a.route('/code', codeRoutes);
  return a;
}
function post(path: string, user = 'owner', body = {}) {
  return app(user).request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function rows(sql: string) {
  return (await db.execute(sql)).rows;
}
async function seed(key = 'family', includeMember = true) {
  for (const user of ['owner', 'member', 'invitee']) {
    await db.execute({
      sql: "INSERT INTO users(id,google_id,email,plan) VALUES (?,?,?,'free')",
      args: [user, user, `${user}@example.test`],
    });
  }
  const plan = (
    await db.execute({ sql: 'SELECT id,max_members FROM plans WHERE key=?', args: [key] })
  ).rows[0]!;
  await db.execute({
    sql: "INSERT INTO plan_groups(id,owner_user_id,plan_id,max_members) VALUES ('group','owner',?,?)",
    args: [plan.id, plan.max_members],
  });
  for (const user of includeMember ? ['owner', 'member'] : ['owner']) {
    await db.execute({
      sql: "INSERT INTO plan_group_members(id,plan_group_id,user_id,role) VALUES (?,'group',?,?)",
      args: [`membership-${user}`, user, user === 'owner' ? 'owner' : 'member'],
    });
    await db.execute({
      sql: `INSERT INTO subscriptions(id,user_id,plan_id,plan_group_id,status,starts_at,expires_at)
        VALUES (?, ?, ?, 'group', 'active', '2026-01-01', ?)`,
      args: [`group-${user}`, user, plan.id, FUTURE],
    });
    await db.execute({ sql: "UPDATE users SET plan='family' WHERE id=?", args: [user] });
  }
}

beforeAll(async () => {
  await runMigrations(db);
});
beforeEach(async () => {
  for (const table of [
    'voucher_redemptions',
    'voucher_codes',
    'store_transactions',
    'subscriptions',
    'plan_group_members',
    'plan_groups',
    'paid_voice_retention',
  ]) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute("DELETE FROM users WHERE id IN ('owner','member','invitee')");
});
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('권한 조회는 등급 재계산과 같은 구독을 선택한다', () => {
  it.each(['family', 'couple'])('복구된 %s가 더 최근의 개인 구독보다 우선한다', async (key) => {
    await seed(key);
    await db.execute({
      sql: `INSERT INTO subscriptions(id,user_id,plan_id,status,starts_at,expires_at)
        SELECT 'personal','member',id,'active','2026-02-01',? FROM plans WHERE key='personal'`,
      args: [FUTURE],
    });
    for (const state of ['suspended', 'unverified', 'entitled']) {
      await db.execute({
        sql: 'UPDATE subscriptions SET entitlement_state=? WHERE id=?',
        args: [state, 'group-member'],
      });
      await withWriteTransaction(db, (tx) => resolvePlanAfterSuspend(tx, 'member', []));
      const response = await app('member').request('/billing/subscription');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        subscription: { id: state === 'entitled' ? 'group-member' : 'personal' },
        plan: { key: state === 'entitled' ? key : 'personal' },
      });
      expect((await rows("SELECT plan FROM users WHERE id='member'"))[0]!.plan).toBe(
        state === 'entitled' ? 'family' : 'plus',
      );
    }
  });

  it('보류·미확인만 남아도 갱신 스토어는 보존하고 유료 plan은 반환하지 않는다', async () => {
    await seed();
    await db.execute({
      sql: `INSERT INTO store_transactions(id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id)
        VALUES ('receipt','owner','google','test-token','family_monthly','family','group-owner')`,
      args: [],
    });
    for (const state of ['suspended', 'unverified']) {
      await db.execute({ sql: 'UPDATE subscriptions SET entitlement_state=?', args: [state] });
      const body = await (await app().request('/billing/subscription')).json();
      expect(body).toMatchObject({
        subscription: null,
        plan: null,
        store_renewal_providers: ['google'],
      });
    }
  });

  it('같은 등급이면 최신 entitled 행을 선택하고 만료된 그룹은 제외한다', async () => {
    await seed();
    await db.execute("UPDATE subscriptions SET expires_at='2000-01-01' WHERE user_id='member'");
    for (const [id, start] of [
      ['old', '2026-02-01'],
      ['new', '2026-03-01'],
    ]) {
      await db.execute({
        sql: `INSERT INTO subscriptions(id,user_id,plan_id,status,starts_at,expires_at)
          SELECT ?,'member',id,'active',?,? FROM plans WHERE key='personal'`,
        args: [id!, start!, FUTURE],
      });
    }
    expect(await (await app('member').request('/billing/subscription')).json()).toMatchObject({
      subscription: { id: 'new' },
      plan: { key: 'personal' },
    });
  });
});

describe('보류 그룹의 초대는 복구 전 새 권한을 주지 않는다', () => {
  it.each(['family', 'couple'])(
    '%s 보류·미확인은 발급·재발급·사용을 막고 복구 뒤 같은 코드를 쓴다',
    async (key) => {
      await seed(key, false);
      const issued = await post('/billing/vouchers/family-share');
      expect(issued.status).toBe(200);
      const { voucher } = await issued.json();
      // 독립 개인 구독이 있어 users.plan이 plus여도 보류 그룹의 초대 근거가 되지 않는다.
      await db.execute({
        sql: `INSERT INTO subscriptions(id,user_id,plan_id,status,starts_at,expires_at)
        SELECT 'personal-owner','owner',id,'active','2026-02-01',? FROM plans WHERE key='personal'`,
        args: [FUTURE],
      });
      for (const state of ['suspended', 'unverified']) {
        await db.execute({
          sql: 'UPDATE subscriptions SET entitlement_state=? WHERE id=?',
          args: [state, 'group-owner'],
        });
        await withWriteTransaction(db, (tx) => resolvePlanAfterSuspend(tx, 'owner', []));
        expect((await rows("SELECT plan FROM users WHERE id='owner'"))[0]!.plan).toBe('plus');
        const before = await rows('SELECT * FROM voucher_codes');
        for (const path of [
          '/billing/vouchers/family-share',
          '/billing/vouchers/family-share/regenerate',
        ]) {
          const response = await post(path);
          expect(response.status).toBe(404);
          expect(await response.json()).toMatchObject({
            error_code: 'NO_ACTIVE_FAMILY_OWNER_SUBSCRIPTION',
          });
        }
        const redeemed = await post('/code/register', 'invitee', { code: voucher.code });
        expect(redeemed.status).toBe(409);
        expect(await redeemed.json()).toMatchObject({ error_code: 'SUBSCRIPTION_NOT_ACTIVE' });
        expect(await rows('SELECT * FROM voucher_codes')).toEqual(before);
        expect(await rows('SELECT * FROM voucher_redemptions')).toHaveLength(0);
        expect(await rows('SELECT * FROM plan_group_members')).toHaveLength(1);
        expect(await rows("SELECT * FROM subscriptions WHERE user_id='invitee'")).toHaveLength(0);
        expect((await rows("SELECT plan FROM users WHERE id='invitee'"))[0]!.plan).toBe('free');
      }
      await db.execute(
        "UPDATE subscriptions SET entitlement_state='entitled' WHERE id='group-owner'",
      );
      const redeemed = await post('/code/register', 'invitee', { code: voucher.code });
      expect(redeemed.status).toBe(200);
      expect(await redeemed.json()).toMatchObject({ plan: { key } });
      expect(
        await rows("SELECT entitlement_state FROM subscriptions WHERE user_id='invitee'"),
      ).toEqual([{ entitlement_state: 'entitled' }]);
    },
  );
});
