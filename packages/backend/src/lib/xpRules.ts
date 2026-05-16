export type XpEvent =
  | 'alarm_completed'
  | 'alarm_snoozed'
  | 'alarm_dismissed'
  | 'family_alarm_received'
  | 'friend_invited'
  | 'streak_bonus_7'
  | 'streak_bonus_30'
  | 'streak_bonus_90';

export const DAILY_XP_CAP = 200;

const XP_TABLE: Record<XpEvent, number> = {
  alarm_completed: 5,
  alarm_snoozed: -5,
  alarm_dismissed: -5,
  family_alarm_received: 10,
  friend_invited: 50,
  streak_bonus_7: 100,
  streak_bonus_30: 500,
  streak_bonus_90: 2000,
};

const AFFECTION_TABLE: Record<XpEvent, number> = {
  alarm_completed: 2,
  alarm_snoozed: 0,
  alarm_dismissed: 0,
  family_alarm_received: 3,
  friend_invited: 5,
  streak_bonus_7: 0,
  streak_bonus_30: 0,
  streak_bonus_90: 0,
};

const CAP_EXEMPT: Partial<Record<XpEvent, true>> = {
  streak_bonus_7: true,
  streak_bonus_30: true,
  streak_bonus_90: true,
};

export function isCapExempt(event: XpEvent): boolean {
  return CAP_EXEMPT[event] === true;
}

export function isXpEvent(value: unknown): value is XpEvent {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(XP_TABLE, value);
}

export function computeXpForEvent(event: XpEvent): number {
  return XP_TABLE[event];
}

export function computeAffectionForEvent(event: XpEvent): number {
  return AFFECTION_TABLE[event];
}

export interface DailyCapResult {
  grantedXp: number;
  capped: boolean;
  remainingCap: number;
}

/**
 * 일일 XP 캡 적용.
 * - earned 가 비유한이면 0 지급 (capped=false).
 * - earned 가 음수이면 일일 캡과 무관하게 그대로 차감 후보로 반환.
 * - alreadyEarnedToday 가 이미 cap 이상이면 0 지급 (capped=true).
 * - 합산이 cap 을 넘기면 남은 몫만 지급 (capped=true).
 */
export function applyDailyXpCap(
  earned: number,
  alreadyEarnedToday: number,
  cap: number = DAILY_XP_CAP,
): DailyCapResult {
  const safeEarned = Number.isFinite(earned) ? Math.floor(earned) : 0;
  const safeAlready =
    Number.isFinite(alreadyEarnedToday) && alreadyEarnedToday > 0
      ? Math.floor(alreadyEarnedToday)
      : 0;
  const safeCap = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 0;

  const remainingCap = Math.max(safeCap - safeAlready, 0);

  if (safeEarned < 0) {
    return { grantedXp: safeEarned, capped: false, remainingCap };
  }
  if (safeEarned === 0) {
    return { grantedXp: 0, capped: false, remainingCap };
  }
  if (remainingCap === 0) {
    return { grantedXp: 0, capped: true, remainingCap: 0 };
  }
  if (safeEarned <= remainingCap) {
    return {
      grantedXp: safeEarned,
      capped: false,
      remainingCap: remainingCap - safeEarned,
    };
  }
  return { grantedXp: remainingCap, capped: true, remainingCap: 0 };
}

/**
 * 단일 진입점 — 이벤트와 오늘 이미 획득한 XP 를 받아 최종 지급치 + 애정도 반환.
 * 애정도는 일일 캡 영향을 받지 않음 (정서적 보상은 계속 누적).
 */
export interface GrantResult {
  xp: DailyCapResult;
  affection: number;
  event: XpEvent;
}

export function computeGrant(
  event: XpEvent,
  alreadyEarnedToday: number,
  cap: number = DAILY_XP_CAP,
): GrantResult {
  const earned = computeXpForEvent(event);
  const xp = isCapExempt(event)
    ? { grantedXp: earned, capped: false, remainingCap: Math.max(cap - alreadyEarnedToday, 0) }
    : applyDailyXpCap(earned, alreadyEarnedToday, cap);
  const affection = computeAffectionForEvent(event);
  return { xp, affection, event };
}
