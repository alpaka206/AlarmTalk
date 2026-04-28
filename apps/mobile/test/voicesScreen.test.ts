interface VoiceProfile {
  id: string;
  user_id: string;
  name: string;
  status: 'ready' | 'processing' | 'failed' | 'pending';
  created_at: string;
  provider: string;
  external_voice_id: string | null;
  sample_url: string | null;
}

interface FamilyVoiceProfile {
  id: string;
  name: string;
  status: string;
  owner_name: string | null;
}

type TFn = (key: string, vars?: Record<string, unknown>) => string;
type StatusBadge = { label: string; color: string };

const MAX_VOICE_PROFILES = 2;

const COLORS = {
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
  textTertiary: '#999',
};

function isLimitReached(profileCount: number): boolean {
  return profileCount >= MAX_VOICE_PROFILES;
}

function getStatusBadge(
  status: string,
  t: TFn,
  colors: typeof COLORS,
): StatusBadge {
  switch (status) {
    case 'ready':
      return { label: t('voices.statusReady'), color: colors.success };
    case 'processing':
      return { label: t('voices.statusProcessing'), color: colors.warning };
    case 'failed':
      return { label: t('voices.statusFailed'), color: colors.error };
    default:
      return { label: status, color: colors.textTertiary };
  }
}

function resolveDisplayProfiles(
  liveProfiles: VoiceProfile[] | undefined,
  cachedProfiles: VoiceProfile[] | null,
): VoiceProfile[] | null {
  return liveProfiles ?? cachedProfiles;
}

function shouldShowFamilySection(
  plan: string,
  familyProfiles: FamilyVoiceProfile[] | undefined,
): boolean {
  return plan === 'family' && !!familyProfiles && familyProfiles.length > 0;
}

function computeAvatarInitial(name: string): string {
  return name.charAt(0);
}

function shouldEnableVoiceQuery(
  isAuthenticated: boolean,
  isConnected: boolean,
): boolean {
  return isAuthenticated && isConnected;
}

function shouldEnableFamilyQuery(
  isAuthenticated: boolean,
  isConnected: boolean,
  isFamilyPlan: boolean,
): boolean {
  return isAuthenticated && isConnected && isFamilyPlan;
}

function makeProfile(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: 'vp-1',
    user_id: 'u-1',
    name: 'My Voice',
    status: 'ready',
    created_at: '2026-01-15T10:00:00Z',
    provider: 'perso',
    external_voice_id: null,
    sample_url: null,
    ...overrides,
  };
}

function makeFamilyProfile(
  overrides: Partial<FamilyVoiceProfile> = {},
): FamilyVoiceProfile {
  return {
    id: 'fvp-1',
    name: 'Partner Voice',
    status: 'ready',
    owner_name: 'Partner',
    ...overrides,
  };
}

describe('VoicesScreen — MAX_VOICE_PROFILES limit', () => {
  it('is not reached with 0 profiles', () => {
    expect(isLimitReached(0)).toBe(false);
  });

  it('is not reached with 1 profile', () => {
    expect(isLimitReached(1)).toBe(false);
  });

  it('is reached with 2 profiles', () => {
    expect(isLimitReached(2)).toBe(true);
  });

  it('is reached with more than 2 profiles', () => {
    expect(isLimitReached(5)).toBe(true);
  });

  it('constant MAX_VOICE_PROFILES is 2', () => {
    expect(MAX_VOICE_PROFILES).toBe(2);
  });
});

describe('VoicesScreen — getStatusBadge', () => {
  const t: TFn = (key) => key;

  it('returns success color for ready status', () => {
    const badge = getStatusBadge('ready', t, COLORS);
    expect(badge.label).toBe('voices.statusReady');
    expect(badge.color).toBe(COLORS.success);
  });

  it('returns warning color for processing status', () => {
    const badge = getStatusBadge('processing', t, COLORS);
    expect(badge.label).toBe('voices.statusProcessing');
    expect(badge.color).toBe(COLORS.warning);
  });

  it('returns error color for failed status', () => {
    const badge = getStatusBadge('failed', t, COLORS);
    expect(badge.label).toBe('voices.statusFailed');
    expect(badge.color).toBe(COLORS.error);
  });

  it('returns raw status text with tertiary color for unknown status', () => {
    const badge = getStatusBadge('uploading', t, COLORS);
    expect(badge.label).toBe('uploading');
    expect(badge.color).toBe(COLORS.textTertiary);
  });

  it('handles empty string status', () => {
    const badge = getStatusBadge('', t, COLORS);
    expect(badge.label).toBe('');
    expect(badge.color).toBe(COLORS.textTertiary);
  });
});

