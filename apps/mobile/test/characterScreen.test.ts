/**
 * characterScreen.test.ts — business logic extracted from app/character/index.tsx
 */

// ---- StatBar percentage calculation (line 44 of character/index.tsx) ----
function statBarPct(value: number, max: number): number {
  return Math.min((value / Math.max(max, 1)) * 100, 100);
}

// ---- MilestoneBadge emoji mapping (line 63) ----
function milestoneEmoji(milestone: number): string {
  return milestone === 7 ? '🌱' : milestone === 30 ? '🌳' : '🌸';
}

// ---- Stat bar max value (lines 248-249) ----
function statBarMax(diligence: number, health: number, consistency: number): number {
  return Math.max(diligence, health, consistency, 10);
}

// ---- achievedMilestones Set (line 157) ----
function buildAchievedSet(
  achievements: { milestone: number }[],
): Set<number> {
  return new Set(achievements.map((a) => a.milestone));
}

// ---- DEV_EVENTS (line 30) ----
const DEV_EVENTS: { event: string; labelKey: string }[] = [
  { event: 'alarm_completed', labelKey: 'character.devAlarmCompleted' },
  { event: 'alarm_snoozed', labelKey: 'character.devAlarmSnoozed' },
  { event: 'family_alarm_received', labelKey: 'character.devFamilyAlarmReceived' },
];

const MILESTONES = [7, 30, 90] as const;

// ============================================================
// Tests
// ============================================================

describe('StatBar percentage', () => {
  it('calculates normal percentage', () => {
    expect(statBarPct(50, 100)).toBe(50);
  });

  it('returns 100 when value equals max', () => {
    expect(statBarPct(100, 100)).toBe(100);
  });

  it('caps at 100 when value exceeds max', () => {
    expect(statBarPct(150, 100)).toBe(100);
  });

  it('returns 0 for zero value', () => {
    expect(statBarPct(0, 100)).toBe(0);
  });

  it('treats max=0 as max=1 to avoid division by zero', () => {
    expect(statBarPct(5, 0)).toBe(100);
  });

  it('treats negative max as max=1', () => {
    expect(statBarPct(0.5, -10)).toBe(50);
  });

  it('handles small fractional values', () => {
    expect(statBarPct(1, 3)).toBeCloseTo(33.33, 1);
  });

  it('handles max=1', () => {
    expect(statBarPct(1, 1)).toBe(100);
    expect(statBarPct(0, 1)).toBe(0);
  });

  it('handles large values', () => {
    expect(statBarPct(999, 1000)).toBe(99.9);
  });
});

describe('MilestoneBadge emoji', () => {
  it('returns 🌱 for 7-day milestone', () => {
    expect(milestoneEmoji(7)).toBe('🌱');
  });

  it('returns 🌳 for 30-day milestone', () => {
    expect(milestoneEmoji(30)).toBe('🌳');
  });

  it('returns 🌸 for 90-day milestone (default)', () => {
    expect(milestoneEmoji(90)).toBe('🌸');
  });

  it('returns 🌸 for any other milestone (fallback)', () => {
    expect(milestoneEmoji(1)).toBe('🌸');
    expect(milestoneEmoji(0)).toBe('🌸');
    expect(milestoneEmoji(365)).toBe('🌸');
  });
});

describe('statBarMax', () => {
  it('returns max of all stats when above 10', () => {
    expect(statBarMax(20, 15, 18)).toBe(20);
  });

  it('returns 10 as minimum floor', () => {
    expect(statBarMax(0, 0, 0)).toBe(10);
    expect(statBarMax(5, 3, 8)).toBe(10);
  });

  it('returns highest stat when all above 10', () => {
    expect(statBarMax(11, 12, 13)).toBe(13);
  });

  it('returns 10 when one stat is exactly 10', () => {
    expect(statBarMax(10, 5, 3)).toBe(10);
  });

  it('handles large values', () => {
    expect(statBarMax(100, 200, 50)).toBe(200);
  });

  it('handles equal values', () => {
    expect(statBarMax(15, 15, 15)).toBe(15);
  });
});

