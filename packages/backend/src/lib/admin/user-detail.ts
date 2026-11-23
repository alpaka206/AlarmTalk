import type { Client } from '@libsql/client';

/**
 * 관리자 콘솔 **사용자 상세**(읽기 전용) — 지금 권한이 어디서 오는지를 한 화면에 모은다(`docs/spec/admin-console.md`).
 * 화면은 `pages.ts` 의 `renderUserDetail`. (플러스 기간 지급·회수는 2026-11-23 에 없앴다 — 유료는 스토어 결제뿐이다.)
 */
export interface UserDetail {
  id: string;
  email: string;
  plan: string;
  createdAt: string;
  subscriptions: Array<{
    id: string;
    status: string;
    entitlementState: string;
    expiresAt: string | null;
    cancelAtPeriodEnd: boolean;
    provider: string | null;
  }>;
  retentionDeleteAfter: string | null;
  manualUsedThisMonth: number;
}

export async function loadUserDetail(db: Client, userPk: string): Promise<UserDetail | null> {
  const [userRes, subsRes, retentionRes, usageRes] = await db.batch(
    [
      {
        sql: `SELECT id, email, plan, created_at FROM users WHERE id = ? LIMIT 1`,
        args: [userPk],
      },
      {
        sql: `SELECT s.id, s.status, s.entitlement_state, s.expires_at, s.cancel_at_period_end,
                     (SELECT t.provider FROM store_transactions t WHERE t.subscription_id = s.id
                       ORDER BY t.created_at DESC LIMIT 1) AS provider
              FROM subscriptions s WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 20`,
        args: [userPk],
      },
      { sql: `SELECT delete_after FROM paid_voice_retention WHERE user_id = ?`, args: [userPk] },
      {
        sql: `SELECT used_count FROM manual_tts_usage
              WHERE pool_key = ? AND usage_month = strftime('%Y-%m', 'now', '+9 hours')`,
        args: [userPk],
      },
    ],
    'read',
  );
  const u = userRes!.rows[0];
  if (!u) return null;
  return {
    id: String(u.id),
    email: String(u.email ?? ''),
    plan: String(u.plan ?? 'free'),
    createdAt: String(u.created_at ?? ''),
    subscriptions: subsRes!.rows.map((r) => ({
      id: String(r.id),
      status: String(r.status),
      entitlementState: String(r.entitlement_state ?? 'entitled'),
      expiresAt: r.expires_at == null ? null : String(r.expires_at),
      cancelAtPeriodEnd: Number(r.cancel_at_period_end ?? 0) === 1,
      provider: r.provider == null ? null : String(r.provider),
    })),
    retentionDeleteAfter: retentionRes!.rows[0]?.delete_after == null ? null : String(retentionRes!.rows[0]!.delete_after),
    manualUsedThisMonth: Number(usageRes!.rows[0]?.used_count ?? 0),
  };
}
