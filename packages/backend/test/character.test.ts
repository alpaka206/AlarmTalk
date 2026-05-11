import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';
import {
  CHARACTER_STAGES,
  computeLevelFromXp,
  computeStageFromLevel,
  computeStageFromXp,
  xpThresholdForLevel,
} from '../src/lib/character';

// --------------- API route tests ---------------

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import characterRoutes from '../src/routes/character';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/characters', characterRoutes);
  return app;
}

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

beforeEach(() => {
  mockDB.reset();
});

// ---- GET /characters/me ----

describe('GET /characters/me', () => {
  it('사용자 미존재 시 404 + USER_NOT_FOUND', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/characters/me'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('USER_NOT_FOUND');
  });

  it('캐릭터 없으면 자동 생성 후 반환', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);      // resolveUserPk
    mockDB.pushResult([]);                     // loadOrCreateCharacter: SELECT existing
    mockDB.pushResult([], 1);                  // INSERT new character
    mockDB.pushResult([CHAR_ROW]);             // SELECT created
    mockDB.pushResult([]);                     // loadStats
    mockDB.pushResult([]);                     // loadAchievements
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/characters/me'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.character.stage).toBe('seed');
    expect(body.character.level).toBe(1);
    expect(body.streak.current).toBe(0);
    expect(body.stats).toEqual({ diligence: 0, health: 0, consistency: 0 });
    expect(body.achievements).toEqual([]);
  });

  it('기존 캐릭터 + stats + achievements 반환', async () => {
    const charWithXp = { ...CHAR_ROW, xp: 500, current_streak: 3, longest_streak: 5, last_wakeup_date: '2026-04-24' };
    mockDB.pushResult([{ id: 'pk1' }]);        // resolveUserPk
    mockDB.pushResult([charWithXp]);           // loadOrCreateCharacter: existing
    mockDB.pushResult([{ diligence: 10, health: 3, consistency: 7 }]); // loadStats
    mockDB.pushResult([                        // loadAchievements
      { milestone: 7, bonus_xp: 100, achieved_at: '2026-04-20' },
    ]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/characters/me'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.character.xp).toBe(500);
    expect(body.character.level).toBe(3);       // sqrt(500/100) = 2.23 → floor → 2 + 1 = 3
    expect(body.character.stage).toBe('sprout');
    expect(body.streak.current).toBe(3);
    expect(body.streak.longest).toBe(5);
    expect(body.stats.diligence).toBe(10);
    expect(body.achievements).toHaveLength(1);
    expect(body.achievements[0].milestone).toBe(7);
  });

  it('progress 필드가 올바르게 계산됨', async () => {
    const charLvl2 = { ...CHAR_ROW, xp: 150 };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charLvl2]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/characters/me'));
    const body = await res.json();
    expect(body.progress.xp_into_level).toBe(50);    // 150 - 100
    expect(body.progress.xp_to_next_level).toBe(250); // 400 - 150
    expect(body.progress.level_span).toBe(300);        // 400 - 100
    expect(body.progress.progress_ratio).toBeCloseTo(50 / 300);
  });
});
// ---- POST /characters/xp ----

