interface FamilyGroupMember {
  user_id: string;
  name: string | null;
  email: string;
  role: string;
}

const MAX_TEXT_LENGTH = 500;

function filterRecipients(
  members: FamilyGroupMember[],
  selfUserId: string,
): FamilyGroupMember[] {
  return members.filter((m) => m.user_id !== selfUserId);
}

function canSend(
  selectedRecipient: string | null,
  text: string,
  isPending: boolean,
): boolean {
  return !!selectedRecipient && text.trim().length > 0 && !isPending;
}

function isTextValid(text: string): boolean {
  return text.trim().length > 0 && text.length <= MAX_TEXT_LENGTH;
}

function getDisplayName(member: FamilyGroupMember): string {
  return member.name || member.email || '?';
}

function getInitial(member: FamilyGroupMember): string {
  return getDisplayName(member).charAt(0).toUpperCase();
}

function shouldEnableQuery(
  isAuthenticated: boolean,
  isConnected: boolean,
): boolean {
  return isAuthenticated && isConnected;
}

function getCharCount(text: string): string {
  return `${text.length}/${MAX_TEXT_LENGTH}`;
}

function makeMember(overrides: Partial<FamilyGroupMember> = {}): FamilyGroupMember {
  return {
    user_id: 'u-1',
    name: 'Alice',
    email: 'alice@test.com',
    role: 'member',
    ...overrides,
  };
}

describe('NoteCreateScreen — filterRecipients', () => {
  const self = 'u-self';
  const members = [
    makeMember({ user_id: 'u-self', name: 'Me' }),
    makeMember({ user_id: 'u-2', name: 'Bob' }),
    makeMember({ user_id: 'u-3', name: 'Carol' }),
  ];

  it('excludes self from recipients', () => {
    const result = filterRecipients(members, self);
    expect(result.length).toBe(2);
    expect(result.map((m) => m.user_id)).toEqual(['u-2', 'u-3']);
  });

  it('returns all members if self not in list', () => {
    const result = filterRecipients(members, 'unknown');
    expect(result.length).toBe(3);
  });

  it('returns empty array for empty members', () => {
    expect(filterRecipients([], self)).toEqual([]);
  });

  it('returns empty array when only self exists', () => {
    const result = filterRecipients([makeMember({ user_id: 'u-self' })], 'u-self');
    expect(result.length).toBe(0);
  });
});

describe('NoteCreateScreen — canSend', () => {
  it('can send when all conditions met', () => {
    expect(canSend('u-2', 'hello', false)).toBe(true);
  });

  it('cannot send without recipient', () => {
    expect(canSend(null, 'hello', false)).toBe(false);
  });

  it('cannot send with empty text', () => {
    expect(canSend('u-2', '', false)).toBe(false);
  });

  it('cannot send with whitespace-only text', () => {
    expect(canSend('u-2', '   ', false)).toBe(false);
  });

  it('cannot send when pending', () => {
    expect(canSend('u-2', 'hello', true)).toBe(false);
  });

  it('cannot send with all conditions failing', () => {
    expect(canSend(null, '', true)).toBe(false);
  });
});

describe('NoteCreateScreen — text validation', () => {
  it('valid text passes', () => {
    expect(isTextValid('hello')).toBe(true);
  });

  it('empty text fails', () => {
    expect(isTextValid('')).toBe(false);
  });

  it('whitespace-only text fails', () => {
    expect(isTextValid('   ')).toBe(false);
  });

  it('text at max length passes', () => {
    expect(isTextValid('a'.repeat(MAX_TEXT_LENGTH))).toBe(true);
  });

  it('text over max length fails', () => {
    expect(isTextValid('a'.repeat(MAX_TEXT_LENGTH + 1))).toBe(false);
  });
});

describe('NoteCreateScreen — getDisplayName', () => {
  it('returns name when available', () => {
    expect(getDisplayName(makeMember({ name: 'Alice' }))).toBe('Alice');
  });

  it('falls back to email when name is null', () => {
    expect(getDisplayName(makeMember({ name: null, email: 'bob@test.com' }))).toBe('bob@test.com');
  });

  it('falls back to ? when both are empty', () => {
    expect(getDisplayName(makeMember({ name: null, email: '' }))).toBe('?');
  });
});

describe('NoteCreateScreen — getInitial', () => {
  it('uppercases first char of name', () => {
    expect(getInitial(makeMember({ name: 'alice' }))).toBe('A');
  });

  it('uppercases first char of email fallback', () => {
    expect(getInitial(makeMember({ name: null, email: 'bob@x.com' }))).toBe('B');
  });

  it('returns ? for empty display', () => {
    expect(getInitial(makeMember({ name: null, email: '' }))).toBe('?');
  });
});

describe('NoteCreateScreen — shouldEnableQuery', () => {
  it('enables when authenticated and connected', () => {
    expect(shouldEnableQuery(true, true)).toBe(true);
  });

  it('disables when not authenticated', () => {
    expect(shouldEnableQuery(false, true)).toBe(false);
  });

  it('disables when not connected', () => {
    expect(shouldEnableQuery(true, false)).toBe(false);
  });

  it('disables when both false', () => {
    expect(shouldEnableQuery(false, false)).toBe(false);
  });
});

describe('NoteCreateScreen — getCharCount', () => {
  it('shows 0/500 for empty text', () => {
    expect(getCharCount('')).toBe('0/500');
  });

  it('shows correct count for partial text', () => {
    expect(getCharCount('hello')).toBe('5/500');
  });

  it('shows 500/500 at max', () => {
    expect(getCharCount('a'.repeat(500))).toBe('500/500');
  });
});

describe('NoteCreateScreen — MAX_TEXT_LENGTH constant', () => {
  it('is 500', () => {
    expect(MAX_TEXT_LENGTH).toBe(500);
  });
});
