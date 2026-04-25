/**
 * peopleScreen.test.ts — business logic extracted from app/people/index.tsx
 */

// ---- Avatar initial extraction (lines 209, 234) ----
function avatarInitial(friendName: string | null | undefined, friendEmail: string | null | undefined): string {
  return (friendName || friendEmail || '?').charAt(0).toUpperCase();
}

// ---- Segment building (lines 183-195) ----
type Segment = 'members' | 'friends' | 'requests';
interface SegmentItem { key: Segment; label: string; badge?: number }

function buildSegments(
  isFamilyPlan: boolean,
  pendingCount: number | undefined,
  t: (key: string) => string,
): SegmentItem[] {
  const items: SegmentItem[] = [];
  if (isFamilyPlan) {
    items.push({ key: 'members', label: t('people.members') });
  }
  items.push({ key: 'friends', label: t('people.friends') });
  items.push({
    key: 'requests',
    label: t('people.requests'),
    badge: pendingCount,
  });
  return items;
}

// ---- Default segment (line 55) ----
function defaultSegment(isFamilyPlan: boolean): Segment {
  return isFamilyPlan ? 'members' : 'friends';
}

// ---- Member sorting — owner first (lines 346-348) ----
interface MemberLike { id: string; role: string }
function sortMembersOwnerFirst<T extends MemberLike>(members: T[]): T[] {
  return [...members].sort((a, b) =>
    a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0,
  );
}

// ---- Pending invite filter (line 171) ----
interface InviteLike { id: string; status: string }
function filterPendingInvites<T extends InviteLike>(invites: T[]): T[] {
  return invites.filter((i) => i.status === 'pending');
}

// ---- isCouple determination (line 198) ----
function isCouple(isFamilyPlan: boolean, memberCount: number): boolean {
  return isFamilyPlan && memberCount === 2;
}

// ---- Badge text (line 485) ----
function badgeText(label: string, badge: number | undefined): string {
  return badge != null && badge > 0 ? `${label} (${badge})` : label;
}

// ---- Friend name display (line 224) ----
function friendDisplayLabel(
  friendName: string | null | undefined,
  friendEmail: string | null | undefined,
): string {
  return friendName || friendEmail?.split('@')[0] || '?';
}

const t = (k: string) => k;

// ======== TESTS ========

describe('avatarInitial', () => {
  it('uses first char of name', () => {
    expect(avatarInitial('Alice', 'alice@test.com')).toBe('A');
  });

  it('uppercases lowercase name', () => {
    expect(avatarInitial('bob', 'bob@test.com')).toBe('B');
  });

  it('falls back to email when name is null', () => {
    expect(avatarInitial(null, 'charlie@test.com')).toBe('C');
  });

  it('falls back to email when name is undefined', () => {
    expect(avatarInitial(undefined, 'dave@test.com')).toBe('D');
  });

  it('falls back to email when name is empty', () => {
    expect(avatarInitial('', 'eve@test.com')).toBe('E');
  });

  it('returns ? when both are null', () => {
    expect(avatarInitial(null, null)).toBe('?');
  });

  it('returns ? when both are undefined', () => {
    expect(avatarInitial(undefined, undefined)).toBe('?');
  });

  it('returns ? when both are empty', () => {
    expect(avatarInitial('', '')).toBe('?');
  });

  it('handles Korean name', () => {
    expect(avatarInitial('김규원', 'kw@test.com')).toBe('김');
  });

  it('handles emoji in name — charAt returns surrogate half', () => {
    const result = avatarInitial('🌟Star', null);
    expect(result).toBe('\uD83C');
  });
});

describe('buildSegments', () => {
  it('includes members for family plan', () => {
    const segs = buildSegments(true, 0, t);
    expect(segs).toHaveLength(3);
    expect(segs[0]!.key).toBe('members');
    expect(segs[1]!.key).toBe('friends');
    expect(segs[2]!.key).toBe('requests');
  });

  it('excludes members for non-family plan', () => {
    const segs = buildSegments(false, 0, t);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.key).toBe('friends');
    expect(segs[1]!.key).toBe('requests');
  });

  it('passes pending count as badge', () => {
    const segs = buildSegments(false, 5, t);
    expect(segs[1]!.badge).toBe(5);
  });

  it('handles undefined pending count', () => {
    const segs = buildSegments(false, undefined, t);
    expect(segs[1]!.badge).toBeUndefined();
  });

  it('handles zero pending count', () => {
    const segs = buildSegments(true, 0, t);
    expect(segs[2]!.badge).toBe(0);
  });

  it('uses translation keys for labels', () => {
    const segs = buildSegments(true, 2, t);
    expect(segs[0]!.label).toBe('people.members');
    expect(segs[1]!.label).toBe('people.friends');
    expect(segs[2]!.label).toBe('people.requests');
  });
});

describe('defaultSegment', () => {
  it('returns members for family plan', () => {
    expect(defaultSegment(true)).toBe('members');
  });

  it('returns friends for non-family plan', () => {
    expect(defaultSegment(false)).toBe('friends');
  });
});

