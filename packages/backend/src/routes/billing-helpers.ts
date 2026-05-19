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

/**
 * iOS StoreKit2 productID → 백엔드 plans.key 매핑.
 *
 * App Store Connect 등록 SKU (`apps/ios-native/.../SubscriptionProduct.swift`) 와
 * 백엔드 plans 시드 (`migrations.ts` id=6,26) 를 잇는 단일 진실 공급원.
 *
 * 매핑 규칙:
 *   - `*_personal_*` (월/연) → plans.key='personal'  (개인)
 *   - `*_couple_*`   (월/연) → plans.key='couple'    (커플 — family plan_type, max_members=2)
 *   - `*_family_*`   (월/연) → plans.key='family'    (가족 — family plan_type, max_members=6)
 *
 * 알려지지 않은 productID 는 null. 호출자가 400 응답을 내야 함.
 */
const APPLE_PRODUCT_PREFIX = 'com.voicealarm.nativeapp.ios.';

const APPLE_PRODUCT_TO_PLAN_KEY: Record<string, 'personal' | 'couple' | 'family'> = {
  [`${APPLE_PRODUCT_PREFIX}personal_monthly`]: 'personal',
  [`${APPLE_PRODUCT_PREFIX}personal_yearly`]: 'personal',
  [`${APPLE_PRODUCT_PREFIX}couple_monthly`]: 'couple',
  [`${APPLE_PRODUCT_PREFIX}couple_yearly`]: 'couple',
  [`${APPLE_PRODUCT_PREFIX}family_monthly`]: 'family',
  [`${APPLE_PRODUCT_PREFIX}family_yearly`]: 'family',
};

export function applePeriodFromProductId(productId: string): 'monthly' | 'yearly' | null {
  if (productId.endsWith('_monthly')) return 'monthly';
  if (productId.endsWith('_yearly')) return 'yearly';
  return null;
}

export function applePlanKeyFromProductId(productId: string): 'personal' | 'couple' | 'family' | null {
  return APPLE_PRODUCT_TO_PLAN_KEY[productId] ?? null;
}

export function isPaidVoicePlan(plan: unknown): boolean {
  return typeof plan === 'string' && PAID_USER_PLANS.has(plan);
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
