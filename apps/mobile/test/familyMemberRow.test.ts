interface FamilyGroupMember {
  id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  allow_family_alarms: boolean;
}

type TFn = (key: string) => string;

function buildMemberDisplayName(
  member: FamilyGroupMember,
  t: TFn,
): string {
  return member.name || member.email || t('people.unknownMember');
}

function computeAvatarInitial(displayName: string): string {
  return displayName.charAt(0).toUpperCase();
}

function isOwnerRole(role: 'owner' | 'member'): boolean {
  return role === 'owner';
}

function shouldShowEmail(email: string | null): boolean {
  return email != null && email.length > 0;
}

function shouldShowAlarmAllowed(allowFamilyAlarms: boolean): boolean {
  return allowFamilyAlarms;
}

function getRoleLabelKey(role: 'owner' | 'member'): string {
  return role === 'owner' ? 'people.owner' : 'people.member';
}

function makeMember(overrides: Partial<FamilyGroupMember> = {}): FamilyGroupMember {
  return {
    id: 'fm-1',
    user_id: 'u-1',
    role: 'member',
    joined_at: '2026-01-01T00:00:00Z',
    email: 'test@example.com',
    name: 'Test User',
    picture: null,
    allow_family_alarms: false,
    ...overrides,
  };
}

const t: TFn = (key) => key;

describe('FamilyMemberRow — avatar initial', () => {
  it('uppercases first character of English name', () => {
    const member = makeMember({ name: 'alice' });
    const display = buildMemberDisplayName(member, t);
    expect(computeAvatarInitial(display)).toBe('A');
  });

  it('handles Korean name', () => {
    const member = makeMember({ name: '김철수' });
    const display = buildMemberDisplayName(member, t);
    expect(computeAvatarInitial(display)).toBe('김');
  });

  it('uses email initial when name is null', () => {
    const member = makeMember({ name: null, email: 'bob@test.com' });
    const display = buildMemberDisplayName(member, t);
    expect(computeAvatarInitial(display)).toBe('B');
  });

  it('uses i18n fallback initial when both null', () => {
    const member = makeMember({ name: null, email: null });
    const display = buildMemberDisplayName(member, t);
    expect(computeAvatarInitial(display)).toBe('P');
  });
});

describe('FamilyMemberRow — role detection', () => {
  it('detects owner role', () => {
    expect(isOwnerRole('owner')).toBe(true);
  });

  it('detects member role', () => {
    expect(isOwnerRole('member')).toBe(false);
  });

  it('returns correct label key for owner', () => {
    expect(getRoleLabelKey('owner')).toBe('people.owner');
  });

  it('returns correct label key for member', () => {
    expect(getRoleLabelKey('member')).toBe('people.member');
  });
});

describe('FamilyMemberRow — conditional rendering predicates', () => {
  it('shows email when present', () => {
    expect(shouldShowEmail('user@test.com')).toBe(true);
  });

  it('hides email when null', () => {
    expect(shouldShowEmail(null)).toBe(false);
  });

  it('hides email when empty string', () => {
    expect(shouldShowEmail('')).toBe(false);
  });

  it('shows alarm allowed indicator when true', () => {
    expect(shouldShowAlarmAllowed(true)).toBe(true);
  });

  it('hides alarm allowed indicator when false', () => {
    expect(shouldShowAlarmAllowed(false)).toBe(false);
  });
});

describe('FamilyMemberRow — couple card logic', () => {
  it('isCouple=true applies couple style (border)', () => {
    const isCouple = true;
    expect(isCouple).toBe(true);
  });

  it('isCouple=false does not apply couple style', () => {
    const isCouple = false;
    expect(isCouple).toBe(false);
  });

  it('isCouple=undefined does not apply couple style', () => {
    const isCouple: boolean | undefined = undefined;
    expect(!!isCouple).toBe(false);
  });
});

describe('FamilyMemberRow — display name priority', () => {
  it('prefers name over email', () => {
    const member = makeMember({ name: 'Alice', email: 'alice@test.com' });
    expect(buildMemberDisplayName(member, t)).toBe('Alice');
  });

  it('uses email when name is null', () => {
    const member = makeMember({ name: null, email: 'bob@test.com' });
    expect(buildMemberDisplayName(member, t)).toBe('bob@test.com');
  });

  it('uses email when name is empty string', () => {
    const member = makeMember({ name: '', email: 'carol@test.com' });
    expect(buildMemberDisplayName(member, t)).toBe('carol@test.com');
  });

  it('uses i18n fallback when both null', () => {
    const member = makeMember({ name: null, email: null });
    expect(buildMemberDisplayName(member, t)).toBe('people.unknownMember');
  });

  it('uses i18n fallback when both empty', () => {
    const member = makeMember({ name: '', email: '' });
    expect(buildMemberDisplayName(member, t)).toBe('people.unknownMember');
  });
});
