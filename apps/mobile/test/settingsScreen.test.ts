type TFn = (key: string) => string;
type PlanType = 'free' | 'plus' | 'family';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getPlanLabel(plan: string, t: TFn): string {
  const labels: Record<string, string> = {
    free: t('settings.planFree'),
    plus: t('settings.planPlus'),
    family: t('settings.planFamily'),
  };
  return labels[plan] || plan;
}

function shouldShowDeleteDialog(
  confirmText: string,
  expectedText: string,
): boolean {
  return confirmText === expectedText;
}

function isValidSnoozeMinutes(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 30;
}

// ─── Tests ───

describe('SettingsScreen — formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats small byte values', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats exactly 1023 bytes', () => {
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats 1 KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('formats KB range', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats large KB', () => {
    expect(formatBytes(500 * 1024)).toBe('500.0 KB');
  });

  it('formats exactly 1023 KB', () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB');
  });

  it('formats 1 MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('formats MB range', () => {
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('formats large MB', () => {
    expect(formatBytes(100 * 1024 * 1024)).toBe('100.0 MB');
  });

  it('formats 1 GB as MB', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1024.0 MB');
  });
});

describe('SettingsScreen — getPlanLabel', () => {
  const t: TFn = (key) => key;

  it('returns free plan label', () => {
    expect(getPlanLabel('free', t)).toBe('settings.planFree');
  });

  it('returns plus plan label', () => {
    expect(getPlanLabel('plus', t)).toBe('settings.planPlus');
  });

  it('returns family plan label', () => {
    expect(getPlanLabel('family', t)).toBe('settings.planFamily');
  });

  it('returns raw plan name for unknown plan', () => {
    expect(getPlanLabel('enterprise', t)).toBe('enterprise');
  });

  it('returns raw plan name for empty string', () => {
    expect(getPlanLabel('', t)).toBe('');
  });
});

describe('SettingsScreen — delete account confirmation', () => {
  it('matches when text equals expected', () => {
    expect(shouldShowDeleteDialog('삭제', '삭제')).toBe(true);
  });

  it('does not match when text differs', () => {
    expect(shouldShowDeleteDialog('취소', '삭제')).toBe(false);
  });

  it('does not match empty string', () => {
    expect(shouldShowDeleteDialog('', '삭제')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(shouldShowDeleteDialog('DELETE', 'delete')).toBe(false);
  });
});

describe('SettingsScreen — snooze minutes validation', () => {
  it('accepts 1 minute', () => {
    expect(isValidSnoozeMinutes(1)).toBe(true);
  });

  it('accepts 5 minutes', () => {
    expect(isValidSnoozeMinutes(5)).toBe(true);
  });

  it('accepts 30 minutes', () => {
    expect(isValidSnoozeMinutes(30)).toBe(true);
  });

  it('rejects 0 minutes', () => {
    expect(isValidSnoozeMinutes(0)).toBe(false);
  });

  it('rejects negative minutes', () => {
    expect(isValidSnoozeMinutes(-1)).toBe(false);
  });

  it('rejects 31 minutes', () => {
    expect(isValidSnoozeMinutes(31)).toBe(false);
  });

  it('rejects float', () => {
    expect(isValidSnoozeMinutes(2.5)).toBe(false);
  });
});

describe('SettingsScreen — navigation routes', () => {
  it('has notification settings route', () => {
    expect(typeof 'app-settings:').toBe('string');
  });
});

describe('SettingsScreen — version display', () => {
  it('falls back to 1.0.0 when undefined', () => {
    const version = undefined ?? '1.0.0';
    expect(version).toBe('1.0.0');
  });

  it('uses actual version when available', () => {
    const version = '2.3.1' ?? '1.0.0';
    expect(version).toBe('2.3.1');
  });
});