describe('POST /characters/xp', () => {
  it('지원하지 않는 event 시 400 + UNSUPPORTED_EVENT', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', { event: 'unknown_event' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('UNSUPPORTED_EVENT');
  });

  it('event 누락 시 400', async () => {
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('UNSUPPORTED_EVENT');
  });

  it('사용자 미존재 시 404', async () => {
    mockDB.pushResult([]);  // resolveUserPk → empty
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', { event: 'alarm_completed' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('USER_NOT_FOUND');
  });

  it('alarm_completed 기본 XP 지급 (10xp, 2 affection)', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);        // resolveUserPk
    mockDB.pushResult([CHAR_ROW]);             // loadOrCreateCharacter
    mockDB.pushResult([], 1);                  // UPDATE characters
    mockDB.pushResult([], 1);                  // INSERT character_xp_logs
    mockDB.pushResult([], 1);                  // ensureStatsRow (INSERT OR IGNORE)
    mockDB.pushResult([], 1);                  // UPDATE character_stats
    const refreshed = { ...CHAR_ROW, xp: 10, affection: 2, daily_xp: 10, current_streak: 1, last_wakeup_date: '2026-04-25' };
    mockDB.pushResult([refreshed]);            // refreshed loadOrCreateCharacter
    mockDB.pushResult([]);                     // loadStats
    mockDB.pushResult([]);                     // loadAchievements
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', { event: 'alarm_completed' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.event).toBe('alarm_completed');
    expect(body.grant.granted_xp).toBe(10);
    expect(body.grant.affection).toBe(2);
    expect(body.grant.duplicated).toBe(false);
    expect(body.grant.capped).toBe(false);
  });

  it('alarm_snoozed 이벤트 — 5xp, 0 affection', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([], 1);                  // UPDATE
    mockDB.pushResult([], 1);                  // INSERT log
    const refreshed = { ...CHAR_ROW, xp: 5, daily_xp: 5 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', { event: 'alarm_snoozed' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(5);
    expect(body.grant.affection).toBe(0);
  });

  it('friend_invited 이벤트 — 50xp, 5 affection', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const refreshed = { ...CHAR_ROW, xp: 50, affection: 5, daily_xp: 50 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', { event: 'friend_invited' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(50);
    expect(body.grant.affection).toBe(5);
  });

  it('일일 캡 적용 — daily_xp가 이미 높으면 capped', async () => {
    const today = new Date().toISOString().split('T')[0];
    const charNearCap = { ...CHAR_ROW, daily_xp: 195, daily_xp_reset_at: today, last_wakeup_date: today, current_streak: 3 };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charNearCap]);
    mockDB.pushResult([], 1);                  // UPDATE characters
    mockDB.pushResult([], 1);                  // INSERT xp_log
    // same day → isNewDay=false → no ensureStatsRow/UPDATE stats
    const refreshed = { ...charNearCap, xp: 5, daily_xp: 200 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: today }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(5);
    expect(body.grant.capped).toBe(true);
    expect(body.grant.remaining_cap).toBe(0);
  });

  it('일일 캡 200 초과 시 0 지급', async () => {
    const today = new Date().toISOString().split('T')[0];
    const charFullCap = { ...CHAR_ROW, daily_xp: 200, daily_xp_reset_at: today, last_wakeup_date: today, current_streak: 2 };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charFullCap]);
    mockDB.pushResult([], 1);                  // UPDATE characters
    mockDB.pushResult([], 1);                  // INSERT xp_log
    // same day → isNewDay=false → no ensureStatsRow/UPDATE stats
    const refreshed = { ...charFullCap, xp: 0, daily_xp: 200 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: today }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(0);
    expect(body.grant.capped).toBe(true);
  });

  it('날짜가 바뀌면 daily_xp 리셋 후 재산정', async () => {
    const charYesterday = { ...CHAR_ROW, daily_xp: 200, daily_xp_reset_at: '2025-01-01' };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charYesterday]);
    mockDB.pushResult([], 1);                  // UPDATE characters
    mockDB.pushResult([], 1);                  // INSERT xp_log
    mockDB.pushResult([], 1);                  // ensureStatsRow
    mockDB.pushResult([], 1);                  // UPDATE stats
    const refreshed = { ...CHAR_ROW, xp: 10, daily_xp: 10, current_streak: 1 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', { event: 'alarm_completed', local_date: '2026-04-25' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(10);
    expect(body.grant.capped).toBe(false);
  });

  it('client_nonce 중복 시 duplicated=true 반환', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);        // resolveUserPk
    mockDB.pushResult([{                        // nonce lookup → found
      event: 'alarm_completed',
      granted_xp: 10,
      affection_delta: 2,
      capped: 0,
    }]);
    mockDB.pushResult([CHAR_ROW]);             // loadOrCreateCharacter for dup path
    mockDB.pushResult([]);                     // loadStats
    mockDB.pushResult([]);                     // loadAchievements
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', {
      event: 'alarm_completed',
      client_nonce: 'nonce-abc',
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grant.duplicated).toBe(true);
    expect(body.grant.granted_xp).toBe(10);
  });

  it('client_nonce 공백만 있으면 무시 (새 지급 진행)', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([CHAR_ROW]);             // loadOrCreateCharacter (no nonce check)
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const refreshed = { ...CHAR_ROW, xp: 10 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', {
      event: 'alarm_completed',
      client_nonce: '   ',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.duplicated).toBe(false);
  });

  it('alarm_completed + 연속 기상 시 스트릭 증가', async () => {
    const charStreak = { ...CHAR_ROW, current_streak: 5, longest_streak: 5, last_wakeup_date: '2026-04-24' };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charStreak]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1); // ensureStatsRow
    mockDB.pushResult([], 1); // UPDATE stats
    const refreshed = { ...charStreak, xp: 10, current_streak: 6, daily_xp: 10, last_wakeup_date: '2026-04-25' };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', {
      event: 'alarm_completed',
      local_date: '2026-04-25',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.streak.current).toBe(6);
  });

  it('alarm_completed + 2일 이상 gap → 스트릭 1로 리셋', async () => {
    const charBroken = { ...CHAR_ROW, current_streak: 10, longest_streak: 10, last_wakeup_date: '2026-04-22' };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charBroken]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const refreshed = { ...charBroken, xp: 10, current_streak: 1, last_wakeup_date: '2026-04-25' };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', {
      event: 'alarm_completed',
      local_date: '2026-04-25',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.streak.current).toBe(1);
  });

  it('같은 날 중복 alarm_completed → 스트릭 유지 (isNewDay=false)', async () => {
    const charToday = { ...CHAR_ROW, current_streak: 3, last_wakeup_date: '2026-04-25', daily_xp: 10, daily_xp_reset_at: '2026-04-25' };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charToday]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    // no ensureStatsRow / UPDATE stats because streakUpdated=false
    const refreshed = { ...charToday, xp: 20, daily_xp: 20 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', {
      event: 'alarm_completed',
      local_date: '2026-04-25',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.streak.current).toBe(3);
  });

  it('7일 마일스톤 도달 시 milestone_grants 포함', async () => {
    const charStreak6 = { ...CHAR_ROW, current_streak: 6, longest_streak: 6, last_wakeup_date: '2026-04-24' };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charStreak6]);
    mockDB.pushResult([], 1);                   // UPDATE characters
    mockDB.pushResult([], 1);                   // INSERT xp_log
    mockDB.pushResult([]);                      // milestone check: no existing achievement
    mockDB.pushResult([], 1);                   // UPDATE characters (milestone XP)
    mockDB.pushResult([], 1);                   // INSERT streak_achievements
    mockDB.pushResult([], 1);                   // INSERT xp_log (milestone)
    mockDB.pushResult([], 1);                   // ensureStatsRow
    mockDB.pushResult([], 1);                   // UPDATE stats
    const refreshed = { ...charStreak6, xp: 110, current_streak: 7, daily_xp: 110, last_wakeup_date: '2026-04-25' };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([{ milestone: 7, bonus_xp: 100, achieved_at: '2026-04-25' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', {
      event: 'alarm_completed',
      local_date: '2026-04-25',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(110);    // 10 + 100
    expect(body.grant.milestone_grants).toBeDefined();
    expect(body.grant.milestone_grants).toHaveLength(1);
    expect(body.grant.milestone_grants[0].event).toBe('streak_bonus_7');
    expect(body.grant.milestone_grants[0].xp).toBe(100);
    expect(body.achievements).toHaveLength(1);
  });

  it('이미 달성한 마일스톤은 중복 지급하지 않음', async () => {
    const charStreak6 = { ...CHAR_ROW, current_streak: 6, longest_streak: 10, last_wakeup_date: '2026-04-24' };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charStreak6]);
    mockDB.pushResult([], 1);                   // UPDATE
    mockDB.pushResult([], 1);                   // INSERT xp_log
    mockDB.pushResult([{ id: 'ach-existing' }]);// milestone check: already exists
    mockDB.pushResult([], 1);                   // ensureStatsRow
    mockDB.pushResult([], 1);                   // UPDATE stats
    const refreshed = { ...charStreak6, xp: 10, current_streak: 7, daily_xp: 10 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', {
      event: 'alarm_completed',
      local_date: '2026-04-25',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(10);
    expect(body.grant.milestone_grants).toBeUndefined();
  });

  it('alarm_dismissed — 0xp, 0 affection, 스트릭 변동 없음', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const refreshed = { ...CHAR_ROW };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', { event: 'alarm_dismissed' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(0);
    expect(body.grant.affection).toBe(0);
  });

  it('local_date 형식이 잘못되면 서버 today 사용', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const refreshed = { ...CHAR_ROW, xp: 10, current_streak: 1 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', {
      event: 'alarm_completed',
      local_date: 'not-a-date',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(10);
  });

  it('body 파싱 실패 시 UNSUPPORTED_EVENT', async () => {
    const app = buildApp();
    const req = new Request('http://localhost/characters/xp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json{{{',
    });
    const res = await app.request(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('UNSUPPORTED_EVENT');
  });

  it('streak_bonus 이벤트는 일일 캡 면제', async () => {
    const charFullCap = { ...CHAR_ROW, daily_xp: 200, daily_xp_reset_at: new Date().toISOString().split('T')[0] };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charFullCap]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    const refreshed = { ...charFullCap, xp: 100 };
    mockDB.pushResult([refreshed]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/characters/xp', { event: 'streak_bonus_7' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grant.granted_xp).toBe(100);
    expect(body.grant.capped).toBe(false);
  });
});

