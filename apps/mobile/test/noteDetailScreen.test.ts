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

function findNoteById(
  notes: ReceivedNote[] | undefined,
  id: string | undefined,
): ReceivedNote | undefined {
  if (!notes || !id) return undefined;
  return notes.find((n) => n.id === id);
}

function getSenderDisplay(note: ReceivedNote): string {
  return note.sender_name || note.sender_email;
}

function getSenderInitial(note: ReceivedNote): string {
  return getSenderDisplay(note).charAt(0).toUpperCase();
}

function shouldMarkAsRead(note: ReceivedNote | undefined): boolean {
  return !!note && !note.read_at;
}

function hasAudio(note: ReceivedNote): boolean {
  return !!note.audio_url;
}

function formatDateParts(dateStr: string): { date: Date; isValid: boolean } {
  const d = new Date(dateStr);
  return { date: d, isValid: !isNaN(d.getTime()) };
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

describe('NoteDetailScreen — findNoteById', () => {
  const notes = [
    makeNote({ id: 'n-1' }),
    makeNote({ id: 'n-2', sender_name: 'Bob' }),
    makeNote({ id: 'n-3', sender_name: 'Carol' }),
  ];

  it('finds note by id', () => {
    const result = findNoteById(notes, 'n-2');
    expect(result?.sender_name).toBe('Bob');
  });

  it('returns undefined for non-existent id', () => {
    expect(findNoteById(notes, 'n-999')).toBeUndefined();
  });

  it('returns undefined for undefined notes', () => {
    expect(findNoteById(undefined, 'n-1')).toBeUndefined();
  });

  it('returns undefined for undefined id', () => {
    expect(findNoteById(notes, undefined)).toBeUndefined();
  });

  it('returns undefined for empty notes array', () => {
    expect(findNoteById([], 'n-1')).toBeUndefined();
  });
});

describe('NoteDetailScreen — getSenderDisplay', () => {
  it('returns name when available', () => {
    expect(getSenderDisplay(makeNote({ sender_name: 'Alice' }))).toBe('Alice');
  });

  it('falls back to email when name is null', () => {
    expect(getSenderDisplay(makeNote({ sender_name: null, sender_email: 'bob@x.com' }))).toBe('bob@x.com');
  });

  it('returns email when name is empty string', () => {
    expect(getSenderDisplay(makeNote({ sender_name: '', sender_email: 'c@x.com' }))).toBe('c@x.com');
  });
});

describe('NoteDetailScreen — getSenderInitial', () => {
  it('uppercases first char of name', () => {
    expect(getSenderInitial(makeNote({ sender_name: 'alice' }))).toBe('A');
  });

  it('uppercases first char of email fallback', () => {
    expect(getSenderInitial(makeNote({ sender_name: null, sender_email: 'bob@x.com' }))).toBe('B');
  });

  it('handles Korean name', () => {
    expect(getSenderInitial(makeNote({ sender_name: '김철수' }))).toBe('김');
  });
});

describe('NoteDetailScreen — shouldMarkAsRead', () => {
  it('returns true for unread note', () => {
    expect(shouldMarkAsRead(makeNote({ read_at: null }))).toBe(true);
  });

  it('returns false for already-read note', () => {
    expect(shouldMarkAsRead(makeNote({ read_at: '2026-04-25T09:00:00Z' }))).toBe(false);
  });

  it('returns false for undefined note', () => {
    expect(shouldMarkAsRead(undefined)).toBe(false);
  });
});

describe('NoteDetailScreen — hasAudio', () => {
  it('returns true when audio_url exists', () => {
    expect(hasAudio(makeNote({ audio_url: 'https://example.com/audio.mp3' }))).toBe(true);
  });

  it('returns false when audio_url is null', () => {
    expect(hasAudio(makeNote({ audio_url: null }))).toBe(false);
  });

  it('returns false when audio_url is empty string', () => {
    expect(hasAudio(makeNote({ audio_url: '' }))).toBe(false);
  });
});

describe('NoteDetailScreen — formatDateParts', () => {
  it('parses valid ISO date', () => {
    const { date, isValid } = formatDateParts('2026-04-25T08:00:00Z');
    expect(isValid).toBe(true);
    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(3);
    expect(date.getUTCDate()).toBe(25);
  });

  it('detects invalid date string', () => {
    const { isValid } = formatDateParts('not-a-date');
    expect(isValid).toBe(false);
  });

  it('parses date-only string', () => {
    const { isValid } = formatDateParts('2026-04-25');
    expect(isValid).toBe(true);
  });
});

describe('NoteDetailScreen — empty state', () => {
  it('shows not found when note is undefined', () => {
    const note = findNoteById([], 'n-1');
    expect(note).toBeUndefined();
  });
});
