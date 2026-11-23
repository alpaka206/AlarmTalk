import type { AppEnv } from '../types';
import type { Context } from 'hono';
import { getDB } from '../lib/db';
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
 * **내 개인 목소리 기능**을 쓸 수 있는가 — `users.plan` 이 유료(`PAID_USER_PLANS`)인가 하나로 판정한다. 유료 등급은
 * 스토어 결제(무료 체험 포함)만 올린다 — 기간 한정 개인 플랜·관리자 기간 지급은 2026-11-23 에 없앴다.
 *
 * 쓰는 자리: 클론 등록·초안 승격·제자리 교체·응원 보충, `/tts/generate` 의 무료 제한, 오디오 라우트의 클론 목소리 잠금,
 * 광고 보상의 무료 판정.
 */
export function hasPersonalVoiceAccess(plan: unknown): boolean {
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
