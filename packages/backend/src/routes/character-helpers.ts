import type { Row } from '@libsql/client/web';
import type { CharacterStage, CharacterStats } from '../lib/character';
import {
  computeLevelFromXp,
  computeStageFromLevel,
  xpThresholdForLevel,
} from '../lib/character';
import { typedRow } from '../lib/db-types';
import { getDB } from '../lib/db';

export interface CharacterRow {
  id: string;
  user_id: string;
  name: string;
  level: number;
  xp: number;
  affection: number;
  stage: CharacterStage;
  daily_xp: number;
  daily_xp_reset_at: string | null;
  current_streak: number;
  longest_streak: number;
  last_wakeup_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface StreakAchievementRow {
  milestone: number;
  bonus_xp: number;
  achieved_at: string;
}

export async function resolveUserPk(
  db: ReturnType<typeof getDB>,
  googleId: string,
): Promise<string | null> {
  const res = await db.execute({
    sql: 'SELECT id FROM users WHERE google_id = ?',
    args: [googleId],
  });
  return res.rows.length === 0 ? null : String(res.rows[0]!.id);
}

export function rowToCharacter(row: Row): CharacterRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name ?? '내 캐릭터'),
    level: Number(row.level ?? 1),
    xp: Number(row.xp ?? 0),
    affection: Number(row.affection ?? 0),
    stage: (row.stage as CharacterStage) ?? 'seed',
    daily_xp: Number(row.daily_xp ?? 0),
    daily_xp_reset_at: (row.daily_xp_reset_at as string | null) ?? null,
    current_streak: Number(row.current_streak ?? 0),
    longest_streak: Number(row.longest_streak ?? 0),
    last_wakeup_date: (row.last_wakeup_date as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

export async function loadOrCreateCharacter(
  db: ReturnType<typeof getDB>,
  userPk: string,
): Promise<CharacterRow> {
  const existing = await db.execute({
    sql: 'SELECT * FROM characters WHERE user_id = ?',
    args: [userPk],
  });
  if (existing.rows.length > 0) {
    return rowToCharacter(existing.rows[0]!);
  }
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO characters (id, user_id, name, level, xp, affection, stage)
          VALUES (?, ?, ?, 1, 0, 0, 'seed')`,
    args: [id, userPk, '내 캐릭터'],
  });
  const created = await db.execute({
    sql: 'SELECT * FROM characters WHERE id = ?',
    args: [id],
  });
  return rowToCharacter(created.rows[0]!);
}

export function buildProgress(xp: number, level: number) {
  const current = xpThresholdForLevel(level);
  const next = xpThresholdForLevel(level + 1);
  const span = Math.max(next - current, 1);
  const into = Math.max(xp - current, 0);
  return {
    xp_into_level: into,
    xp_to_next_level: Math.max(next - xp, 0),
    level_span: next - current,
    progress_ratio: Math.min(into / span, 1),
  };
}

export function serializeCharacter(
  row: CharacterRow,
  stats: CharacterStats | null = null,
  achievements: StreakAchievementRow[] = [],
) {
  const level = computeLevelFromXp(row.xp);
  const stage = computeStageFromLevel(level);
  return {
    character: { ...row, level, stage },
    progress: buildProgress(row.xp, level),
    streak: {
      current: row.current_streak,
      longest: row.longest_streak,
      last_wakeup_date: row.last_wakeup_date,
    },
    stats: stats ?? { diligence: 0, health: 0, consistency: 0 },
    achievements,
  };
}

export async function loadStats(
  db: ReturnType<typeof getDB>,
  characterId: string,
): Promise<CharacterStats | null> {
  const res = await db.execute({
    sql: 'SELECT diligence, health, consistency FROM character_stats WHERE character_id = ?',
    args: [characterId],
  });
  if (res.rows.length === 0) return null;
  const r = typedRow<{ diligence: number; health: number; consistency: number }>(res.rows[0]!);
  return {
    diligence: Number(r.diligence ?? 0),
    health: Number(r.health ?? 0),
    consistency: Number(r.consistency ?? 0),
  };
}

export async function loadAchievements(
  db: ReturnType<typeof getDB>,
  characterId: string,
): Promise<StreakAchievementRow[]> {
  const res = await db.execute({
    sql: 'SELECT milestone, bonus_xp, achieved_at FROM streak_achievements WHERE character_id = ? ORDER BY milestone',
    args: [characterId],
  });
  return res.rows.map((r) => {
    const row = typedRow<{ milestone: number; bonus_xp: number; achieved_at: string }>(r);
    return {
      milestone: Number(row.milestone),
      bonus_xp: Number(row.bonus_xp),
      achieved_at: String(row.achieved_at ?? ''),
    };
  });
}

export async function ensureStatsRow(
  db: ReturnType<typeof getDB>,
  characterId: string,
): Promise<void> {
  await db.execute({
    sql: `INSERT OR IGNORE INTO character_stats (id, character_id) VALUES (?, ?)`,
    args: [crypto.randomUUID(), characterId],
  });
}

export function todayString(now: Date = new Date()): string {
  return now.toISOString().split('T')[0]!;
}