// --------------- Pure utility tests ---------------

describe('xpThresholdForLevel', () => {
  it('레벨 1 은 누적 XP 0 부터 시작', () => {
    expect(xpThresholdForLevel(1)).toBe(0);
  });

  it('레벨 2 는 100, 레벨 3 은 400, 레벨 5 는 1600', () => {
    expect(xpThresholdForLevel(2)).toBe(100);
    expect(xpThresholdForLevel(3)).toBe(400);
    expect(xpThresholdForLevel(5)).toBe(1600);
  });

  it('1 미만·비유한 값은 0 반환', () => {
    expect(xpThresholdForLevel(0)).toBe(0);
    expect(xpThresholdForLevel(-3)).toBe(0);
    expect(xpThresholdForLevel(Number.NaN)).toBe(0);
  });

  it('정수가 아니면 floor 처리', () => {
    expect(xpThresholdForLevel(2.9)).toBe(100);
  });
});

describe('computeLevelFromXp', () => {
  it('XP 0 은 레벨 1', () => {
    expect(computeLevelFromXp(0)).toBe(1);
    expect(computeLevelFromXp(-50)).toBe(1);
  });

  it('임계 직전은 이전 레벨, 임계값은 다음 레벨', () => {
    expect(computeLevelFromXp(99)).toBe(1);
    expect(computeLevelFromXp(100)).toBe(2);
    expect(computeLevelFromXp(399)).toBe(2);
    expect(computeLevelFromXp(400)).toBe(3);
    expect(computeLevelFromXp(1599)).toBe(4);
    expect(computeLevelFromXp(1600)).toBe(5);
  });

  it('큰 XP 도 연속 단조 증가', () => {
    expect(computeLevelFromXp(10000)).toBe(11);
    expect(computeLevelFromXp(100000)).toBe(32);
  });
});

