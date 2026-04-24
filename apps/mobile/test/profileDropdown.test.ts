/**
 * P64 — ProfileDropdown business logic tests
 */

type PlanType = 'free' | 'plus' | 'family';

function getPlanLabel(plan: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    free: t('settings.planFree'),
    plus: t('settings.planPlus'),
    family: t('settings.planFamily'),
  };
  return labels[plan] || plan;
}

function computeInitial(name: string | null | undefined, email: string | null | undefined): string {
  return (name || email || '?').charAt(0).toUpperCase();
}

function toggleLanguage(current: string): string {
  return current === 'ko' ? 'en' : 'ko';
}

function getAuthMenuItems(isAuthenticated: boolean): string[] {
  const base = ['people', 'codeRegister', 'darkMode', 'language', 'settings'];
  if (isAuthenticated) {
    return [...base, 'logout', 'deleteAccount'];
  }
  return base;
}

function shouldShowProfile(isAuthenticated: boolean, profile: { name?: string; email?: string } | null): boolean {
  return isAuthenticated && profile !== null;
}

describe('ProfileDropdown — getPlanLabel', () => {
  const t = (key: string) => key;

  it('returns translated label for free plan', () => {
    expect(getPlanLabel('free', t)).toBe('settings.planFree');
  });

  it('returns translated label for plus plan', () => {
    expect(getPlanLabel('plus', t)).toBe('settings.planPlus');
  });

  it('returns translated label for family plan', () => {
    expect(getPlanLabel('family', t)).toBe('settings.planFamily');
  });

  it('returns raw plan string for unknown plan', () => {
    expect(getPlanLabel('enterprise', t)).toBe('enterprise');
  });

  it('returns empty string for empty plan', () => {
    expect(getPlanLabel('', t)).toBe('');
  });

  it('uses the t function for translation', () => {
    const mockT = (key: string) => `translated:${key}`;
    expect(getPlanLabel('free', mockT)).toBe('translated:settings.planFree');
  });
});

describe('ProfileDropdown — computeInitial', () => {
  it('uses first letter of name when available', () => {
    expect(computeInitial('Alice', 'alice@test.com')).toBe('A');
  });

  it('uses first letter of email when name is null', () => {
    expect(computeInitial(null, 'bob@test.com')).toBe('B');
  });

  it('uses first letter of email when name is undefined', () => {
    expect(computeInitial(undefined, 'charlie@test.com')).toBe('C');
  });

  it('returns ? when both name and email are null', () => {
    expect(computeInitial(null, null)).toBe('?');
  });

  it('returns ? when both are undefined', () => {
    expect(computeInitial(undefined, undefined)).toBe('?');
  });

  it('uppercases lowercase first letter', () => {
    expect(computeInitial('dave', null)).toBe('D');
  });

  it('handles empty name string (falls through to email)', () => {
    expect(computeInitial('', 'eve@test.com')).toBe('E');
  });

  it('handles empty name and empty email (falls through to ?)', () => {
    expect(computeInitial('', '')).toBe('?');
  });

  it('handles Korean name', () => {
    expect(computeInitial('김규원', null)).toBe('김');
  });

  it('handles name with leading space', () => {
    expect(computeInitial(' Frank', null)).toBe(' ');
  });
});

describe('ProfileDropdown — toggleLanguage', () => {
  it('switches ko to en', () => {
    expect(toggleLanguage('ko')).toBe('en');
  });

  it('switches en to ko', () => {
    expect(toggleLanguage('en')).toBe('ko');
  });

  it('treats unknown language as non-ko, switches to ko', () => {
    expect(toggleLanguage('ja')).toBe('ko');
  });
});

describe('ProfileDropdown — getAuthMenuItems', () => {
  it('includes logout and deleteAccount when authenticated', () => {
    const items = getAuthMenuItems(true);
    expect(items).toContain('logout');
    expect(items).toContain('deleteAccount');
  });

  it('excludes logout and deleteAccount when not authenticated', () => {
    const items = getAuthMenuItems(false);
    expect(items).not.toContain('logout');
    expect(items).not.toContain('deleteAccount');
  });

  it('always includes base items', () => {
    const baseItems = ['people', 'codeRegister', 'darkMode', 'language', 'settings'];
    for (const item of baseItems) {
      expect(getAuthMenuItems(true)).toContain(item);
      expect(getAuthMenuItems(false)).toContain(item);
    }
  });

  it('has 7 items when authenticated', () => {
    expect(getAuthMenuItems(true)).toHaveLength(7);
  });

  it('has 5 items when not authenticated', () => {
    expect(getAuthMenuItems(false)).toHaveLength(5);
  });
});

describe('ProfileDropdown — shouldShowProfile', () => {
  it('returns true when authenticated with profile', () => {
    expect(shouldShowProfile(true, { name: 'Alice', email: 'a@b.com' })).toBe(true);
  });

  it('returns false when not authenticated', () => {
    expect(shouldShowProfile(false, { name: 'Alice', email: 'a@b.com' })).toBe(false);
  });

  it('returns false when profile is null', () => {
    expect(shouldShowProfile(true, null)).toBe(false);
  });

  it('returns false when both are falsy', () => {
    expect(shouldShowProfile(false, null)).toBe(false);
  });

  it('returns true even if profile has minimal data', () => {
    expect(shouldShowProfile(true, {})).toBe(true);
  });
});
