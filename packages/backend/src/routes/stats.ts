import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { logRouteError } from '../lib/logger';

const stats = new Hono<AppEnv>();

stats.get('/', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000).toISOString();

    const trendSql = (table: string, userClause: string) => `
      SELECT
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as this_week,
        SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) as last_week
      FROM ${table} WHERE ${userClause}`;

    const [
      alarmsRes, messagesRes, voicesRes, friendsRes, giftsReceivedRes, giftsSentRes,
      alarmsTrend, messagesTrend, voicesTrend, friendsTrend, giftsTrend,
    ] = await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active
              FROM alarms WHERE user_id = ? OR target_user_id = ?`,
        args: [userId, userId],
      }),
      db.execute({
        sql: 'SELECT COUNT(*) as total FROM messages WHERE user_id = ?',
        args: [userId],
      }),
      db.execute({
        sql: 'SELECT COUNT(*) as total FROM voice_profiles WHERE user_id = ?',
        args: [userId],
      }),
      db.execute({
        sql: `SELECT COUNT(*) as total FROM friendships
              WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'`,
        args: [userId, userId],
      }),
      db.execute({
        sql: `SELECT COUNT(*) as total,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
              FROM gifts WHERE recipient_id = ?`,
        args: [userId],
      }),
      db.execute({
        sql: 'SELECT COUNT(*) as total FROM gifts WHERE sender_id = ?',
        args: [userId],
      }),
      db.execute({
        sql: trendSql('alarms', 'user_id = ? OR target_user_id = ?'),
        args: [weekAgo, twoWeeksAgo, weekAgo, userId, userId],
      }),
      db.execute({
        sql: trendSql('messages', 'user_id = ?'),
        args: [weekAgo, twoWeeksAgo, weekAgo, userId],
      }),
      db.execute({
        sql: trendSql('voice_profiles', 'user_id = ?'),
        args: [weekAgo, twoWeeksAgo, weekAgo, userId],
      }),
      db.execute({
        sql: trendSql('friendships', "(user_a = ? OR user_b = ?) AND status = 'accepted'"),
        args: [weekAgo, twoWeeksAgo, weekAgo, userId, userId],
      }),
      db.execute({
        sql: trendSql('gifts', 'recipient_id = ?'),
        args: [weekAgo, twoWeeksAgo, weekAgo, userId],
      }),
    ]);

    const trend = (res: typeof alarmsTrend) => ({
      thisWeek: Number(res.rows[0]?.this_week) || 0,
      lastWeek: Number(res.rows[0]?.last_week) || 0,
    });

    return c.json({
      alarms: {
        total: Number(alarmsRes.rows[0]?.total ?? 0),
        active: Number(alarmsRes.rows[0]?.active ?? 0),
      },
      messages: { total: Number(messagesRes.rows[0]?.total ?? 0) },
      voices: { total: Number(voicesRes.rows[0]?.total ?? 0) },
      friends: { total: Number(friendsRes.rows[0]?.total ?? 0) },
      gifts: {
        received: Number(giftsReceivedRes.rows[0]?.total ?? 0),
        receivedPending: Number(giftsReceivedRes.rows[0]?.pending ?? 0),
        sent: Number(giftsSentRes.rows[0]?.total ?? 0),
      },
      trends: {
        alarms: trend(alarmsTrend),
        messages: trend(messagesTrend),
        voices: trend(voicesTrend),
        friends: trend(friendsTrend),
        gifts: trend(giftsTrend),
      },
    });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to fetch stats', error_code: 'FETCH_STATS_FAILED' }, 500);
  }
});

stats.get('/activity', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const [recentAlarms, recentMessages, recentGifts, recentVoices] = await Promise.all([
      db.execute({
        sql: `SELECT id, time, created_at, 'alarm' as type FROM alarms
              WHERE user_id = ? OR target_user_id = ?
              ORDER BY created_at DESC LIMIT 5`,
        args: [userId, userId],
      }),
      db.execute({
        sql: `SELECT id, text, created_at, 'message' as type FROM messages
              WHERE user_id = ?
              ORDER BY created_at DESC LIMIT 5`,
        args: [userId],
      }),
      db.execute({
        sql: `SELECT id, note, status, created_at, 'gift' as type FROM gifts
              WHERE sender_id = ? OR recipient_id = ?
              ORDER BY created_at DESC LIMIT 5`,
        args: [userId, userId],
      }),
      db.execute({
        sql: `SELECT id, name, status, created_at, 'voice' as type FROM voice_profiles
              WHERE user_id = ?
              ORDER BY created_at DESC LIMIT 5`,
        args: [userId],
      }),
    ]);

    const activities = [
      ...recentAlarms.rows.map((r) => ({
        id: r.id as string,
        type: 'alarm' as const,
        summary: `알람 ${r.time}`,
        created_at: r.created_at as string,
      })),
      ...recentMessages.rows.map((r) => ({
        id: r.id as string,
        type: 'message' as const,
        summary: String(r.text).slice(0, 50),
        created_at: r.created_at as string,
      })),
      ...recentGifts.rows.map((r) => ({
        id: r.id as string,
        type: 'gift' as const,
        summary: r.note ? String(r.note).slice(0, 50) : `선물 (${r.status})`,
        created_at: r.created_at as string,
      })),
      ...recentVoices.rows.map((r) => ({
        id: r.id as string,
        type: 'voice' as const,
        summary: `음성 "${r.name}" (${r.status})`,
        created_at: r.created_at as string,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
     .slice(0, 10);

    return c.json({ activities });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to fetch activity', error_code: 'FETCH_ACTIVITY_FAILED' }, 500);
  }
});

export default stats;