describe('computeStageFromLevel', () => {
  it('1~2 → seed, 3~5 → sprout, 6~9 → tree, 10+ → bloom', () => {
    expect(computeStageFromLevel(1)).toBe('seed');
    expect(computeStageFromLevel(2)).toBe('seed');
    expect(computeStageFromLevel(3)).toBe('sprout');
    expect(computeStageFromLevel(5)).toBe('sprout');
    expect(computeStageFromLevel(6)).toBe('tree');
    expect(computeStageFromLevel(9)).toBe('tree');
    expect(computeStageFromLevel(10)).toBe('bloom');
    expect(computeStageFromLevel(100)).toBe('bloom');
  });

  it('1 미만은 seed 로 방어', () => {
    expect(computeStageFromLevel(0)).toBe('seed');
    expect(computeStageFromLevel(-3)).toBe('seed');
  });
});

describe('computeStageFromXp', () => {
  it('XP 를 그대로 stage 로 변환 (복합 경로)', () => {
    expect(computeStageFromXp(0)).toBe('seed');
    expect(computeStageFromXp(100)).toBe('seed'); // level 2
    expect(computeStageFromXp(400)).toBe('sprout'); // level 3
    expect(computeStageFromXp(2500)).toBe('tree'); // level 6
    expect(computeStageFromXp(8100)).toBe('bloom'); // level 10
  });
});

describe('CHARACTER_STAGES', () => {
  it('4 단계가 순서대로 선언되어 있다', () => {
    expect(CHARACTER_STAGES).toEqual(['seed', 'sprout', 'tree', 'bloom']);
  });
});
