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

function sortCoupleMembers(
  members: FamilyGroupMember[],
): [FamilyGroupMember, FamilyGroupMember] | null {
  const sorted = [...members].sort((a, b) =>
    a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0,
  );
  const first = sorted[0];
  const second = sorted[1];
  if (!first || !second) return null;
  return [first, second];
}

function areBothAlarmAllowed(
  first: FamilyGroupMember,
  second: FamilyGroupMember,
): boolean {
  return first.allow_family_alarms && second.allow_family_alarms;
}

function computeInitialFromDisplayName(displayName: string): string {
  return displayName.charAt(0).toUpperCase();
}

function buildMemberDisplayName(
  member: FamilyGroupMember,
  t: TFn,
): string {
  return member.name || member.email || t('people.unknownMember');
}

function getRoleLabelKey(role: 'owner' | 'member'): string {
  return role === 'owner' ? 'people.owner' : 'people.member';
}

function makeMember(overrides: Partial<FamilyGroupMember> = {}): FamilyGroupMember {
  return {
    id: 'id-1',
    user_id: 'user-1',
    role: 'member',
    joined_at: '2026-01-01T00:00:00Z',
    email: 'test@test.com',
    name: 'Test User',
    picture: null,
    allow_family_alarms: true,
    ...overrides,
  };
}

describe('CoupleView — sortCoupleMembers', () => {
  it('returns null for empty array', () => {
    expect(sortCoupleMembers([])).toBeNull();
  });

  it('returns null for single member', () => {
    expect(sortCoupleMembers([makeMember()])).toBeNull();
  });

  it('puts owner first when owner is second in input', () => {
    const member = makeMember({ id: 'm1', role: 'member' });
    const owner = makeMember({ id: 'm2', role: 'owner' });
    const result = sortCoupleMembers([member, owner]);
    expect(result).not.toBeNull();
    expect(result![0].role).toBe('owner');
    expect(result![1].role).toBe('member');
  });

  it('keeps owner first when already first', () => {
    const owner = makeMember({ id: 'm1', role: 'owner' });
    const member = makeMember({ id: 'm2', role: 'member' });
    const result = sortCoupleMembers([owner, member]);
    expect(result![0].role).toBe('owner');
    expect(result![1].role).toBe('member');
  });

  it('preserves order for two members (no owner)', () => {
    const a = makeMember({ id: 'm1', name: 'Alice', role: 'member' });
    const b = makeMember({ id: 'm2', name: 'Bob', role: 'member' });
    const result = sortCoupleMembers([a, b]);
    expect(result![0].name).toBe('Alice');
    expect(result![1].name).toBe('Bob');
  });

  it('does not mutate the original array', () => {
    const member = makeMember({ id: 'm1', role: 'member' });
    const owner = makeMember({ id: 'm2', role: 'owner' });
    const original = [member, owner];
    sortCoupleMembers(original);
    expect(original[0]!.role).toBe('member');
    expect(original[1]!.role).toBe('owner');
  });

  it('ignores extra members beyond the pair', () => {
    const a = makeMember({ id: 'm1', role: 'owner' });
    const b = makeMember({ id: 'm2', role: 'member' });
    const c = makeMember({ id: 'm3', role: 'member' });
    const result = sortCoupleMembers([a, b, c]);
    expect(result).not.toBeNull();
    expect(result![0].id).toBe('m1');
    expect(result![1].id).toBe('m2');
  });
});

describe('CoupleView — areBothAlarmAllowed', () => {
  it('returns true when both allow alarms', () => {
    const a = makeMember({ allow_family_alarms: true });
    const b = makeMember({ allow_family_alarms: true });
    expect(areBothAlarmAllowed(a, b)).toBe(true);
  });

  it('returns false when first disallows', () => {
    const a = makeMember({ allow_family_alarms: false });
    const b = makeMember({ allow_family_alarms: true });
    expect(areBothAlarmAllowed(a, b)).toBe(false);
  });

  it('returns false when second disallows', () => {
    const a = makeMember({ allow_family_alarms: true });
    const b = makeMember({ allow_family_alarms: false });
    expect(areBothAlarmAllowed(a, b)).toBe(false);
  });

  it('returns false when both disallow', () => {
    const a = makeMember({ allow_family_alarms: false });
    const b = makeMember({ allow_family_alarms: false });
    expect(areBothAlarmAllowed(a, b)).toBe(false);
  });
});

describe('CoupleView — computeInitialFromDisplayName', () => {
  it('returns uppercase first char for name', () => {
    expect(computeInitialFromDisplayName('alice')).toBe('A');
  });

  it('returns uppercase first char for uppercase name', () => {
    expect(computeInitialFromDisplayName('Bob')).toBe('B');
  });

  it('handles Korean name', () => {
    expect(computeInitialFromDisplayName('김철수')).toBe('김');
  });

  it('handles emoji name (charAt returns surrogate)', () => {
    const result = computeInitialFromDisplayName('🔥fire');
    expect(result).toBe('🔥'.charAt(0).toUpperCase());
  });

  it('handles single char', () => {
    expect(computeInitialFromDisplayName('x')).toBe('X');
  });
});

describe('CoupleView — buildMemberDisplayName', () => {
  const t: TFn = (key) => key;

  it('returns name when available', () => {
    const m = makeMember({ name: 'Alice', email: 'alice@test.com' });
    expect(buildMemberDisplayName(m, t)).toBe('Alice');
  });

  it('falls back to email when name is null', () => {
    const m = makeMember({ name: null, email: 'alice@test.com' });
    expect(buildMemberDisplayName(m, t)).toBe('alice@test.com');
  });

  it('falls back to i18n key when both null', () => {
    const m = makeMember({ name: null, email: null });
    expect(buildMemberDisplayName(m, t)).toBe('people.unknownMember');
  });

  it('prefers name over email', () => {
    const m = makeMember({ name: 'Bob', email: 'bob@x.com' });
    expect(buildMemberDisplayName(m, t)).toBe('Bob');
  });

  it('returns empty string name as falsy → falls back to email', () => {
    const m = makeMember({ name: '', email: 'e@e.com' });
    expect(buildMemberDisplayName(m, t)).toBe('e@e.com');
  });
});

describe('CoupleView — getRoleLabelKey', () => {
  it('returns owner key for owner', () => {
    expect(getRoleLabelKey('owner')).toBe('people.owner');
  });

  it('returns member key for member', () => {
    expect(getRoleLabelKey('member')).toBe('people.member');
  });
});
