import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrationsRange } from '../src/lib/migrations';

describe('마이그레이션 118 — 기존 스토어 구독 권한은 재확인', () => {
  it('활성 스토어 구독·그룹 멤버만 미확인으로 두고 현재 등급·비스토어 권한은 보존한다', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-entitlement-migration-'));
    const db = createClient({ url: `file:${join(directory, 'test.db')}` });
    try {
      await runMigrationsRange(db, 1, 117);
      await db.execute(`INSERT INTO users (id,email,name,plan) VALUES
        ('owner','owner@example.test','owner','family'),
        ('member','member@example.test','member','plus')`);
      const plans = await db.execute("SELECT id,key FROM plans WHERE key IN ('family','personal')");
      const family = String(plans.rows.find((row) => row.key === 'family')!.id);
      const personal = String(plans.rows.find((row) => row.key === 'personal')!.id);
      await db.execute({
        sql: `INSERT INTO plan_groups(id,owner_user_id,plan_id,max_members) VALUES ('group','owner',?,5)`,
        args: [family],
      });
      for (const [id, user, plan, group, status] of [
        ['owner-store', 'owner', family, 'group', 'active'],
        ['member-group', 'member', family, 'group', 'active'],
        ['grant-personal', 'member', personal, null, 'active'],
        ['personal-store', 'owner', personal, null, 'active'],
        ['old-cancelled', 'owner', family, null, 'cancelled'],
      ]) {
        await db.execute({
          sql: `INSERT INTO subscriptions(id,user_id,plan_id,plan_group_id,status,starts_at,expires_at)
                VALUES (?,?,?,?,?,'2026-09-01','2026-10-01')`,
          args: [id!, user!, plan!, group ?? null, status!],
        });
      }
      for (const [id, provider, key] of [
        ['owner-store', 'apple', 'family'],
        ['personal-store', 'google', 'personal'],
        ['old-cancelled', 'apple', 'family'],
      ]) {
        await db.execute({
          sql: `INSERT INTO store_transactions
                (id,user_id,provider,provider_transaction_id,product_id,plan_key,subscription_id)
                VALUES (?,'owner',?,?,?,?,?)`,
          args: [id!, provider!, `receipt-${id}`, `${key}_monthly`, key!, id!],
        });
      }
      await runMigrationsRange(db, 118, 118);
      expect(
        (await db.execute('SELECT id,entitlement_state FROM subscriptions ORDER BY id')).rows,
      ).toEqual([
        { id: 'grant-personal', entitlement_state: 'entitled' },
        { id: 'member-group', entitlement_state: 'unverified' },
        { id: 'old-cancelled', entitlement_state: 'entitled' },
        { id: 'owner-store', entitlement_state: 'unverified' },
        { id: 'personal-store', entitlement_state: 'unverified' },
      ]);
      expect(
        (await db.execute("SELECT id,plan FROM users WHERE id IN ('owner','member') ORDER BY id"))
          .rows,
      ).toEqual([
        { id: 'member', plan: 'plus' },
        { id: 'owner', plan: 'family' },
      ]);

      // 이미 확정된 복구를 마이그레이션 재호출이 미확인으로 되돌리지 않는다.
      await db.execute(
        "UPDATE subscriptions SET entitlement_state='entitled' WHERE id='owner-store'",
      );
      expect(await runMigrationsRange(db, 118, 118)).toEqual([]);
      expect(
        (await db.execute("SELECT entitlement_state FROM subscriptions WHERE id='owner-store'"))
          .rows,
      ).toEqual([{ entitlement_state: 'entitled' }]);
      await expect(
        db.execute("UPDATE subscriptions SET entitlement_state='unknown'"),
      ).rejects.toThrow();
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
