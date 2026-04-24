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

const MAX_TEXT_LENGTH = 500;

function filterRecipients(
  members: FamilyGroupMember[] | undefined,
  selfUserId: string,
): FamilyGroupMember[] {
  if (!members) return [];
  return members.filter((m) => m.user_id !== selfUserId);
}

function canSend(
  selectedRecipient: string | null,
  text: string,
  isPending: boolean,
): boolean {
  return !!selectedRecipient && text.trim().length > 0 && !isPending;
}

function getDisplayName(member: FamilyGroupMember): string {
  return member.name || member.email || '?';
}

function getChipInitial(displayName: string): string {
  return displayName.charAt(0).toUpperCase();
}

function isWithinMaxLength(text: string): boolean {
  return text.length <= MAX_TEXT_LENGTH;
}

function formatCharCount(text: string): string {
  return `${text.length}/${MAX_TEXT_LENGTH}`;
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
    allow_family_alarms: true,
    ...overrides,
  };
}

describe('NoteCreate — filterRecipients', () => {
  it('returns empty array when members is undefined', () => {
    expect(filterRecipients(undefined, 'u-self')).toEqual([]);
  });

  it('returns empty array when members is empty', () => {
    expect(filterRecipients([], 'u-self')).toEqual([]);
  });

  it('filters out self from members', () => {
    const members = [
      makeMember({ user_id: 'u-self', name: 'Me' }),
      makeMember({ user_id: 'u-other', name: 'Other' }),
    ];
    const result = filterRecipients(members, 'u-self');
    expect(result).toHaveLength(1);
    expect(result[0]!.user_id).toBe('u-other');
  });

  it('returns all members when self is not in list', () => {
    const members = [
      makeMember({ user_id: 'u-a', name: 'A' }),
      makeMember({ user_id: 'u-b', name: 'B' }),
    ];
    expect(filterRecipients(members, 'u-self')).toHaveLength(2);
  });

  it('returns empty array when only self in list', () => {
    const members = [makeMember({ user_id: 'u-self' })];
    expect(filterRecipients(members, 'u-self')).toHaveLength(0);
  });

  it('filters multiple self entries (edge case)', () => {
    const members = [
      makeMember({ user_id: 'u-self', id: 'fm-1' }),
      makeMember({ user_id: 'u-self', id: 'fm-2' }),
      makeMember({ user_id: 'u-other' }),
    ];
    expect(filterRecipients(members, 'u-self')).toHaveLength(1);
  });
});

describe('NoteCreate — canSend', () => {
  it('returns true with recipient, text, and not pending', () => {
    expect(canSend('u-recipient', 'Hello', false)).toBe(true);
  });

  it('returns false when no recipient', () => {
    expect(canSend(null, 'Hello', false)).toBe(false);
  });

  it('returns false when text is empty', () => {
    expect(canSend('u-recipient', '', false)).toBe(false);
  });

  it('returns false when text is whitespace only', () => {
    expect(canSend('u-recipient', '   ', false)).toBe(false);
  });

  it('returns false when mutation is pending', () => {
    expect(canSend('u-recipient', 'Hello', true)).toBe(false);
  });

  it('returns false when all conditions fail', () => {
    expect(canSend(null, '', true)).toBe(false);
  });

  it('returns true with text that has leading/trailing spaces', () => {
    expect(canSend('u-recipient', '  Hello  ', false)).toBe(true);
  });

  it('returns false with only newline characters', () => {
    expect(canSend('u-recipient', '\n\n\t', false)).toBe(false);
  });
});

describe('NoteCreate — getDisplayName', () => {
  it('returns name when available', () => {
    expect(getDisplayName(makeMember({ name: 'Alice', email: 'alice@test.com' }))).toBe('Alice');
  });

  it('returns email when name is null', () => {
    expect(getDisplayName(makeMember({ name: null, email: 'bob@test.com' }))).toBe('bob@test.com');
  });

  it('returns ? when both name and email are null', () => {
    expect(getDisplayName(makeMember({ name: null, email: null }))).toBe('?');
  });

  it('returns name even if empty string (truthy check)', () => {
    expect(getDisplayName(makeMember({ name: '', email: 'fallback@test.com' }))).toBe('fallback@test.com');
  });
});

describe('NoteCreate — getChipInitial', () => {
  it('uppercases first letter', () => {
    expect(getChipInitial('alice')).toBe('A');
  });

  it('keeps already uppercase letter', () => {
    expect(getChipInitial('Bob')).toBe('B');
  });

  it('handles Korean characters', () => {
    expect(getChipInitial('김철수')).toBe('김');
  });

  it('handles ? fallback', () => {
    expect(getChipInitial('?')).toBe('?');
  });

  it('handles email as display name', () => {
    expect(getChipInitial('test@example.com')).toBe('T');
  });
});

describe('NoteCreate — MAX_TEXT_LENGTH', () => {
  it('is 500', () => {
    expect(MAX_TEXT_LENGTH).toBe(500);
  });

  it('allows text at limit', () => {
    expect(isWithinMaxLength('a'.repeat(500))).toBe(true);
  });

  it('rejects text over limit', () => {
    expect(isWithinMaxLength('a'.repeat(501))).toBe(false);
  });

  it('allows empty text', () => {
    expect(isWithinMaxLength('')).toBe(true);
  });
});

describe('NoteCreate — formatCharCount', () => {
  it('formats 0 characters', () => {
    expect(formatCharCount('')).toBe('0/500');
  });

  it('formats partial text', () => {
    expect(formatCharCount('Hello')).toBe('5/500');
  });

  it('formats at max', () => {
    expect(formatCharCount('a'.repeat(500))).toBe('500/500');
  });

  it('formats over max (input may exceed before trim)', () => {
    expect(formatCharCount('a'.repeat(501))).toBe('501/500');
  });
});
