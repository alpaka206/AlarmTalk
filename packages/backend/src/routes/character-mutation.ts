import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { typedRow } from '../lib/db-types';
import {
  computeLevelFromXp,
  computeStageFromLevel,
} from '../lib/character';
import { computeGrant, isXpEvent, type XpEvent } from '../lib/xpRules';
import { computeStreak, MILESTONE_BONUS_XP } from '../lib/streak';
import {
  resolveUserPk,
  loadOrCreateCharacter,
  loadStats,
  loadAchievements,
  serializeCharacter,
  ensureStatsRow,
  todayString,
} from './character-helpers';

const characterMutation = new Hono<AppEnv>();

characterMutation.post('/xp', async (c) => {
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
      const log = typedRow<{ event: string; granted_xp: number; affection_delta: number; capped: number }>(dup.rows[0]!);
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

export default characterMutation;
