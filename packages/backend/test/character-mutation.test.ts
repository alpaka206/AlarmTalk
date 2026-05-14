import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import characterMutation from '../src/routes/character-mutation';

const CHAR_ROW = {
  id: 'char-1',
  user_id: 'pk1',
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
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

function buildApp(userId = 'google-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/characters', characterMutation);
  return app;
}

function pushBasicXpFlow(char = CHAR_ROW, refreshed = { ...CHAR_ROW, xp: 5 }) {
  mockDB.pushResult([{ id: 'pk1' }]);
  mockDB.pushResult([char]);
  mockDB.pushResult([], 1);
  mockDB.pushResult([], 1);
  mockDB.pushResult([refreshed]);
  mockDB.pushResult([]);
  mockDB.pushResult([]);
}

function pushAlarmCompletedFlow(char = CHAR_ROW, refreshed = { ...CHAR_ROW, xp: 5, current_streak: 1, last_wakeup_date: '2026-04-25' }) {
  mockDB.pushResult([{ id: 'pk1' }]);
  mockDB.pushResult([char]);
  mockDB.pushResult([], 1);
  mockDB.pushResult([], 1);
  mockDB.pushResult([], 1);
  mockDB.pushResult([], 1);
  mockDB.pushResult([refreshed]);
  mockDB.pushResult([]);
  mockDB.pushResult([]);
}

beforeEach(() => {
  mockDB.reset();
});

