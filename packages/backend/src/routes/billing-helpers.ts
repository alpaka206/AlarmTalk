import type { AppEnv } from '../types';
import type { Context } from 'hono';
import { getDB } from '../lib/db';

export const PAID_PLAN_TYPES = new Set(['personal', 'family']);

export function planTypeToUserPlan(planType: string): 'free' | 'plus' | 'family' {
  if (planType === 'family') return 'family';
  if (planType === 'personal') return 'plus';
  return 'free';
}

export async function resolveUserPk(c: Context<AppEnv>): Promise<string | null> {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const res = await db.execute({
    sql: 'SELECT id FROM users WHERE google_id = ?',
    args: [userId],
  });
  if (res.rows.length === 0) return null;
  return String(res.rows[0]!.id);
}
