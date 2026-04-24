import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { resolveUserPk } from './billing-helpers';

const billingQuery = new Hono<AppEnv>();

billingQuery.get('/vouchers', async (c) => {
  const userPk = await resolveUserPk(c);
  if (!userPk) {
    return c.json({ vouchers: [] });
  }
  const db = getDB(c.env);

  const result = await db.execute({
    sql: `SELECT v.id, v.code, v.plan_id, v.issuer_subscription_id, v.redeemed_by_user_id,
                 v.status, v.issued_at, v.used_at, v.expires_at,
                 p.key AS plan_key, p.name AS plan_name, p.plan_type
          FROM voucher_codes v
          JOIN plans p ON p.id = v.plan_id
          WHERE v.issuer_user_id = ?
          ORDER BY v.issued_at DESC`,
    args: [userPk],
  });

  return c.json({
    vouchers: result.rows.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      plan_id: String(r.plan_id),
      plan_key: String(r.plan_key),
      plan_name: String(r.plan_name),
      plan_type: String(r.plan_type),
      subscription_id: (r.issuer_subscription_id as string | null) ?? null,
      redeemed_by_user_id: (r.redeemed_by_user_id as string | null) ?? null,
      status: String(r.status),
      issued_at: String(r.issued_at),
      used_at: (r.used_at as string | null) ?? null,
      expires_at: String(r.expires_at),
    })),
  });
});

billingQuery.get('/subscription', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const result = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id,
                 s.status, s.starts_at, s.expires_at,
                 p.key AS plan_key, p.name AS plan_name, p.plan_type,
                 p.period_days, p.max_members, p.price_krw
          FROM subscriptions s
          JOIN users u ON u.id = s.user_id
          JOIN plans p ON p.id = s.plan_id
          WHERE u.google_id = ?
            AND s.status = 'active'
            AND s.expires_at > datetime('now')
          ORDER BY s.starts_at DESC
          LIMIT 1`,
    args: [userId],
  });

  if (result.rows.length === 0) {
    return c.json({ subscription: null, plan: null });
  }

  const r = result.rows[0];
  return c.json({
    subscription: {
      id: String(r.sub_id),
      user_id: String(r.user_id),
      plan_id: String(r.plan_id),
      plan_group_id: (r.plan_group_id as string | null) ?? null,
      status: String(r.status),
      starts_at: String(r.starts_at),
      expires_at: String(r.expires_at),
    },
    plan: {
      id: String(r.plan_id),
      key: String(r.plan_key),
      name: String(r.plan_name),
      plan_type: String(r.plan_type),
      period_days: Number(r.period_days),
      max_members: Number(r.max_members),
      price_krw: Number(r.price_krw),
    },
  });
});

export default billingQuery;