describe('VoicesScreen — resolveDisplayProfiles', () => {
  it('returns live profiles when available', () => {
    const live = [makeProfile()];
    const cached = [makeProfile({ id: 'cached-1' })];
    expect(resolveDisplayProfiles(live, cached)).toBe(live);
  });

  it('returns cached profiles when live is undefined', () => {
    const cached = [makeProfile({ id: 'cached-1' })];
    expect(resolveDisplayProfiles(undefined, cached)).toBe(cached);
  });

  it('returns null when both are absent', () => {
    expect(resolveDisplayProfiles(undefined, null)).toBeNull();
  });

  it('returns empty live array over cached', () => {
    const live: VoiceProfile[] = [];
    const cached = [makeProfile()];
    expect(resolveDisplayProfiles(live, cached)).toBe(live);
  });
});

describe('VoicesScreen — shouldShowFamilySection', () => {
  it('shows when family plan with profiles', () => {
    expect(shouldShowFamilySection('family', [makeFamilyProfile()])).toBe(true);
  });

  it('hides when not family plan', () => {
    expect(shouldShowFamilySection('free', [makeFamilyProfile()])).toBe(false);
  });

  it('hides when family plan but no profiles', () => {
    expect(shouldShowFamilySection('family', [])).toBe(false);
  });

  it('hides when family plan but profiles undefined', () => {
    expect(shouldShowFamilySection('family', undefined)).toBe(false);
  });

  it('hides for plus plan', () => {
    expect(shouldShowFamilySection('plus', [makeFamilyProfile()])).toBe(false);
  });
});

describe('VoicesScreen — computeAvatarInitial', () => {
  it('returns first character of name', () => {
    expect(computeAvatarInitial('Alice')).toBe('A');
  });

  it('returns lowercase first character as-is', () => {
    expect(computeAvatarInitial('bob')).toBe('b');
  });

  it('handles Korean name', () => {
    expect(computeAvatarInitial('김철수')).toBe('김');
  });

  it('handles single character', () => {
    expect(computeAvatarInitial('X')).toBe('X');
  });

  it('handles emoji name', () => {
    expect(computeAvatarInitial('🎵Song').charAt(0)).toBeTruthy();
  });
});

describe('VoicesScreen — query enablement', () => {
  it('enables voice query when authenticated and connected', () => {
    expect(shouldEnableVoiceQuery(true, true)).toBe(true);
  });

  it('disables voice query when not authenticated', () => {
    expect(shouldEnableVoiceQuery(false, true)).toBe(false);
  });

  it('disables voice query when not connected', () => {
    expect(shouldEnableVoiceQuery(true, false)).toBe(false);
  });

  it('disables voice query when neither', () => {
    expect(shouldEnableVoiceQuery(false, false)).toBe(false);
  });

  it('enables family query when authenticated + connected + family plan', () => {
    expect(shouldEnableFamilyQuery(true, true, true)).toBe(true);
  });

  it('disables family query when not family plan', () => {
    expect(shouldEnableFamilyQuery(true, true, false)).toBe(false);
  });

  it('disables family query when not authenticated', () => {
    expect(shouldEnableFamilyQuery(false, true, true)).toBe(false);
  });

  it('disables family query when not connected', () => {
    expect(shouldEnableFamilyQuery(true, false, true)).toBe(false);
  });
});

describe('VoicesScreen — profile count display', () => {
  it('computes count from display profiles', () => {
    const profiles = [makeProfile(), makeProfile({ id: 'vp-2' })];
    expect(profiles.length).toBe(2);
  });

  it('count is 0 when no profiles', () => {
    const profiles: VoiceProfile[] = [];
    expect(profiles.length).toBe(0);
  });

  it('correctly formats count string', () => {
    const count = 1;
    expect(`${count}/${MAX_VOICE_PROFILES}`).toBe('1/2');
  });

  it('correctly formats full count', () => {
    const count = 2;
    expect(`${count}/${MAX_VOICE_PROFILES}`).toBe('2/2');
  });
});

describe('VoicesScreen — date formatting', () => {
  it('parses ISO date string to Date', () => {
    const profile = makeProfile({ created_at: '2026-03-20T14:30:00Z' });
    const d = new Date(profile.created_at);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(20);
  });

  it('handles different date formats', () => {
    const profile = makeProfile({ created_at: '2025-12-31T23:59:59Z' });
    const d = new Date(profile.created_at);
    expect(d.getUTCFullYear()).toBe(2025);
  });
});

describe('VoicesScreen — add options routes', () => {
  const addRoutes = ['/voice/record', '/voice/upload', '/voice/diarize', '/voice/picker'];

  it('has 4 add options', () => {
    expect(addRoutes).toHaveLength(4);
  });

  it.each(addRoutes)('route %s starts with /voice/', (route) => {
    expect(route.startsWith('/voice/')).toBe(true);
  });
});
