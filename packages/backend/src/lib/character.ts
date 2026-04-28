export type CharacterStage = 'seed' | 'sprout' | 'tree' | 'bloom';

export const CHARACTER_STAGES: CharacterStage[] = ['seed', 'sprout', 'tree', 'bloom'];

// L1 → 0, L2 → 100, L3 → 400, L4 → 900, L5 → 1600, ...
// threshold(n) = 100 * (n - 1)^2
export function xpThresholdForLevel(level: number): number {
  if (!Number.isFinite(level) || level < 1) return 0;
  const n = Math.floor(level);
  return 100 * (n - 1) * (n - 1);
}

export function computeLevelFromXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  // level = 1 + floor(sqrt(xp / 100))
  return 1 + Math.floor(Math.sqrt(xp / 100));
}

export function computeStageFromLevel(level: number): CharacterStage {
  if (!Number.isFinite(level) || level < 3) return 'seed';
  if (level < 6) return 'sprout';
  if (level < 10) return 'tree';
  return 'bloom';
}

export function computeStageFromXp(xp: number): CharacterStage {
  return computeStageFromLevel(computeLevelFromXp(xp));
}

export interface CharacterStats {
  diligence: number;
  health: number;
  consistency: number;
}

export function computeStats(
  alarmCompletions: number,
  routineCompletions: number,
  activeDays: number,
): CharacterStats {
  return {
    diligence: Math.max(0, Math.floor(alarmCompletions)),
    health: Math.max(0, Math.floor(routineCompletions)),
    consistency: Math.max(0, Math.floor(activeDays)),
  };
}