describe('buildAchievedSet', () => {
  it('builds set from achievements array', () => {
    const set = buildAchievedSet([
      { milestone: 7 },
      { milestone: 30 },
    ]);
    expect(set.has(7)).toBe(true);
    expect(set.has(30)).toBe(true);
    expect(set.has(90)).toBe(false);
  });

  it('returns empty set for empty array', () => {
    const set = buildAchievedSet([]);
    expect(set.size).toBe(0);
  });

  it('deduplicates milestones', () => {
    const set = buildAchievedSet([
      { milestone: 7 },
      { milestone: 7 },
      { milestone: 30 },
    ]);
    expect(set.size).toBe(2);
  });

  it('handles all MILESTONES achieved', () => {
    const set = buildAchievedSet([
      { milestone: 7 },
      { milestone: 30 },
      { milestone: 90 },
    ]);
    for (const m of MILESTONES) {
      expect(set.has(m)).toBe(true);
    }
  });
});

describe('DEV_EVENTS constant', () => {
  it('has 3 events', () => {
    expect(DEV_EVENTS).toHaveLength(3);
  });

  it('each event has event and labelKey', () => {
    for (const e of DEV_EVENTS) {
      expect(typeof e.event).toBe('string');
      expect(typeof e.labelKey).toBe('string');
      expect(e.event.length).toBeGreaterThan(0);
      expect(e.labelKey).toMatch(/^character\./);
    }
  });

  it('includes alarm_completed', () => {
    expect(DEV_EVENTS.find((e) => e.event === 'alarm_completed')).toBeDefined();
  });

  it('includes alarm_snoozed', () => {
    expect(DEV_EVENTS.find((e) => e.event === 'alarm_snoozed')).toBeDefined();
  });

  it('includes family_alarm_received', () => {
    expect(DEV_EVENTS.find((e) => e.event === 'family_alarm_received')).toBeDefined();
  });
});

describe('MILESTONES constant', () => {
  it('has 3 milestones', () => {
    expect(MILESTONES).toHaveLength(3);
  });

  it('values are 7, 30, 90', () => {
    expect([...MILESTONES]).toEqual([7, 30, 90]);
  });

  it('is sorted ascending', () => {
    for (let i = 1; i < MILESTONES.length; i++) {
      expect(MILESTONES[i]! > MILESTONES[i - 1]!).toBe(true);
    }
  });
});

describe('StatBar integration with statBarMax', () => {
  it('all bars use same max for visual proportion', () => {
    const d = 20, h = 15, c = 18;
    const max = statBarMax(d, h, c);
    expect(statBarPct(d, max)).toBe(100);
    expect(statBarPct(h, max)).toBe(75);
    expect(statBarPct(c, max)).toBe(90);
  });

  it('zeroed stats scale against min floor of 10', () => {
    const d = 0, h = 0, c = 0;
    const max = statBarMax(d, h, c);
    expect(max).toBe(10);
    expect(statBarPct(d, max)).toBe(0);
  });

  it('single high stat dominates', () => {
    const d = 50, h = 5, c = 3;
    const max = statBarMax(d, h, c);
    expect(max).toBe(50);
    expect(statBarPct(d, max)).toBe(100);
    expect(statBarPct(h, max)).toBe(10);
    expect(statBarPct(c, max)).toBe(6);
  });
});

describe('MilestoneBadge achieved rendering logic', () => {
  it('shows all badges with correct achieved state', () => {
    const achieved = buildAchievedSet([{ milestone: 7 }]);
    const results = MILESTONES.map((m) => ({
      milestone: m,
      emoji: milestoneEmoji(m),
      achieved: achieved.has(m),
    }));

    expect(results[0]).toEqual({ milestone: 7, emoji: '🌱', achieved: true });
    expect(results[1]).toEqual({ milestone: 30, emoji: '🌳', achieved: false });
    expect(results[2]).toEqual({ milestone: 90, emoji: '🌸', achieved: false });
  });

  it('shows all achieved when all milestones hit', () => {
    const achieved = buildAchievedSet([
      { milestone: 7 },
      { milestone: 30 },
      { milestone: 90 },
    ]);
    for (const m of MILESTONES) {
      expect(achieved.has(m)).toBe(true);
    }
  });

  it('shows none achieved for new user', () => {
    const achieved = buildAchievedSet([]);
    for (const m of MILESTONES) {
      expect(achieved.has(m)).toBe(false);
    }
  });
});
