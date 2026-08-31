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
                 v.status, v.issued_at, v.used_at, v.expires_at, v.max_uses,
                 (SELECT COUNT(*) FROM voucher_redemptions WHERE voucher_id = v.id) AS use_count,
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
      max_uses: Number(r.max_uses ?? 1),
      use_count: Number(r.use_count ?? 0),
    })),
  });
});

billingQuery.get('/subscription', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const result = await db.execute({
    sql: `SELECT s.id AS sub_id, s.user_id, s.plan_id, s.plan_group_id,
                 s.status, s.starts_at, s.expires_at,
                 s.cancel_at_period_end, s.canceled_at, s.next_plan_id,
                 p.key AS plan_key, p.name AS plan_name, p.plan_type,
                 p.period_days, p.max_members, p.price_krw,
                 np.key AS next_plan_key, np.name AS next_plan_name, np.plan_type AS next_plan_type
          FROM subscriptions s
          JOIN users u ON u.id = s.user_id
          JOIN plans p ON p.id = s.plan_id
          LEFT JOIN plans np ON np.id = s.next_plan_id
          WHERE u.id = ?
            AND s.status = 'active'
            AND s.expires_at > datetime('now')
          ORDER BY s.starts_at DESC
          LIMIT 1`,
    args: [userId],
  });

  // 무료 강등 뒤 목소리 보관 마감. **무료일 때가 정작 필요한 때**라 조기 반환보다 먼저 읽는다 —
  // 화면이 "N일 안에 다시 시작하면 돌아와요" 를 말하려면 남은 시간을 알아야 하고, 그 값은
  // 앱이 들고 있을 수 없다(재설치·다른 기기). 유료면 보관 행이 없어 null 이다.
  const retentionRes = await db.execute({
    sql: `SELECT delete_after FROM paid_voice_retention WHERE user_id = ?`,
    args: [userId],
  });
  const voiceRetentionUntil =
    retentionRes.rows.length > 0 ? String(retentionRes.rows[0]!.delete_after) : null;

  if (result.rows.length === 0) {
    return c.json({
      subscription: null,
      plan: null,
      next_plan: null,
      voice_retention_until: voiceRetentionUntil,
    });
  }

  const r = result.rows[0]!;
  const nextPlanId = (r.next_plan_id as string | null) ?? null;
  return c.json({
    voice_retention_until: voiceRetentionUntil,
    subscription: {
      id: String(r.sub_id),
      user_id: String(r.user_id),
      plan_id: String(r.plan_id),
      plan_group_id: (r.plan_group_id as string | null) ?? null,
      status: String(r.status),
      starts_at: String(r.starts_at),
      expires_at: String(r.expires_at),
      cancel_at_period_end: Number(r.cancel_at_period_end ?? 0) === 1,
      canceled_at: (r.canceled_at as string | null) ?? null,
      next_plan_id: nextPlanId,
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
    next_plan: nextPlanId
      ? {
          id: nextPlanId,
          key: String(r.next_plan_key),
          name: String(r.next_plan_name),
          plan_type: String(r.next_plan_type),
        }
      : null,
  });
});

export default billingQuery;