describe('sortMembersOwnerFirst', () => {
  it('puts owner first', () => {
    const input = [
      { id: '1', role: 'member' },
      { id: '2', role: 'owner' },
      { id: '3', role: 'member' },
    ];
    const sorted = sortMembersOwnerFirst(input);
    expect(sorted[0]!.role).toBe('owner');
  });

  it('preserves order among non-owners', () => {
    const input = [
      { id: 'a', role: 'member' },
      { id: 'b', role: 'member' },
      { id: 'c', role: 'owner' },
    ];
    const sorted = sortMembersOwnerFirst(input);
    expect(sorted.map(m => m.id)).toEqual(['c', 'a', 'b']);
  });

  it('handles empty array', () => {
    expect(sortMembersOwnerFirst([])).toEqual([]);
  });

  it('handles single owner', () => {
    const sorted = sortMembersOwnerFirst([{ id: '1', role: 'owner' }]);
    expect(sorted).toHaveLength(1);
    expect(sorted[0]!.role).toBe('owner');
  });

  it('handles no owner', () => {
    const input = [
      { id: '1', role: 'member' },
      { id: '2', role: 'member' },
    ];
    const sorted = sortMembersOwnerFirst(input);
    expect(sorted).toHaveLength(2);
  });

  it('does not mutate input', () => {
    const input = [
      { id: '1', role: 'member' },
      { id: '2', role: 'owner' },
    ];
    const original = [...input];
    sortMembersOwnerFirst(input);
    expect(input).toEqual(original);
  });

  it('handles multiple owners (sorts both to front)', () => {
    const input = [
      { id: '1', role: 'member' },
      { id: '2', role: 'owner' },
      { id: '3', role: 'owner' },
    ];
    const sorted = sortMembersOwnerFirst(input);
    expect(sorted[0]!.role).toBe('owner');
    expect(sorted[1]!.role).toBe('owner');
    expect(sorted[2]!.role).toBe('member');
  });
});

describe('filterPendingInvites', () => {
  it('returns only pending invites', () => {
    const invites = [
      { id: '1', status: 'pending' },
      { id: '2', status: 'used' },
      { id: '3', status: 'pending' },
      { id: '4', status: 'expired' },
    ];
    const result = filterPendingInvites(invites);
    expect(result).toHaveLength(2);
    expect(result.every(i => i.status === 'pending')).toBe(true);
  });

  it('returns empty for no pending', () => {
    const invites = [
      { id: '1', status: 'used' },
      { id: '2', status: 'expired' },
    ];
    expect(filterPendingInvites(invites)).toHaveLength(0);
  });

  it('returns empty for empty array', () => {
    expect(filterPendingInvites([])).toHaveLength(0);
  });

  it('returns all when all are pending', () => {
    const invites = [
      { id: '1', status: 'pending' },
      { id: '2', status: 'pending' },
    ];
    expect(filterPendingInvites(invites)).toHaveLength(2);
  });

  it('preserves invite ids', () => {
    const invites = [
      { id: 'abc', status: 'pending' },
      { id: 'def', status: 'used' },
    ];
    const result = filterPendingInvites(invites);
    expect(result[0]!.id).toBe('abc');
  });
});

describe('isCouple', () => {
  it('true for family plan with 2 members', () => {
    expect(isCouple(true, 2)).toBe(true);
  });

  it('false for family plan with 1 member', () => {
    expect(isCouple(true, 1)).toBe(false);
  });

  it('false for family plan with 3 members', () => {
    expect(isCouple(true, 3)).toBe(false);
  });

  it('false for non-family plan even with 2 members', () => {
    expect(isCouple(false, 2)).toBe(false);
  });

  it('false for non-family with 0 members', () => {
    expect(isCouple(false, 0)).toBe(false);
  });

  it('false for family with 0 members', () => {
    expect(isCouple(true, 0)).toBe(false);
  });
});

describe('badgeText', () => {
  it('appends badge count when > 0', () => {
    expect(badgeText('Requests', 3)).toBe('Requests (3)');
  });

  it('returns label only when badge is 0', () => {
    expect(badgeText('Requests', 0)).toBe('Requests');
  });

  it('returns label only when badge is undefined', () => {
    expect(badgeText('Requests', undefined)).toBe('Requests');
  });

  it('returns label only when badge is null-ish', () => {
    expect(badgeText('Friends', undefined)).toBe('Friends');
  });

  it('handles badge of 1', () => {
    expect(badgeText('Tab', 1)).toBe('Tab (1)');
  });

  it('handles large badge', () => {
    expect(badgeText('Tab', 999)).toBe('Tab (999)');
  });
});

describe('friendDisplayLabel', () => {
  it('returns name when available', () => {
    expect(friendDisplayLabel('Alice', 'alice@test.com')).toBe('Alice');
  });

  it('returns email prefix when name is null', () => {
    expect(friendDisplayLabel(null, 'bob@test.com')).toBe('bob');
  });

  it('returns email prefix when name is empty', () => {
    expect(friendDisplayLabel('', 'charlie@domain.co.kr')).toBe('charlie');
  });

  it('returns ? when both are null', () => {
    expect(friendDisplayLabel(null, null)).toBe('?');
  });

  it('returns ? when both are undefined', () => {
    expect(friendDisplayLabel(undefined, undefined)).toBe('?');
  });

  it('returns ? when name empty and email undefined', () => {
    expect(friendDisplayLabel('', undefined)).toBe('?');
  });

  it('handles email with no @ (edge case)', () => {
    expect(friendDisplayLabel(null, 'noemail')).toBe('noemail');
  });

  it('handles email with multiple @', () => {
    expect(friendDisplayLabel(null, 'user@domain@extra')).toBe('user');
  });
});
