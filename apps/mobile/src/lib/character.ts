import type { TFunction } from 'i18next';

export type CharacterStage = 'seed' | 'sprout' | 'tree' | 'bloom';

const STAGE_EMOJI: Record<CharacterStage, string> = {
  seed: '🌱',
  sprout: '🌿',
  tree: '🌳',
  bloom: '🌸',
};

const STAGE_LABEL_KEYS: Record<CharacterStage, string> = {
  seed: 'character.stageSeed',
  sprout: 'character.stageSprout',
  tree: 'character.stageTree',
  bloom: 'character.stageBloom',
};

const DIALOGUE_KEYS: Record<CharacterStage, readonly string[]> = {
  seed: [
    'character.dlg.seed0',
    'character.dlg.seed1',
    'character.dlg.seed2',
    'character.dlg.seed3',
    'character.dlg.seed4',
    'character.dlg.seed5',
    'character.dlg.seed6',
  ],
  sprout: [
    'character.dlg.sprout0',
    'character.dlg.sprout1',
    'character.dlg.sprout2',
    'character.dlg.sprout3',
    'character.dlg.sprout4',
    'character.dlg.sprout5',
    'character.dlg.sprout6',
  ],
  tree: [
    'character.dlg.tree0',
    'character.dlg.tree1',
    'character.dlg.tree2',
    'character.dlg.tree3',
    'character.dlg.tree4',
    'character.dlg.tree5',
    'character.dlg.tree6',
  ],
  bloom: [
    'character.dlg.bloom0',
    'character.dlg.bloom1',
    'character.dlg.bloom2',
    'character.dlg.bloom3',
    'character.dlg.bloom4',
    'character.dlg.bloom5',
    'character.dlg.bloom6',
  ],
};

const STREAK_DIALOGUE_KEYS: { minStreak: number; keys: readonly string[] }[] = [
  { minStreak: 90, keys: [
    'character.streak.d90_0',
    'character.streak.d90_1',
    'character.streak.d90_2',
  ]},
  { minStreak: 30, keys: [
    'character.streak.d30_0',
    'character.streak.d30_1',
    'character.streak.d30_2',
  ]},
  { minStreak: 7, keys: [
    'character.streak.d7_0',
    'character.streak.d7_1',
    'character.streak.d7_2',
  ]},
  { minStreak: 3, keys: [
    'character.streak.d3_0',
    'character.streak.d3_1',
    'character.streak.d3_2',
  ]},
  { minStreak: 1, keys: [
    'character.streak.d1_0',
    'character.streak.d1_1',
  ]},
];

export interface CharacterPayload {
  stage?: CharacterStage | string;
  xp?: number;
  level?: number;
}

export interface ProgressPayload {
  xp_into_level?: number;
  xp_to_next_level?: number;
  level_span?: number;
  progress_ratio?: number;
}

export function normalizeStage(stage: unknown): CharacterStage {
  if (stage === 'sprout' || stage === 'tree' || stage === 'bloom') return stage;
  return 'seed';
}

export function stageToEmoji(stage: unknown): string {
  return STAGE_EMOJI[normalizeStage(stage)];
}

export function stageToLabel(stage: unknown, t: TFunction): string {
  return t(STAGE_LABEL_KEYS[normalizeStage(stage)]);
}

export function listDialogues(stage: unknown, t: TFunction): readonly string[] {
  return DIALOGUE_KEYS[normalizeStage(stage)].map((key) => t(key));
}

export function pickRandomDialogue(
  stage: unknown,
  t: TFunction,
  rng: () => number = Math.random,
): string {
  const keys = DIALOGUE_KEYS[normalizeStage(stage)];
  if (keys.length === 0) return '';
  const safeRng = typeof rng === 'function' ? rng : Math.random;
  const raw = safeRng();
  const ratio = Number.isFinite(raw) ? Math.max(0, Math.min(raw, 0.999999)) : 0;
  const idx = Math.floor(ratio * keys.length);
  return t((keys[idx] ?? keys[0])!);
}

export function pickStreakAwareDialogue(
  stage: unknown,
  streak: number,
  t: TFunction,
  rng: () => number = Math.random,
): string {
  const safeRng = typeof rng === 'function' ? rng : Math.random;
  const roll = safeRng();
  const rollRatio = Number.isFinite(roll) ? Math.max(0, Math.min(roll, 0.999999)) : 0;

  if (streak >= 1 && rollRatio < 0.4) {
    const tier = STREAK_DIALOGUE_KEYS.find((d) => streak >= d.minStreak);
    if (tier && tier.keys.length > 0) {
      const r2 = safeRng();
      const r2Ratio = Number.isFinite(r2) ? Math.max(0, Math.min(r2, 0.999999)) : 0;
      const idx = Math.floor(r2Ratio * tier.keys.length);
      return t((tier.keys[idx] ?? tier.keys[0])!);
    }
  }

  return pickRandomDialogue(stage, t, safeRng);
}

export function formatProgress(progress: ProgressPayload | null | undefined): string {
  const into = Math.max(Number(progress?.xp_into_level ?? 0), 0);
  const span = Math.max(Number(progress?.level_span ?? 0), 0);
  const ratio =
    span > 0 && Number.isFinite(Number(progress?.progress_ratio))
      ? Math.max(0, Math.min(Number(progress?.progress_ratio), 1))
      : 0;
  const pct = Math.round(ratio * 100);
  return `XP ${into} / ${span} (${pct}%)`;
}

const STAGE_ORDER: CharacterStage[] = ['seed', 'sprout', 'tree', 'bloom'];

export function stageIndex(stage: unknown): number {
  return STAGE_ORDER.indexOf(normalizeStage(stage));
}

export function shouldShowStageTransition(prev: unknown, next: unknown): boolean {
  if (prev == null || next == null) return false;
  const p = normalizeStage(prev);
  const n = normalizeStage(next);
  return p !== n;
}

export function progressBarWidthPct(progress: ProgressPayload | null | undefined): number {
  const ratio = Number(progress?.progress_ratio ?? 0);
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(ratio, 1)) * 100;
}
