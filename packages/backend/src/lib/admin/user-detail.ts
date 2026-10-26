import type { Client } from '@libsql/client';
import { listPlanGrants, mergedGrantEnd, type PlanGrantRow } from '../plan-grants';

/**
 * 관리자 콘솔 **사용자 상세** — 플러스 지급 전에 지금 권한이 어디서 오는지를 한 화면에 모은다
 * (`docs/spec/admin-console.md` 「사용자 상세와 기간 지급」).
 */
export interface UserDetail {
  id: string;
  email: string;
  name: string;
  rawPlan: string;
  createdAt: string;
  deletionStatus: string;
  isSystem: boolean;
  subscriptions: Array<{
    id: string;
    status: string;
    entitlementState: string;
    expiresAt: string | null;
    cancelAtPeriodEnd: boolean;
    provider: string | null;
  }>;
  grants: PlanGrantRow[];
  /** 지금을 덮는 이어진 지급 구간의 끝 — 없으면 null. */
  grantEndsAt: Date | null;
  retentionDeleteAfter: string | null;
  manualUsedThisMonth: number;
}

export async function loadUserDetail(db: Client, userPk: string, now: Date): Promise<UserDetail | null> {
  const [userRes, subsRes, retentionRes, usageRes] = await db.batch(
    [
      {
        sql: `SELECT id, email, name, plan, created_at, deletion_status, google_id FROM users WHERE id = ? LIMIT 1`,
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
  const grants = await listPlanGrants(db, userPk);
  return {
    id: String(u.id),
    email: String(u.email ?? ''),
    name: String(u.name ?? ''),
    rawPlan: String(u.plan ?? 'free'),
    createdAt: String(u.created_at ?? ''),
    deletionStatus: String(u.deletion_status ?? 'active'),
    isSystem: String(u.google_id ?? '').startsWith('system:'),
    subscriptions: subsRes!.rows.map((r) => ({
      id: String(r.id),
      status: String(r.status),
      entitlementState: String(r.entitlement_state ?? 'entitled'),
      expiresAt: r.expires_at == null ? null : String(r.expires_at),
      cancelAtPeriodEnd: Number(r.cancel_at_period_end ?? 0) === 1,
      provider: r.provider == null ? null : String(r.provider),
    })),
    grants,
    grantEndsAt: mergedGrantEnd(grants, now),
    retentionDeleteAfter: retentionRes!.rows[0]?.delete_after == null ? null : String(retentionRes!.rows[0]!.delete_after),
    manualUsedThisMonth: Number(usageRes!.rows[0]?.used_count ?? 0),
  };
}

/** 지금 권한을 덮는 활성 구독(만료 전·보류 아님). */
export function liveSubscriptions(detail: UserDetail, now: Date): UserDetail['subscriptions'] {
  return detail.subscriptions.filter(
    (s) =>
      s.status === 'active' &&
      s.entitlementState === 'entitled' &&
      (s.expiresAt == null || Date.parse(s.expiresAt.includes('T') ? s.expiresAt : `${s.expiresAt.replace(' ', 'T')}Z`) > now.getTime()),
  );
}