describe('POST /characters/xp (characterMutation)', () => {
  it('resolveUserPk SQL — google_id 바인딩 검증', async () => {
    mockDB.pushResult([]);
    const res = await buildApp('test-google-id').request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed' }),
    );
    expect(res.status).toBe(404);
    const userQuery = mockDB.calls[0]!;
    expect(userQuery.sql).toContain('FROM users WHERE google_id');
    expect(userQuery.args[0]).toBe('test-google-id');
  });

  it('family_alarm_received — 10xp, 3 affection', async () => {
    const refreshed = { ...CHAR_ROW, xp: 10, affection: 3, daily_xp: 10 };
    pushBasicXpFlow(CHAR_ROW, refreshed);
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'family_alarm_received' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.event).toBe('family_alarm_received');
    expect(body.grant.granted_xp).toBe(10);
    expect(body.grant.affection).toBe(3);
    expect(body.grant.capped).toBe(false);
  });

  it('UPDATE characters SQL — 10개 바인딩 인자 순서 검증', async () => {
    pushAlarmCompletedFlow();
    await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }),
    );
    const updateQuery = mockDB.calls.find(
      (c) => c.sql.includes('UPDATE characters') && c.sql.includes('SET xp'),
    );
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.args).toHaveLength(10);
    expect(updateQuery!.args[0]).toBe(5);
    expect(updateQuery!.args[1]).toBe(2);
    expect(updateQuery!.args[9]).toBe('char-1');
  });

  it('INSERT character_xp_logs — 7개 인자 + client_nonce null', async () => {
    pushAlarmCompletedFlow();
    await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed' }),
    );
    const logInsert = mockDB.calls.find(
      (c) => c.sql.includes('INSERT INTO character_xp_logs'),
    );
    expect(logInsert).toBeDefined();
    expect(logInsert!.args).toHaveLength(7);
    expect(logInsert!.args[1]).toBe('char-1');
    expect(logInsert!.args[2]).toBe('alarm_completed');
    expect(logInsert!.args[3]).toBeNull();
    expect(logInsert!.args[4]).toBe(5);
    expect(logInsert!.args[5]).toBe(2);
    expect(logInsert!.args[6]).toBe(0);
  });

  it('client_nonce 비null — xp_logs에 trim된 값 저장', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([]);
    pushAlarmCompletedFlow();
    await buildApp().request(
      jsonReq('POST', '/characters/xp', {
        event: 'alarm_completed',
        client_nonce: '  my-nonce-123  ',
      }),
    );
    const nonceCheck = mockDB.calls.find(
      (c) => c.sql.includes('character_xp_logs') && c.sql.includes('client_nonce'),
    );
    expect(nonceCheck).toBeDefined();
    expect(nonceCheck!.args).toContain('my-nonce-123');
  });

  it('non-alarm event → 스트릭 업데이트 없음 + stats 쿼리 없음', async () => {
    pushBasicXpFlow();
    await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_snoozed' }),
    );
    const statsUpdate = mockDB.calls.find(
      (c) => c.sql.includes('UPDATE character_stats'),
    );
    expect(statsUpdate).toBeUndefined();
    const ensureStats = mockDB.calls.find(
      (c) => c.sql.includes('INSERT OR IGNORE INTO character_stats'),
    );
    expect(ensureStats).toBeUndefined();
  });

  it('alarm_completed + isNewDay=true → ensureStatsRow + UPDATE stats 실행', async () => {
    pushAlarmCompletedFlow();
    await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }),
    );
    const ensureStats = mockDB.calls.find(
      (c) => c.sql.includes('INSERT OR IGNORE INTO character_stats'),
    );
    expect(ensureStats).toBeDefined();
    expect(ensureStats!.args[1]).toBe('char-1');

    const statsUpdate = mockDB.calls.find(
      (c) => c.sql.includes('UPDATE character_stats') && c.sql.includes('diligence'),
    );
    expect(statsUpdate).toBeDefined();
    expect(statsUpdate!.args[0]).toBe(1);
    expect(statsUpdate!.args[1]).toBe('char-1');
  });

  it('alarm_completed same day → 성실함만 증가하고 스트릭 능력치는 유지', async () => {
    const charToday = {
      ...CHAR_ROW,
      current_streak: 3,
      last_wakeup_date: '2026-04-25',
      daily_xp: 10,
      daily_xp_reset_at: '2026-04-25',
    };
    pushAlarmCompletedFlow(charToday, { ...charToday, xp: 5, daily_xp: 15 });
    await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }),
    );
    const ensureStats = mockDB.calls.find(
      (c) => c.sql.includes('INSERT OR IGNORE INTO character_stats'),
    );
    expect(ensureStats).toBeDefined();
    const statsUpdate = mockDB.calls.find(
      (c) => c.sql.includes('UPDATE character_stats'),
    );
    expect(statsUpdate).toBeDefined();
    expect(statsUpdate!.args[0]).toBe(0);
    expect(statsUpdate!.args[1]).toBe('char-1');
  });

  it('longest_streak 자동 갱신 — newStreak > longest일 때', async () => {
    const charStreak = {
      ...CHAR_ROW,
      current_streak: 5,
      longest_streak: 5,
      last_wakeup_date: '2026-04-24',
    };
    const refreshed = {
      ...charStreak,
      xp: 5,
      current_streak: 6,
      longest_streak: 6,
      daily_xp: 5,
      last_wakeup_date: '2026-04-25',
    };
    pushAlarmCompletedFlow(charStreak, refreshed);
    await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }),
    );
    const updateQuery = mockDB.calls.find(
      (c) => c.sql.includes('UPDATE characters') && c.sql.includes('longest_streak'),
    );
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.args[7]).toBe(6);
  });

  it('longest_streak 유지 — newStreak <= longest일 때', async () => {
    const charStreak = {
      ...CHAR_ROW,
      current_streak: 10,
      longest_streak: 20,
      last_wakeup_date: '2026-04-22',
    };
    const refreshed = {
      ...charStreak,
      xp: 5,
      current_streak: 1,
      daily_xp: 5,
      last_wakeup_date: '2026-04-25',
    };
    pushAlarmCompletedFlow(charStreak, refreshed);
    await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }),
    );
    const updateQuery = mockDB.calls.find(
      (c) => c.sql.includes('UPDATE characters') && c.sql.includes('longest_streak'),
    );
    expect(updateQuery!.args[7]).toBe(20);
  });

  it('30일 마일스톤 달성 시 500 XP 보너스', async () => {
    const charStreak29 = {
      ...CHAR_ROW,
      current_streak: 29,
      longest_streak: 29,
      last_wakeup_date: '2026-04-24',
    };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charStreak29]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const refreshed = {
      ...charStreak29,
      xp: 505,
      current_streak: 30,
      longest_streak: 30,
      daily_xp: 505,
      last_wakeup_date: '2026-04-25',
    };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([{ milestone: 30, bonus_xp: 500, achieved_at: '2026-04-25' }]);
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(505);
    expect(body.grant.milestone_grants).toHaveLength(1);
    expect(body.grant.milestone_grants[0].event).toBe('streak_bonus_30');
    expect(body.grant.milestone_grants[0].xp).toBe(500);
  });

  it('90일 마일스톤 달성 시 2000 XP 보너스', async () => {
    const charStreak89 = {
      ...CHAR_ROW,
      current_streak: 89,
      longest_streak: 89,
      last_wakeup_date: '2026-04-24',
    };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charStreak89]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const refreshed = {
      ...charStreak89,
      xp: 2005,
      current_streak: 90,
      longest_streak: 90,
      daily_xp: 2005,
      last_wakeup_date: '2026-04-25',
    };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([{ milestone: 90, bonus_xp: 2000, achieved_at: '2026-04-25' }]);
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(2005);
    expect(body.grant.milestone_grants).toHaveLength(1);
    expect(body.grant.milestone_grants[0].event).toBe('streak_bonus_90');
    expect(body.grant.milestone_grants[0].xp).toBe(2000);
  });

  it('milestone_grants 미포함 — 마일스톤 미달성 시 undefined', async () => {
    const charStreak2 = {
      ...CHAR_ROW,
      current_streak: 2,
      longest_streak: 2,
      last_wakeup_date: '2026-04-24',
    };
    pushAlarmCompletedFlow(charStreak2, {
      ...charStreak2,
      xp: 5,
      current_streak: 3,
      daily_xp: 5,
      last_wakeup_date: '2026-04-25',
    });
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }),
    );
    const body = await res.json();
    expect(body.grant.milestone_grants).toBeUndefined();
  });

  it('milestone check SQL — character_id + milestone 바인딩', async () => {
    const charStreak6 = {
      ...CHAR_ROW,
      current_streak: 6,
      longest_streak: 6,
      last_wakeup_date: '2026-04-24',
    };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charStreak6]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{ id: 'existing' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const refreshed = { ...charStreak6, xp: 5, current_streak: 7, daily_xp: 5 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }),
    );
    const milestoneCheck = mockDB.calls.find(
      (c) => c.sql.includes('streak_achievements') && c.sql.includes('SELECT'),
    );
    expect(milestoneCheck).toBeDefined();
    expect(milestoneCheck!.args[0]).toBe('char-1');
    expect(milestoneCheck!.args[1]).toBe(7);
  });

  it('milestone INSERT — streak_achievements에 정확한 값 저장', async () => {
    const charStreak6 = {
      ...CHAR_ROW,
      current_streak: 6,
      longest_streak: 6,
      last_wakeup_date: '2026-04-24',
    };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charStreak6]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const refreshed = { ...charStreak6, xp: 105, current_streak: 7, daily_xp: 105 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }),
    );
    const achInsert = mockDB.calls.find(
      (c) => c.sql.includes('INSERT INTO streak_achievements'),
    );
    expect(achInsert).toBeDefined();
    expect(achInsert!.args[1]).toBe('char-1');
    expect(achInsert!.args[2]).toBe(7);
    expect(achInsert!.args[3]).toBe(100);
  });

  it('milestone xp_log — event=streak_bonus_7, client_nonce=NULL', async () => {
    const charStreak6 = {
      ...CHAR_ROW,
      current_streak: 6,
      longest_streak: 6,
      last_wakeup_date: '2026-04-24',
    };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charStreak6]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const refreshed = { ...charStreak6, xp: 105, current_streak: 7, daily_xp: 105 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }),
    );
    const logInserts = mockDB.calls.filter(
      (c) => c.sql.includes('INSERT INTO character_xp_logs'),
    );
    expect(logInserts.length).toBe(2);
    const milestoneLog = logInserts[1]!;
    expect(milestoneLog.sql).toContain('NULL');
    expect(milestoneLog.args[2]).toBe('streak_bonus_7');
    expect(milestoneLog.args[3]).toBe(100);
    expect(milestoneLog.args[4]).toBe(0);
  });

  it('valid local_date 포맷 — 그대로 streak 계산에 전달', async () => {
    const charStreak = {
      ...CHAR_ROW,
      current_streak: 3,
      longest_streak: 3,
      last_wakeup_date: '2026-03-31',
    };
    const refreshed = {
      ...charStreak,
      xp: 5,
      current_streak: 1,
      daily_xp: 5,
      last_wakeup_date: '2026-04-02',
    };
    pushAlarmCompletedFlow(charStreak, refreshed);
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-02' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.streak.current).toBe(1);
  });

  it('daily_xp_reset_at === today → dailyXpBase 유지', async () => {
    const today = new Date().toISOString().split('T')[0]!;
    const charWithDailyXp = {
      ...CHAR_ROW,
      xp: 20,
      daily_xp: 100,
      daily_xp_reset_at: today,
    };
    pushBasicXpFlow(charWithDailyXp, { ...charWithDailyXp, xp: 15, daily_xp: 100 });
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_snoozed' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(-5);
  });

  it('nonce dup path — loadOrCreateCharacter + loadStats + loadAchievements 호출', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{
      event: 'alarm_completed',
      granted_xp: 10,
      affection_delta: 2,
      capped: 0,
    }]);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([{ diligence: 5, health: 2, consistency: 4 }]);
    mockDB.pushResult([{ milestone: 7, bonus_xp: 100, achieved_at: '2026-04-20' }]);
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', {
        event: 'alarm_completed',
        client_nonce: 'dup-nonce',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grant.duplicated).toBe(true);
    expect(body.stats.diligence).toBe(5);
    expect(body.achievements).toHaveLength(1);
    expect(body.achievements[0].milestone).toBe(7);
  });

  it('nonce dup path — capped=1 → capped=true 변환', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{
      event: 'alarm_completed',
      granted_xp: 10,
      affection_delta: 2,
      capped: 1,
    }]);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', {
        event: 'alarm_completed',
        client_nonce: 'dup-capped',
      }),
    );
    const body = await res.json();
    expect(body.grant.capped).toBe(true);
    expect(body.grant.remaining_cap).toBe(0);
  });

  it('level/stage 재계산 — XP 기반 (DB 저장값 아닌 계산값)', async () => {
    const refreshed = {
      ...CHAR_ROW,
      xp: 500,
      level: 1,
      stage: 'seed',
    };
    pushBasicXpFlow(CHAR_ROW, refreshed);
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'friend_invited' }),
    );
    const body = await res.json();
    expect(body.character.level).toBe(3);
    expect(body.character.stage).toBe('sprout');
  });

  it('refreshed character에서 progress 정확히 계산', async () => {
    const refreshed = { ...CHAR_ROW, xp: 150 };
    pushBasicXpFlow(CHAR_ROW, refreshed);
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'friend_invited' }),
    );
    const body = await res.json();
    expect(body.progress.xp_into_level).toBe(50);
    expect(body.progress.xp_to_next_level).toBe(250);
    expect(body.progress.level_span).toBe(300);
  });

  it('event 타입이 숫자면 UNSUPPORTED_EVENT', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 123 }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('UNSUPPORTED_EVENT');
  });

  it('event 빈 문자열 → UNSUPPORTED_EVENT', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: '' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('UNSUPPORTED_EVENT');
  });

  it('first wakeup (last_wakeup_date=null) → streak=1', async () => {
    pushAlarmCompletedFlow(CHAR_ROW, {
      ...CHAR_ROW,
      xp: 5,
      current_streak: 1,
      last_wakeup_date: '2026-04-25',
    });
    const res = await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }),
    );
    const body = await res.json();
    expect(body.streak.current).toBe(1);
  });

  it('capped 플래그 INSERT xp_log — 정확히 일일 캡 도달 시 0 저장', async () => {
    const today = new Date().toISOString().split('T')[0]!;
    const charNearCap = {
      ...CHAR_ROW,
      daily_xp: 195,
      daily_xp_reset_at: today,
      last_wakeup_date: today,
      current_streak: 3,
    };
    pushAlarmCompletedFlow(charNearCap, { ...charNearCap, xp: 5, daily_xp: 200 });
    await buildApp().request(
      jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: today }),
    );
    const logInsert = mockDB.calls.find(
      (c) => c.sql.includes('INSERT INTO character_xp_logs'),
    );
    expect(logInsert!.args[6]).toBe(0);
  });
});
