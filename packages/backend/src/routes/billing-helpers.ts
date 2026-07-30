import type { AppEnv } from '../types';
import type { Context } from 'hono';
import { getDB } from '../lib/db';

export const PAID_PLAN_TYPES = new Set(['personal', 'family']);
export const PAID_USER_PLANS = new Set(['plus', 'family', 'personal', 'couple']);

export function planTypeToUserPlan(planType: string): 'free' | 'plus' | 'family' {
  if (planType === 'family') return 'family';
  if (planType === 'personal') return 'plus';
  return 'free';
}

export function plannedMaxUses(planType: string, maxMembers: number): number {
  if (planType === 'family') return Math.max(1, maxMembers - 1);
  return 1;
}

export function isPaidVoicePlan(plan: unknown): boolean {
  return typeof plan === 'string' && PAID_USER_PLANS.has(plan);
}

export async function resolveUserPk(c: Context<AppEnv>): Promise<string | null> {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const res = await db.execute({
    sql: 'SELECT id FROM users WHERE id = ?',
    args: [userId],
  });
  if (res.rows.length === 0) return null;
  return String(res.rows[0]!.id);
}
