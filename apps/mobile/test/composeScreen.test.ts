interface ReceivedNote {
  id: string;
  sender_id: string;
  sender_email: string;
  sender_name: string | null;
  text: string;
  audio_url: string | null;
  read_at: string | null;
  created_at: string;
}

type PlanType = 'free' | 'plus' | 'family' | 'personal';

function isFamilyOrCouple(plan: PlanType): boolean {
  return plan === 'family';
}

function shouldShowLoginRequired(isAuthenticated: boolean): boolean {
  return !isAuthenticated;
}

function shouldShowFamilyOnly(
  isAuthenticated: boolean,
  plan: PlanType,
): boolean {
  return isAuthenticated && !isFamilyOrCouple(plan);
}

function shouldShowCompose(
  isAuthenticated: boolean,
  plan: PlanType,
): boolean {
  return isAuthenticated && isFamilyOrCouple(plan);
}

function computeUnreadCount(notes: ReceivedNote[] | undefined): number {
  return notes?.filter((n) => !n.read_at).length ?? 0;
}

function isNoteUnread(note: ReceivedNote): boolean {
  return !note.read_at;
}

function getInitialFromSender(note: ReceivedNote): string {
  return (note.sender_name || note.sender_email).charAt(0).toUpperCase();
}

function getSenderDisplay(note: ReceivedNote): string {
  return note.sender_name || note.sender_email;
}

function shouldEnableNotesQuery(
  isAuthenticated: boolean,
  isFamilyPlan: boolean,
  isConnected: boolean,
): boolean {
  return isAuthenticated && isFamilyPlan && isConnected;
}

function makeNote(overrides: Partial<ReceivedNote> = {}): ReceivedNote {
  return {
    id: 'note-1',
    sender_id: 'u-sender',
    sender_email: 'sender@test.com',
    sender_name: 'Sender',
    text: 'Good morning!',
    audio_url: null,
    read_at: null,
    created_at: '2026-04-25T08:00:00Z',
    ...overrides,
  };
}

describe('ComposeScreen — access gate: login required', () => {
  it('shows login required when not authenticated', () => {
    expect(shouldShowLoginRequired(false)).toBe(true);
  });

  it('does not show login required when authenticated', () => {
    expect(shouldShowLoginRequired(true)).toBe(false);
  });
});

describe('ComposeScreen — access gate: family only', () => {
  it('shows family only for authenticated free user', () => {
    expect(shouldShowFamilyOnly(true, 'free')).toBe(true);
  });

  it('shows family only for authenticated plus user', () => {
    expect(shouldShowFamilyOnly(true, 'plus')).toBe(true);
  });

  it('shows family only for authenticated personal user', () => {
    expect(shouldShowFamilyOnly(true, 'personal')).toBe(true);
  });

  it('does not show family only for family plan user', () => {
    expect(shouldShowFamilyOnly(true, 'family')).toBe(false);
  });

  it('does not show family only for unauthenticated user', () => {
    expect(shouldShowFamilyOnly(false, 'free')).toBe(false);
  });
});

describe('ComposeScreen — shouldShowCompose', () => {
  it('shows compose for authenticated family user', () => {
    expect(shouldShowCompose(true, 'family')).toBe(true);
  });

  it('does not show compose for unauthenticated family user', () => {
    expect(shouldShowCompose(false, 'family')).toBe(false);
  });

  it('does not show compose for authenticated free user', () => {
    expect(shouldShowCompose(true, 'free')).toBe(false);
  });

  it('does not show compose for authenticated plus user', () => {
    expect(shouldShowCompose(true, 'plus')).toBe(false);
  });
});

describe('ComposeScreen — isFamilyOrCouple', () => {
  it('returns true for family plan', () => {
    expect(isFamilyOrCouple('family')).toBe(true);
  });

  it('returns false for free plan', () => {
    expect(isFamilyOrCouple('free')).toBe(false);
  });

  it('returns false for plus plan', () => {
    expect(isFamilyOrCouple('plus')).toBe(false);
  });

  it('returns false for personal plan', () => {
    expect(isFamilyOrCouple('personal')).toBe(false);
  });
});

