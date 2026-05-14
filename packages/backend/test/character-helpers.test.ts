import { describe, it, expect } from 'vitest';
import {
  rowToCharacter,
  buildProgress,
  serializeCharacter,
  todayString,
} from '../src/routes/character-helpers';

describe('rowToCharacter', () => {
  it('applies defaults for missing fields', () => {
    const row = { id: 'c1', user_id: 'u1' } as Record<string, unknown>;
    const c = rowToCharacter(row);
    expect(c.name).toBe('내 캐릭터');
    expect(c.level).toBe(1);
    expect(c.xp).toBe(0);
    expect(c.affection).toBe(0);
    expect(c.stage).toBe('seed');
    expect(c.daily_xp).toBe(0);
    expect(c.daily_xp_reset_at).toBeNull();
    expect(c.current_streak).toBe(0);
    expect(c.longest_streak).toBe(0);
    expect(c.last_wakeup_date).toBeNull();
  });

  it('coerces numeric fields', () => {
    const row = {
      id: 'c1',
      user_id: 'u1',
      name: 'Pine',
      level: '5',
      xp: '1200',
      affection: '10',
      stage: 'tree',
      daily_xp: '30',
      daily_xp_reset_at: '2026-04-25',
      current_streak: '7',
      longest_streak: '14',
      last_wakeup_date: '2026-04-25',
      created_at: '2026-01-01',
      updated_at: '2026-04-25',
    } as Record<string, unknown>;
    const c = rowToCharacter(row);
    expect(c.level).toBe(5);
    expect(c.xp).toBe(1200);
    expect(c.affection).toBe(10);
    expect(c.stage).toBe('tree');
    expect(c.daily_xp).toBe(30);
    expect(c.current_streak).toBe(7);
    expect(c.longest_streak).toBe(14);
    expect(c.last_wakeup_date).toBe('2026-04-25');
  });
});

describe('buildProgress', () => {
  it('returns correct values at level 1 with 0 xp', () => {
    const p = buildProgress(0, 1);
    expect(p.xp_into_level).toBe(0);
    expect(p.xp_to_next_level).toBe(100);
    expect(p.level_span).toBe(100);
    expect(p.progress_ratio).toBe(0);
  });

  it('returns partial progress within a level', () => {
    const p = buildProgress(50, 1);
    expect(p.xp_into_level).toBe(50);
    expect(p.xp_to_next_level).toBe(50);
    expect(p.progress_ratio).toBeCloseTo(0.5);
  });

  it('caps progress_ratio at 1', () => {
    const p = buildProgress(200, 1);
    expect(p.progress_ratio).toBe(1);
  });

  it('works at higher levels', () => {
    // L3 threshold = 100*(2)^2 = 400, L4 = 100*(3)^2 = 900
    const p = buildProgress(500, 3);
    expect(p.xp_into_level).toBe(100);
    expect(p.xp_to_next_level).toBe(400);
    expect(p.level_span).toBe(500);
    expect(p.progress_ratio).toBeCloseTo(0.2);
  });
});

describe('serializeCharacter', () => {
  const baseRow = {
    id: 'c1',
    user_id: 'u1',
    name: 'Pine',
    level: 1,
    xp: 0,
    affection: 0,
    stage: 'seed' as const,
    daily_xp: 0,
    daily_xp_reset_at: null,
    current_streak: 3,
    longest_streak: 7,
    last_wakeup_date: '2026-04-25',
    created_at: '2026-01-01',
    updated_at: '2026-04-25',
  };

  it('includes streak info', () => {
    const result = serializeCharacter(baseRow);
    expect(result.streak.current).toBe(3);
    expect(result.streak.longest).toBe(7);
    expect(result.streak.last_wakeup_date).toBe('2026-04-25');
  });

  it('defaults stats when not provided', () => {
    const result = serializeCharacter(baseRow);
    expect(result.stats).toEqual({ diligence: 0, health: 0, consistency: 0 });
  });

  it('uses provided stats', () => {
    const stats = { diligence: 5, health: 3, consistency: 8 };
    const result = serializeCharacter(baseRow, stats);
    expect(result.stats).toEqual(stats);
  });

  it('recomputes level and stage from xp', () => {
    const row = { ...baseRow, xp: 1000 };
    const result = serializeCharacter(row);
    expect(result.character.level).toBe(4);
    expect(result.character.stage).toBe('sprout');
  });

  it('does not lower a saved level when xp is below that level threshold', () => {
    const row = { ...baseRow, level: 3, xp: 350 };
    const result = serializeCharacter(row);
    expect(result.character.level).toBe(3);
    expect(result.character.stage).toBe('sprout');
  });

  it('includes progress info', () => {
    const result = serializeCharacter(baseRow);
    expect(result.progress).toBeDefined();
    expect(result.progress.progress_ratio).toBeGreaterThanOrEqual(0);
  });

  it('passes through achievements', () => {
    const achievements = [{ milestone: 7, bonus_xp: 50, achieved_at: '2026-04-20' }];
    const result = serializeCharacter(baseRow, null, achievements);
    expect(result.achievements).toEqual(achievements);
  });
});

describe('todayString', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = todayString(new Date('2026-04-25T10:30:00Z'));
    expect(result).toBe('2026-04-25');
  });

  it('returns a string without a provided date', () => {
    const result = todayString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
