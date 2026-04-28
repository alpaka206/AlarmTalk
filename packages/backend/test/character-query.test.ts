import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import characterQuery from '../src/routes/character-query';

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
  app.route('/characters', characterQuery);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

describe('GET /characters/me (characterQuery)', () => {
  it('resolveUserPk — google_id 바인딩 검증', async () => {
    mockDB.pushResult([]);
    await buildApp('my-google-id').request(
      new Request('http://localhost/characters/me'),
    );
    expect(mockDB.calls[0]!.sql).toContain('FROM users WHERE google_id');
    expect(mockDB.calls[0]!.args[0]).toBe('my-google-id');
  });

  it('사용자 미존재 → 404 USER_NOT_FOUND', async () => {
    mockDB.pushResult([]);
    const res = await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('USER_NOT_FOUND');
    expect(body.error).toBe('사용자를 찾을 수 없습니다');
  });

  it('캐릭터 미존재 → 자동 생성 흐름 (3 DB 호출)', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const res = await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    expect(res.status).toBe(200);
    const selectExisting = mockDB.calls[1]!;
    expect(selectExisting.sql).toContain('FROM characters WHERE user_id');
    expect(selectExisting.args[0]).toBe('pk1');
    const insertChar = mockDB.calls[2]!;
    expect(insertChar.sql).toContain('INSERT INTO characters');
    expect(insertChar.args[1]).toBe('pk1');
    expect(insertChar.args[2]).toBe('내 캐릭터');
  });

  it('캐릭터 존재 → DB 4회 호출 (user + char + stats + achievements)', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    expect(mockDB.calls).toHaveLength(4);
  });

  it('loadStats SQL — character_id 바인딩', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([{ diligence: 10, health: 5, consistency: 8 }]);
    mockDB.pushResult([]);
    const res = await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    const body = await res.json();
    const statsQuery = mockDB.calls.find(
      (c) => c.sql.includes('FROM character_stats'),
    );
    expect(statsQuery!.args[0]).toBe('char-1');
    expect(body.stats).toEqual({ diligence: 10, health: 5, consistency: 8 });
  });

  it('stats 없으면 기본값 {0,0,0} 반환', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const res = await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    const body = await res.json();
    expect(body.stats).toEqual({ diligence: 0, health: 0, consistency: 0 });
  });

  it('loadAchievements SQL — ORDER BY milestone + character_id 바인딩', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([]);
    mockDB.pushResult([
      { milestone: 7, bonus_xp: 100, achieved_at: '2026-04-15' },
      { milestone: 30, bonus_xp: 500, achieved_at: '2026-04-20' },
    ]);
    const res = await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    const body = await res.json();
    const achQuery = mockDB.calls.find(
      (c) => c.sql.includes('FROM streak_achievements'),
    );
    expect(achQuery!.sql).toContain('ORDER BY milestone');
    expect(achQuery!.args[0]).toBe('char-1');
    expect(body.achievements).toHaveLength(2);
    expect(body.achievements[0].milestone).toBe(7);
    expect(body.achievements[1].milestone).toBe(30);
    expect(body.achievements[1].bonus_xp).toBe(500);
  });

  it('achievements 빈 배열 → []', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const res = await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    const body = await res.json();
    expect(body.achievements).toEqual([]);
  });

  it('level/stage XP 기반 재계산 — DB 저장값 무시', async () => {
    const charWrongLevel = {
      ...CHAR_ROW,
      xp: 1600,
      level: 1,
      stage: 'seed',
    };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charWrongLevel]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const res = await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    const body = await res.json();
    expect(body.character.level).toBe(5);
    expect(body.character.stage).toBe('sprout');
  });

  it('progress 계산 — xp=0, level=1', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([CHAR_ROW]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const res = await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    const body = await res.json();
    expect(body.progress.xp_into_level).toBe(0);
    expect(body.progress.xp_to_next_level).toBe(100);
    expect(body.progress.level_span).toBe(100);
    expect(body.progress.progress_ratio).toBe(0);
  });

  it('progress 계산 — mid-level (xp=250, level=2)', async () => {
    const charMid = { ...CHAR_ROW, xp: 250 };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charMid]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const res = await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    const body = await res.json();
    expect(body.progress.xp_into_level).toBe(150);
    expect(body.progress.xp_to_next_level).toBe(150);
    expect(body.progress.level_span).toBe(300);
    expect(body.progress.progress_ratio).toBeCloseTo(0.5);
  });

  it('streak 필드 정확히 매핑', async () => {
    const charStreak = {
      ...CHAR_ROW,
      current_streak: 15,
      longest_streak: 42,
      last_wakeup_date: '2026-04-25',
    };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charStreak]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const res = await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    const body = await res.json();
    expect(body.streak.current).toBe(15);
    expect(body.streak.longest).toBe(42);
    expect(body.streak.last_wakeup_date).toBe('2026-04-25');
  });

  it('bloom 단계 캐릭터 (xp=8100, level=10)', async () => {
    const charBloom = { ...CHAR_ROW, xp: 8100, level: 10, stage: 'bloom' };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charBloom]);
    mockDB.pushResult([{ diligence: 90, health: 45, consistency: 80 }]);
    mockDB.pushResult([
      { milestone: 7, bonus_xp: 100, achieved_at: '2026-02-01' },
      { milestone: 30, bonus_xp: 500, achieved_at: '2026-03-01' },
      { milestone: 90, bonus_xp: 2000, achieved_at: '2026-04-20' },
    ]);
    const res = await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    const body = await res.json();
    expect(body.character.stage).toBe('bloom');
    expect(body.character.level).toBe(10);
    expect(body.stats.diligence).toBe(90);
    expect(body.achievements).toHaveLength(3);
    expect(body.achievements[2].milestone).toBe(90);
    expect(body.achievements[2].bonus_xp).toBe(2000);
  });

  it('character 응답에 id, name, xp, affection 포함', async () => {
    const charFull = {
      ...CHAR_ROW,
      name: 'MyTree',
      xp: 500,
      affection: 25,
    };
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([charFull]);
    mockDB.pushResult([]);
    mockDB.pushResult([]);
    const res = await buildApp().request(
      new Request('http://localhost/characters/me'),
    );
    const body = await res.json();
    expect(body.character.id).toBe('char-1');
    expect(body.character.name).toBe('MyTree');
    expect(body.character.xp).toBe(500);
    expect(body.character.affection).toBe(25);
  });
});
