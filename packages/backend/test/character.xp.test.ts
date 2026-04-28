import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import characterRoutes from '../src/routes/character';

function buildApp(userId = 'google-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/characters', characterRoutes);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

const TODAY = new Date().toISOString().split('T')[0];

function baseCharacter(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'char-1',
    user_id: 'user-pk-1',
    name: '내 캐릭터',
    level: 1,
    xp: 0,
    affection: 0,
    stage: 'seed',
    daily_xp: 0,
    daily_xp_reset_at: null,
    current_streak: 0,
    longest_streak: 0,
    last_wakeup_date: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

/**
 * alarm_completed DB call sequence (no milestone, no nonce):
 *  1. resolveUserPk → SELECT id FROM users
 *  2. loadOrCreateCharacter → SELECT * FROM characters
 *  3. UPDATE characters (xp + streak fields)
 *  4. INSERT INTO character_xp_logs
 *  5. ensureStatsRow → INSERT OR IGNORE INTO character_stats
 *  6. UPDATE character_stats
 *  7. loadOrCreateCharacter (refresh) → SELECT * FROM characters
 *  8. loadStats → SELECT FROM character_stats
 *  9. loadAchievements → SELECT FROM streak_achievements
 */

describe('POST /characters/xp', () => {
  it('event 검증 실패 → 400', async () => {
    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/characters/xp', { event: 'unknown_event' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('event');
  });

  it('사용자 없음 → 404', async () => {
    mockDB.pushResult([]); // resolveUserPk

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed' }),
    );
    expect(res.status).toBe(404);
  });

  it('여유 내 alarm_completed → 201, XP +30, affection +2', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]); // #1 resolveUserPk
    mockDB.pushResult([baseCharacter()]); // #2 loadOrCreateCharacter
    mockDB.pushResult([], 1); // #3 UPDATE characters
    mockDB.pushResult([], 1); // #4 INSERT character_xp_logs
    mockDB.pushResult([], 1); // #5 ensureStatsRow (INSERT OR IGNORE)
    mockDB.pushResult([], 1); // #6 UPDATE character_stats
    mockDB.pushResult([baseCharacter({ xp: 30, affection: 2, daily_xp: 30 })]); // #7 loadOrCreateCharacter (refresh)
    mockDB.pushResult([{ diligence: 1, health: 0, consistency: 1 }]); // #8 loadStats
    mockDB.pushResult([]); // #9 loadAchievements

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.event).toBe('alarm_completed');
    expect(body.grant.granted_xp).toBe(30);
    expect(body.grant.affection).toBe(2);
    expect(body.grant.capped).toBe(false);
    expect(body.grant.duplicated).toBe(false);
    expect(body.character.xp).toBe(30);
    expect(body.character.level).toBe(1);
    expect(body.character.stage).toBe('seed');
  });

  it('일일 캡 초과 → 남은 몫만 지급, capped=true', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]); // #1
    mockDB.pushResult([
      baseCharacter({
        xp: 190,
        affection: 10,
        daily_xp: 190,
        daily_xp_reset_at: TODAY,
      }),
    ]); // #2
    mockDB.pushResult([], 1); // #3 UPDATE characters
    mockDB.pushResult([], 1); // #4 INSERT log
    mockDB.pushResult([], 1); // #5 ensureStatsRow
    mockDB.pushResult([], 1); // #6 UPDATE character_stats
    mockDB.pushResult([
      baseCharacter({
        xp: 200,
        affection: 12,
        daily_xp: 200,
        daily_xp_reset_at: TODAY,
      }),
    ]); // #7 refresh
    mockDB.pushResult([{ diligence: 1, health: 0, consistency: 1 }]); // #8 loadStats
    mockDB.pushResult([]); // #9 loadAchievements

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(10);
    expect(body.grant.capped).toBe(true);
    expect(body.grant.affection).toBe(2);
    expect(body.character.xp).toBe(200);
  });

  it('날짜 바뀌면 daily_xp 리셋 후 재지급', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]); // #1
    mockDB.pushResult([
      baseCharacter({
        xp: 200,
        daily_xp: 200,
        daily_xp_reset_at: '2000-01-01',
      }),
    ]); // #2
    mockDB.pushResult([], 1); // #3 UPDATE characters
    mockDB.pushResult([], 1); // #4 INSERT log
    mockDB.pushResult([], 1); // #5 ensureStatsRow
    mockDB.pushResult([], 1); // #6 UPDATE character_stats
    mockDB.pushResult([
      baseCharacter({
        xp: 230,
        daily_xp: 30,
        daily_xp_reset_at: TODAY,
      }),
    ]); // #7 refresh
    mockDB.pushResult([{ diligence: 1, health: 0, consistency: 1 }]); // #8 loadStats
    mockDB.pushResult([]); // #9 loadAchievements

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(30);
    expect(body.grant.capped).toBe(false);
    expect(body.character.xp).toBe(230);
    const updateCall = mockDB.calls.find((c) => c.sql.startsWith('UPDATE characters'));
    expect(updateCall).toBeDefined();
    expect(updateCall!.args).toContain(TODAY);
  });

  it('client_nonce 중복 → 기존 로그 재응답, UPDATE/INSERT 호출 안 함', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]); // resolveUserPk
    mockDB.pushResult([
      {
        id: 'log-1',
        character_id: 'char-1',
        event: 'alarm_completed',
        client_nonce: 'nonce-abc',
        granted_xp: 30,
        affection_delta: 2,
        capped: 0,
        created_at: '2026-04-21',
      },
    ]); // duplicate lookup
    mockDB.pushResult([baseCharacter({ xp: 30, affection: 2, daily_xp: 30 })]); // loadOrCreateCharacter for dup response
    mockDB.pushResult([{ diligence: 1, health: 0, consistency: 1 }]); // loadStats
    mockDB.pushResult([]); // loadAchievements

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/characters/xp', {
        event: 'alarm_completed',
        client_nonce: 'nonce-abc',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grant.duplicated).toBe(true);
    expect(body.grant.granted_xp).toBe(30);
    expect(body.grant.affection).toBe(2);
    expect(mockDB.calls.some((c) => c.sql.startsWith('UPDATE characters'))).toBe(false);
    expect(mockDB.calls.some((c) => c.sql.includes('INSERT INTO character_xp_logs'))).toBe(
      false,
    );
  });

  it('캐릭터 없으면 자동 생성 후 지급', async () => {
    mockDB.pushResult([{ id: 'user-pk-2' }]); // #1 resolveUserPk
    mockDB.pushResult([]); // #2 SELECT characters (없음)
    mockDB.pushResult([], 1); // #3 INSERT characters
    mockDB.pushResult([baseCharacter({ id: 'char-new', user_id: 'user-pk-2' })]); // #4 SELECT after insert
    mockDB.pushResult([], 1); // #5 UPDATE characters (xp + streak)
    mockDB.pushResult([], 1); // #6 INSERT character_xp_logs
    mockDB.pushResult([], 1); // #7 ensureStatsRow
    mockDB.pushResult([], 1); // #8 UPDATE character_stats
    mockDB.pushResult([
      baseCharacter({
        id: 'char-new',
        user_id: 'user-pk-2',
        xp: 30,
        affection: 2,
        daily_xp: 30,
      }),
    ]); // #9 loadOrCreateCharacter (refresh)
    mockDB.pushResult([{ diligence: 1, health: 0, consistency: 1 }]); // #10 loadStats
    mockDB.pushResult([]); // #11 loadAchievements

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.character.id).toBe('char-new');
    expect(body.grant.granted_xp).toBe(30);
  });

  it('alarm_dismissed → XP 0, affection 0 이어도 로그는 남음', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]); // #1
    mockDB.pushResult([baseCharacter()]); // #2
    mockDB.pushResult([], 1); // #3 UPDATE characters
    mockDB.pushResult([], 1); // #4 INSERT log
    // alarm_dismissed does NOT trigger streak update, no ensureStatsRow/UPDATE stats
    mockDB.pushResult([baseCharacter()]); // #5 loadOrCreateCharacter (refresh)
    mockDB.pushResult([]); // #6 loadStats
    mockDB.pushResult([]); // #7 loadAchievements

    const app = buildApp();
    const res = await app.request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_dismissed' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(0);
    expect(body.grant.affection).toBe(0);

    const logInsert = mockDB.calls.find((c) =>
      c.sql.includes('INSERT INTO character_xp_logs'),
    );
    expect(logInsert).toBeDefined();
  });
});
