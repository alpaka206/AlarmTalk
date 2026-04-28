export interface StreakResult {
  newStreak: number;
  isNewDay: boolean;
  milestoneReached: number | null;
}

const MILESTONES = [7, 30, 90] as const;

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA + 'T00:00:00Z');
  const b = new Date(dateB + 'T00:00:00Z');
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function computeStreak(
  lastWakeupDate: string | null,
  todayDate: string,
  currentStreak: number,
): StreakResult {
  if (!lastWakeupDate) {
    return { newStreak: 1, isNewDay: true, milestoneReached: checkMilestone(1) };
  }

  const gap = daysBetween(lastWakeupDate, todayDate);

  if (gap === 0) {
    return { newStreak: currentStreak, isNewDay: false, milestoneReached: null };
  }

  if (gap === 1) {
    const next = currentStreak + 1;
    return { newStreak: next, isNewDay: true, milestoneReached: checkMilestone(next) };
  }

  return { newStreak: 1, isNewDay: true, milestoneReached: checkMilestone(1) };
}

function checkMilestone(streak: number): number | null {
  return MILESTONES.includes(streak as (typeof MILESTONES)[number]) ? streak : null;
}

export const MILESTONE_BONUS_XP: Record<number, number> = {
  7: 100,
  30: 500,
  90: 2000,
};
