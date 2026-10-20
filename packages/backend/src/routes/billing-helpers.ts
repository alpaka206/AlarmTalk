import type { AppEnv } from '../types';
import type { Context } from 'hono';
import { getDB } from '../lib/db';
import { computedUserPlan, type PersonalPromoState } from '../lib/personal-promo';
import {
  PAID_PLAN_TYPES as SHARED_PAID_PLAN_TYPES,
  PAID_USER_PLANS as SHARED_PAID_USER_PLANS,
} from '@alarmtalk/shared';

// ⚠ **원본은 `@alarmtalk/shared` 다**(2026-09-02). 같은 목록이 네 벌로 갈라져 있던 것을
// 공용 계약 패키지로 올렸다 — 여기는 기존 호출부를 위한 Set 어댑터일 뿐이다.
export const PAID_PLAN_TYPES = new Set<string>(SHARED_PAID_PLAN_TYPES);
const PAID_USER_PLANS = new Set<string>(SHARED_PAID_USER_PLANS);

/** 구독 플랜의 `plan_type` → `users.plan`. 개인(`personal`)은 등급 `plus` 다. */
export function planTypeToUserPlan(planType: string): 'free' | 'plus' {
  return planType === 'personal' ? 'plus' : 'free';
}

/**
 * **원시** `users.plan` 이 유료인가 — 기간 한정 개인 플랜을 **반영하지 않는다.**
 * 라우트는 [hasPersonalVoiceAccess] 를 쓴다(목소리 게이트는 전부 내 개인 기능이다). 스펙:
 * `docs/spec/billing-lifecycle.md` 「기간 한정 개인 플랜」의 계산값/원시값 표.
 */
function isPaidVoicePlan(plan: unknown): boolean {
  return typeof plan === 'string' && PAID_USER_PLANS.has(plan);
}

/**
 * **내 개인 목소리 기능**을 쓸 수 있는가 — 원시 `users.plan` 에 기간 한정 개인 플랜을
 * 반영해 판정한다(원시 free 이고 구간 안이면 개인).
 *
 * 쓰는 자리: 클론 등록·초안 승격·제자리 교체, `/tts/generate` 의 무료 제한,
 * 내 알람 저장·수정의 목소리 게이트, 오디오 라우트의 클론 목소리 잠금.
 */
export function hasPersonalVoiceAccess(plan: unknown, promo: PersonalPromoState): boolean {
  if (typeof plan !== 'string') return false;
  return isPaidVoicePlan(computedUserPlan(plan, promo));
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
