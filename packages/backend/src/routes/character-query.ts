import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import {
  resolveUserPk,
  loadOrCreateCharacter,
  loadStats,
  loadAchievements,
  serializeCharacter,
} from './character-helpers';

const characterQuery = new Hono<AppEnv>();

characterQuery.get('/me', async (c) => {
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

export default characterQuery;