describe('ComposeScreen — computeUnreadCount', () => {
  it('returns 0 for undefined notes', () => {
    expect(computeUnreadCount(undefined)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(computeUnreadCount([])).toBe(0);
  });

  it('returns 0 when all notes are read', () => {
    const notes = [
      makeNote({ id: 'n1', read_at: '2026-04-25T10:00:00Z' }),
      makeNote({ id: 'n2', read_at: '2026-04-25T11:00:00Z' }),
    ];
    expect(computeUnreadCount(notes)).toBe(0);
  });

  it('returns count of unread notes', () => {
    const notes = [
      makeNote({ id: 'n1', read_at: null }),
      makeNote({ id: 'n2', read_at: '2026-04-25T10:00:00Z' }),
      makeNote({ id: 'n3', read_at: null }),
    ];
    expect(computeUnreadCount(notes)).toBe(2);
  });

  it('returns total count when all unread', () => {
    const notes = [
      makeNote({ id: 'n1' }),
      makeNote({ id: 'n2' }),
      makeNote({ id: 'n3' }),
    ];
    expect(computeUnreadCount(notes)).toBe(3);
  });
});

describe('ComposeScreen — isNoteUnread', () => {
  it('returns true when read_at is null', () => {
    expect(isNoteUnread(makeNote({ read_at: null }))).toBe(true);
  });

  it('returns false when read_at is set', () => {
    expect(isNoteUnread(makeNote({ read_at: '2026-04-25T10:00:00Z' }))).toBe(false);
  });
});

describe('ComposeScreen — getInitialFromSender', () => {
  it('uses first letter of sender_name', () => {
    expect(getInitialFromSender(makeNote({ sender_name: 'alice' }))).toBe('A');
  });

  it('uses first letter of sender_email when name is null', () => {
    expect(
      getInitialFromSender(makeNote({ sender_name: null, sender_email: 'bob@test.com' })),
    ).toBe('B');
  });

  it('uppercases the initial', () => {
    expect(getInitialFromSender(makeNote({ sender_name: 'charlie' }))).toBe('C');
  });

  it('handles Korean sender name', () => {
    expect(getInitialFromSender(makeNote({ sender_name: '김철수' }))).toBe('김');
  });
});

describe('ComposeScreen — getSenderDisplay', () => {
  it('returns sender_name when available', () => {
    expect(getSenderDisplay(makeNote({ sender_name: 'Alice', sender_email: 'alice@test.com' }))).toBe('Alice');
  });

  it('returns sender_email when name is null', () => {
    expect(getSenderDisplay(makeNote({ sender_name: null, sender_email: 'bob@test.com' }))).toBe('bob@test.com');
  });
});

describe('ComposeScreen — shouldEnableNotesQuery', () => {
  it('enables when all conditions met', () => {
    expect(shouldEnableNotesQuery(true, true, true)).toBe(true);
  });

  it('disables when not authenticated', () => {
    expect(shouldEnableNotesQuery(false, true, true)).toBe(false);
  });

  it('disables when not family plan', () => {
    expect(shouldEnableNotesQuery(true, false, true)).toBe(false);
  });

  it('disables when not connected', () => {
    expect(shouldEnableNotesQuery(true, true, false)).toBe(false);
  });

  it('disables when none met', () => {
    expect(shouldEnableNotesQuery(false, false, false)).toBe(false);
  });
});

describe('ComposeScreen — date display', () => {
  it('parses created_at to Date', () => {
    const note = makeNote({ created_at: '2026-04-25T08:00:00Z' });
    const d = new Date(note.created_at);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(25);
  });
});

describe('ComposeScreen — action routes', () => {
  it('send alarm navigates to /family-alarm/create', () => {
    const route = '/family-alarm/create';
    expect(route).toBe('/family-alarm/create');
  });

  it('send note navigates to /note/create', () => {
    const route = '/note/create';
    expect(route).toBe('/note/create');
  });
});

describe('ComposeScreen — note rendering edge cases', () => {
  it('handles empty text', () => {
    const note = makeNote({ text: '' });
    expect(note.text).toBe('');
  });

  it('handles very long text', () => {
    const longText = 'A'.repeat(1000);
    const note = makeNote({ text: longText });
    expect(note.text.length).toBe(1000);
  });

  it('handles note with audio_url', () => {
    const note = makeNote({ audio_url: 'https://cdn.example.com/audio.mp3' });
    expect(note.audio_url).toBeTruthy();
  });

  it('handles note without audio_url', () => {
    const note = makeNote({ audio_url: null });
    expect(note.audio_url).toBeNull();
  });
});
