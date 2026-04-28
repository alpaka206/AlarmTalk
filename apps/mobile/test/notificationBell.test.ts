type TFn = (key: string, opts?: Record<string, unknown>) => string;

function formatBadgeCount(count: number): string {
  return count > 9 ? '9+' : String(count);
}

function shouldShowBadge(count: number): boolean {
  return count > 0;
}

function getBellAccessibilityLabel(
  badgeCount: number,
  t: TFn,
): string {
  return badgeCount > 0
    ? t('profile.notificationsBadge', { count: badgeCount })
    : t('profile.notifications');
}

function computeBadgeCount(pending: unknown[] | undefined | null): number {
  return (pending as unknown[] | undefined)?.length ?? 0;
}

describe('NotificationBell — formatBadgeCount', () => {
  it('returns "1" for count 1', () => {
    expect(formatBadgeCount(1)).toBe('1');
  });

  it('returns "9" for count 9', () => {
    expect(formatBadgeCount(9)).toBe('9');
  });

  it('returns "9+" for count 10', () => {
    expect(formatBadgeCount(10)).toBe('9+');
  });

  it('returns "9+" for count 99', () => {
    expect(formatBadgeCount(99)).toBe('9+');
  });

  it('returns "0" for count 0', () => {
    expect(formatBadgeCount(0)).toBe('0');
  });
});

describe('NotificationBell — shouldShowBadge', () => {
  it('returns false for 0', () => {
    expect(shouldShowBadge(0)).toBe(false);
  });

  it('returns true for 1', () => {
    expect(shouldShowBadge(1)).toBe(true);
  });

  it('returns true for 50', () => {
    expect(shouldShowBadge(50)).toBe(true);
  });
});

describe('NotificationBell — getBellAccessibilityLabel', () => {
  const t: TFn = (key, opts) =>
    opts ? `${key}:${JSON.stringify(opts)}` : key;

  it('returns notifications key when badgeCount is 0', () => {
    expect(getBellAccessibilityLabel(0, t)).toBe('profile.notifications');
  });

  it('returns notificationsBadge key with count when badgeCount > 0', () => {
    const label = getBellAccessibilityLabel(3, t);
    expect(label).toContain('profile.notificationsBadge');
    expect(label).toContain('"count":3');
  });

  it('returns notificationsBadge key for count 1', () => {
    const label = getBellAccessibilityLabel(1, t);
    expect(label).toContain('profile.notificationsBadge');
    expect(label).toContain('"count":1');
  });
});

describe('NotificationBell — computeBadgeCount', () => {
  it('returns 0 for undefined', () => {
    expect(computeBadgeCount(undefined)).toBe(0);
  });

  it('returns 0 for null', () => {
    expect(computeBadgeCount(null)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(computeBadgeCount([])).toBe(0);
  });

  it('returns length for non-empty array', () => {
    expect(computeBadgeCount([1, 2, 3])).toBe(3);
  });

  it('returns correct count for large array', () => {
    expect(computeBadgeCount(new Array(15).fill(null))).toBe(15);
  });
});
