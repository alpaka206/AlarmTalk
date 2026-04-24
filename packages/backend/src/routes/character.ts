import { Hono } from 'hono';
import type { Row } from '@libsql/client/web';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { typedRow } from '../lib/db-types';
import {
  computeLevelFromXp,
  computeStageFromLevel,
  xpThresholdForLevel,
  type CharacterStage,
  type CharacterStats,
} from '../lib/character';
import { computeGrant, isXpEvent, type XpEvent } from '../lib/xpRules';
import { computeStreak, MILESTONE_BONUS_XP } from '../lib/streak';

const character = new Hono<AppEnv>();

interface CharacterRow {
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

interface StreakAchievementRow {
  milestone: number;
  bonus_xp: number;
  achieved_at: string;
}

async function resolveUserPk(
  db: ReturnType<typeof getDB>,
  googleId: string,
): Promise<string | null> {
  const res = await db.execute({
    sql: 'SELECT id FROM users WHERE google_id = ?',
    args: [googleId],
  });
  return res.rows.length === 0 ? null : String(res.rows[0].id);
}

function rowToCharacter(row: Row): CharacterRow {
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

async function loadOrCreateCharacter(
  db: ReturnType<typeof getDB>,
  userPk: string,
): Promise<CharacterRow> {
  const existing = await db.execute({
    sql: 'SELECT * FROM characters WHERE user_id = ?',
    args: [userPk],
  });
  if (existing.rows.length > 0) {
    return rowToCharacter(existing.rows[0]);
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
  return rowToCharacter(created.rows[0]);
}

function buildProgress(xp: number, level: number) {
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

function serializeCharacter(
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

async function loadStats(
  db: ReturnType<typeof getDB>,
  characterId: string,
): Promise<CharacterStats | null> {
  const res = await db.execute({
    sql: 'SELECT diligence, health, consistency FROM character_stats WHERE character_id = ?',
    args: [characterId],
  });
  if (res.rows.length === 0) return null;
  const r = typedRow<{ diligence: number; health: number; consistency: number }>(res.rows[0]);
  return {
    diligence: Number(r.diligence ?? 0),
    health: Number(r.health ?? 0),
    consistency: Number(r.consistency ?? 0),
  };
}

async function loadAchievements(
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

async function ensureStatsRow(
  db: ReturnType<typeof getDB>,
  characterId: string,
): Promise<void> {
  await db.execute({
    sql: `INSERT OR IGNORE INTO character_stats (id, character_id) VALUES (?, ?)`,
    args: [crypto.randomUUID(), characterId],
  });
}

function todayString(now: Date = new Date()): string {
  return now.toISOString().split('T')[0];
}

/**
 * GET /characters/me
 * 현재 사용자의 캐릭터를 반환. 없으면 기본값(level=1, xp=0, stage='seed') 으로 생성.
 */
character.get('/me', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);

  const row = await loadOrCreateCharacter(db, userPk);
  const [stats, achievements] = await Promise.all([
    loadStats(db, row.id),
    loadAchievements(db, row.id),
  ]);
  return c.json(serializeCharacter(row, stats, achievements));
});

/**
 * POST /characters/xp { event, client_nonce? }
 * 이벤트별 XP·애정도 지급. client_nonce 가 있으면 멱등 (중복 호출 시 기존 결과 반환).
 * 날짜가 바뀌면 daily_xp 리셋 후 재산정.
 */
character.post('/xp', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const body = await c.req
    .json<{ event?: unknown; client_nonce?: unknown; local_date?: unknown }>()
    .catch(() => ({ event: undefined, client_nonce: undefined, local_date: undefined }));

  if (!isXpEvent(body.event)) {
    return c.json({ error: '지원하지 않는 event 입니다', error_code: 'UNSUPPORTED_EVENT' }, 400);
  }
  const event = body.event;
  const clientNonce =
    typeof body.client_nonce === 'string' && body.client_nonce.trim().length > 0
      ? body.client_nonce.trim()
      : null;
  const localDate =
    typeof body.local_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.local_date)
      ? body.local_date
      : todayString();

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);

  if (clientNonce) {
    const dup = await db.execute({
      sql: `SELECT l.* FROM character_xp_logs l
            JOIN characters c ON c.id = l.character_id
            WHERE c.user_id = ? AND l.client_nonce = ?
            LIMIT 1`,
      args: [userPk, clientNonce],
    });
    if (dup.rows.length > 0) {
      const log = typedRow<{ event: string; granted_xp: number; affection_delta: number; capped: number }>(dup.rows[0]);
      const row = await loadOrCreateCharacter(db, userPk);
      const [stats, achievements] = await Promise.all([
        loadStats(db, row.id),
        loadAchievements(db, row.id),
      ]);
      return c.json({
        ...serializeCharacter(row, stats, achievements),
        grant: {
          event: String(log.event),
          granted_xp: Number(log.granted_xp ?? 0),
          affection: Number(log.affection_delta ?? 0),
          capped: Number(log.capped ?? 0) === 1,
          remaining_cap: 0,
          duplicated: true,
        },
      });
    }
  }

  const today = todayString();
  const current = await loadOrCreateCharacter(db, userPk);
  const dailyXpBase =
    current.daily_xp_reset_at === today ? current.daily_xp : 0;

  const grant = computeGrant(event, dailyXpBase);
  let totalGrantedXp = grant.xp.grantedXp;
  let totalAffection = grant.affection;
  let newDailyXp = dailyXpBase + grant.xp.grantedXp;

  // Streak computation for alarm_completed
  let streakUpdated = false;
  const milestoneEvents: XpEvent[] = [];
  let newStreak = current.current_streak;
  let newLongest = current.longest_streak;
  let newLastWakeup = current.last_wakeup_date;

  if (event === 'alarm_completed') {
    const result = computeStreak(current.last_wakeup_date, localDate, current.current_streak);
    newStreak = result.newStreak;
    newLongest = Math.max(current.longest_streak, result.newStreak);
    streakUpdated = result.isNewDay;

    if (result.isNewDay) {
      newLastWakeup = localDate;
    }

    if (result.milestoneReached) {
      const bonusXp = MILESTONE_BONUS_XP[result.milestoneReached];
      if (bonusXp) {
        const milestoneEvent = `streak_bonus_${result.milestoneReached}` as XpEvent;
        if (isXpEvent(milestoneEvent)) {
          milestoneEvents.push(milestoneEvent);
        }
      }
    }
  }

  let newXp = current.xp + totalGrantedXp;
  const newAffectionTotal = current.affection + totalAffection;

  // Apply main XP update + streak fields
  const newLevel = computeLevelFromXp(newXp);
  const newStage = computeStageFromLevel(newLevel);

  await db.execute({
    sql: `UPDATE characters
          SET xp = ?, affection = ?, level = ?, stage = ?,
              daily_xp = ?, daily_xp_reset_at = ?,
              current_streak = ?, longest_streak = ?, last_wakeup_date = ?,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [
      newXp, newAffectionTotal, newLevel, newStage,
      newDailyXp, today,
      newStreak, newLongest, newLastWakeup,
      current.id,
    ],
  });

  const logId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO character_xp_logs
          (id, character_id, event, client_nonce, granted_xp, affection_delta, capped)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      logId, current.id, event, clientNonce,
      grant.xp.grantedXp, grant.affection,
      grant.xp.capped ? 1 : 0,
    ],
  });

  // Process milestone bonus events
  const milestoneGrants: Array<{ event: XpEvent; xp: number }> = [];
  for (const mEvent of milestoneEvents) {
    const existing = await db.execute({
      sql: 'SELECT id FROM streak_achievements WHERE character_id = ? AND milestone = ?',
      args: [current.id, newStreak],
    });
    if (existing.rows.length > 0) continue;

    const mGrant = computeGrant(mEvent, newDailyXp);
    newXp += mGrant.xp.grantedXp;
    newDailyXp += mGrant.xp.grantedXp;
    totalGrantedXp += mGrant.xp.grantedXp;
    totalAffection += mGrant.affection;

    const updatedLevel = computeLevelFromXp(newXp);
    const updatedStage = computeStageFromLevel(updatedLevel);

    await db.execute({
      sql: `UPDATE characters
            SET xp = ?, level = ?, stage = ?,
                affection = affection + ?,
                daily_xp = ?,
                updated_at = datetime('now')
            WHERE id = ?`,
      args: [newXp, updatedLevel, updatedStage, mGrant.affection, newDailyXp, current.id],
    });

    await db.execute({
      sql: `INSERT INTO streak_achievements (id, character_id, milestone, bonus_xp)
            VALUES (?, ?, ?, ?)`,
      args: [crypto.randomUUID(), current.id, newStreak, mGrant.xp.grantedXp],
    });

    await db.execute({
      sql: `INSERT INTO character_xp_logs
            (id, character_id, event, client_nonce, granted_xp, affection_delta, capped)
            VALUES (?, ?, ?, NULL, ?, ?, 0)`,
      args: [crypto.randomUUID(), current.id, mEvent, mGrant.xp.grantedXp, mGrant.affection],
    });

    milestoneGrants.push({ event: mEvent, xp: mGrant.xp.grantedXp });
  }

  // Update character_stats for alarm_completed
  if (event === 'alarm_completed' && streakUpdated) {
    await ensureStatsRow(db, current.id);
    await db.execute({
      sql: `UPDATE character_stats
            SET diligence = diligence + 1, consistency = consistency + 1,
                updated_at = datetime('now')
            WHERE character_id = ?`,
      args: [current.id],
    });
  }

  const refreshed = await loadOrCreateCharacter(db, userPk);
  const [stats, achievements] = await Promise.all([
    loadStats(db, refreshed.id),
    loadAchievements(db, refreshed.id),
  ]);

  return c.json(
    {
      ...serializeCharacter(refreshed, stats, achievements),
      grant: {
        event,
        granted_xp: totalGrantedXp,
        affection: totalAffection,
        capped: grant.xp.capped,
        remaining_cap: grant.xp.remainingCap,
        duplicated: false,
        milestone_grants: milestoneGrants.length > 0 ? milestoneGrants : undefined,
      },
    },
    201,
  );
});

export default character;
