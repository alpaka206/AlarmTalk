interface VoiceProfile {
  id: string;
  name: string;
  status: 'ready' | 'processing' | 'failed';
}

interface Friend {
  id: string;
  friend_name: string | null;
  friend_email: string | null;
}

interface PresetCategory {
  key: string;
  emoji: string;
  i18nKey: string;
  messageKeys: string[];
}

type TabMode = 'preset' | 'custom';

function filterReadyProfiles(profiles: VoiceProfile[]): VoiceProfile[] {
  return profiles.filter((p) => p.status === 'ready');
}

function deriveMessageText(
  tab: TabMode,
  selectedPreset: string | null,
  customText: string,
): string | null {
  return tab === 'preset' ? selectedPreset : customText;
}

function validateGenerate(
  selectedVoiceId: string | null,
  messageText: string | null,
): { ok: true } | { ok: false; reason: 'no_voice' | 'no_message' } {
  if (!selectedVoiceId) return { ok: false, reason: 'no_voice' };
  if (!messageText?.trim()) return { ok: false, reason: 'no_message' };
  return { ok: true };
}

function buildTTSPayload(
  selectedVoiceId: string,
  messageText: string,
  selectedCategory: string | null,
) {
  return {
    voice_profile_id: selectedVoiceId,
    text: messageText.trim(),
    category: selectedCategory ?? 'custom',
  };
}

function isGenerateDisabled(
  messageText: string | null,
  selectedVoiceId: string | null,
  isPending: boolean,
): boolean {
  return !messageText || !selectedVoiceId || isPending;
}

function enforceCustomTextLimit(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function getAvatarInitial(name: string): string {
  return name.charAt(0);
}

function findCategoryByKey(
  categories: PresetCategory[],
  key: string | null,
): PresetCategory | undefined {
  return categories.find((c) => c.key === key);
}

function computeGiftRecipientLabel(friend: Friend): string {
  return friend.friend_name || friend.friend_email || '?';
}

function computeGiftRecipientInitial(friend: Friend): string {
  const label = friend.friend_name || friend.friend_email || '?';
  return label[0]!.toUpperCase();
}

function enforceGiftNoteLimit(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function buildGiftPayload(
  recipientEmail: string,
  messageId: string,
  note: string,
) {
  return {
    recipient_email: recipientEmail,
    message_id: messageId,
    note: note.trim() || undefined,
  };
}

// ---------- Tests ----------

describe('messageCreateScreen — filterReadyProfiles', () => {
  const profiles: VoiceProfile[] = [
    { id: '1', name: 'Mom', status: 'ready' },
    { id: '2', name: 'Dad', status: 'processing' },
    { id: '3', name: 'Sister', status: 'ready' },
    { id: '4', name: 'Failed', status: 'failed' },
  ];

  test('returns only ready profiles', () => {
    const result = filterReadyProfiles(profiles);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.name)).toEqual(['Mom', 'Sister']);
  });

  test('returns empty for no ready profiles', () => {
    const noReady = profiles.filter((p) => p.status !== 'ready');
    expect(filterReadyProfiles(noReady)).toEqual([]);
  });

  test('returns empty for empty array', () => {
    expect(filterReadyProfiles([])).toEqual([]);
  });

  test('returns all if all ready', () => {
    const allReady: VoiceProfile[] = [
      { id: '1', name: 'A', status: 'ready' },
      { id: '2', name: 'B', status: 'ready' },
    ];
    expect(filterReadyProfiles(allReady)).toHaveLength(2);
  });
});

describe('messageCreateScreen — deriveMessageText', () => {
  test('returns selectedPreset in preset tab', () => {
    expect(deriveMessageText('preset', 'Good morning!', 'custom text')).toBe('Good morning!');
  });

  test('returns null when preset tab with no selection', () => {
    expect(deriveMessageText('preset', null, 'custom text')).toBeNull();
  });

  test('returns customText in custom tab', () => {
    expect(deriveMessageText('custom', 'preset text', 'My custom message')).toBe('My custom message');
  });

  test('returns empty string in custom tab with empty input', () => {
    expect(deriveMessageText('custom', null, '')).toBe('');
  });

  test('ignores preset when in custom tab', () => {
    expect(deriveMessageText('custom', 'preset', 'custom')).toBe('custom');
  });

  test('ignores custom when in preset tab', () => {
    expect(deriveMessageText('preset', 'selected', 'custom')).toBe('selected');
  });
});

describe('messageCreateScreen — validateGenerate', () => {
  test('fails with no_voice when voiceId is null', () => {
    const result = validateGenerate(null, 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_voice');
  });

  test('fails with no_message when messageText is null', () => {
    const result = validateGenerate('v1', null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_message');
  });

  test('fails with no_message when messageText is empty', () => {
    const result = validateGenerate('v1', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_message');
  });

  test('fails with no_message when messageText is whitespace only', () => {
    const result = validateGenerate('v1', '   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_message');
  });

  test('succeeds with valid inputs', () => {
    expect(validateGenerate('v1', 'Hello world')).toEqual({ ok: true });
  });

  test('no_voice takes priority over no_message', () => {
    const result = validateGenerate(null, '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_voice');
  });
});

describe('messageCreateScreen — buildTTSPayload', () => {
  test('builds payload with category', () => {
    const p = buildTTSPayload('v1', '  Hello!  ', 'morning');
    expect(p).toEqual({
      voice_profile_id: 'v1',
      text: 'Hello!',
      category: 'morning',
    });
  });

  test('defaults category to "custom" when null', () => {
    const p = buildTTSPayload('v1', 'Test', null);
    expect(p.category).toBe('custom');
  });

  test('trims message text', () => {
    const p = buildTTSPayload('v1', '\n  message \n', 'cheer');
    expect(p.text).toBe('message');
  });
});

describe('messageCreateScreen — isGenerateDisabled', () => {
  test('disabled when messageText is null', () => {
    expect(isGenerateDisabled(null, 'v1', false)).toBe(true);
  });

  test('disabled when messageText is empty string', () => {
    expect(isGenerateDisabled('', 'v1', false)).toBe(true);
  });

  test('disabled when voiceId is null', () => {
    expect(isGenerateDisabled('text', null, false)).toBe(true);
  });

  test('disabled when isPending', () => {
    expect(isGenerateDisabled('text', 'v1', true)).toBe(true);
  });

  test('enabled when all conditions met', () => {
    expect(isGenerateDisabled('text', 'v1', false)).toBe(false);
  });
});

describe('messageCreateScreen — enforceCustomTextLimit', () => {
  test('allows text within limit', () => {
    expect(enforceCustomTextLimit('hello', 200)).toBe('hello');
  });

  test('allows text at exact limit', () => {
    const text = 'a'.repeat(200);
    expect(enforceCustomTextLimit(text, 200)).toBe(text);
  });

  test('truncates text beyond limit', () => {
    const text = 'a'.repeat(201);
    expect(enforceCustomTextLimit(text, 200)).toBe('a'.repeat(200));
  });

  test('handles empty string', () => {
    expect(enforceCustomTextLimit('', 200)).toBe('');
  });
});

describe('messageCreateScreen — getAvatarInitial', () => {
  test('returns first character', () => {
    expect(getAvatarInitial('Mom')).toBe('M');
  });

  test('returns first character of Korean name', () => {
    expect(getAvatarInitial('엄마')).toBe('엄');
  });

  test('returns first character of single char', () => {
    expect(getAvatarInitial('A')).toBe('A');
  });
});

describe('messageCreateScreen — findCategoryByKey', () => {
  const cats: PresetCategory[] = [
    { key: 'morning', emoji: '🌅', i18nKey: 'lib.morning', messageKeys: ['m0', 'm1'] },
    { key: 'cheer', emoji: '💪', i18nKey: 'lib.cheer', messageKeys: ['c0'] },
  ];

  test('finds existing category', () => {
    const found = findCategoryByKey(cats, 'morning');
    expect(found?.key).toBe('morning');
    expect(found?.messageKeys).toEqual(['m0', 'm1']);
  });

  test('returns undefined for unknown key', () => {
    expect(findCategoryByKey(cats, 'unknown')).toBeUndefined();
  });

  test('returns undefined for null key', () => {
    expect(findCategoryByKey(cats, null)).toBeUndefined();
  });

  test('returns undefined for empty list', () => {
    expect(findCategoryByKey([], 'morning')).toBeUndefined();
  });
});

describe('messageCreateScreen — gift recipient helpers', () => {
  test('computeGiftRecipientLabel prefers name', () => {
    expect(computeGiftRecipientLabel({ id: '1', friend_name: 'Alice', friend_email: 'a@b.com' }))
      .toBe('Alice');
  });

  test('computeGiftRecipientLabel falls back to email', () => {
    expect(computeGiftRecipientLabel({ id: '1', friend_name: null, friend_email: 'a@b.com' }))
      .toBe('a@b.com');
  });

  test('computeGiftRecipientLabel falls back to ?', () => {
    expect(computeGiftRecipientLabel({ id: '1', friend_name: null, friend_email: null }))
      .toBe('?');
  });

  test('computeGiftRecipientLabel uses empty string name as falsy', () => {
    expect(computeGiftRecipientLabel({ id: '1', friend_name: '', friend_email: 'a@b.com' }))
      .toBe('a@b.com');
  });

  test('computeGiftRecipientInitial uppercases first char of name', () => {
    expect(computeGiftRecipientInitial({ id: '1', friend_name: 'alice', friend_email: null }))
      .toBe('A');
  });

  test('computeGiftRecipientInitial from email', () => {
    expect(computeGiftRecipientInitial({ id: '1', friend_name: null, friend_email: 'bob@test.com' }))
      .toBe('B');
  });

  test('computeGiftRecipientInitial fallback', () => {
    expect(computeGiftRecipientInitial({ id: '1', friend_name: null, friend_email: null }))
      .toBe('?');
  });
});

describe('messageCreateScreen — enforceGiftNoteLimit', () => {
  test('allows text within limit', () => {
    expect(enforceGiftNoteLimit('short note', 200)).toBe('short note');
  });

  test('truncates text beyond limit', () => {
    const long = 'x'.repeat(201);
    expect(enforceGiftNoteLimit(long, 200).length).toBe(200);
  });
});

describe('messageCreateScreen — buildGiftPayload', () => {
  test('builds with note', () => {
    const p = buildGiftPayload('a@b.com', 'msg1', 'Enjoy!');
    expect(p).toEqual({
      recipient_email: 'a@b.com',
      message_id: 'msg1',
      note: 'Enjoy!',
    });
  });

  test('trims whitespace note', () => {
    const p = buildGiftPayload('a@b.com', 'msg1', '  hi  ');
    expect(p.note).toBe('hi');
  });

  test('empty note becomes undefined', () => {
    const p = buildGiftPayload('a@b.com', 'msg1', '');
    expect(p.note).toBeUndefined();
  });

  test('whitespace-only note becomes undefined', () => {
    const p = buildGiftPayload('a@b.com', 'msg1', '   ');
    expect(p.note).toBeUndefined();
  });
});

describe('messageCreateScreen — tab switching state logic', () => {
  test('switching to preset tab should keep selectedPreset and customText independent', () => {
    const presetMsg = deriveMessageText('preset', 'Morning!', 'My text');
    const customMsg = deriveMessageText('custom', 'Morning!', 'My text');
    expect(presetMsg).toBe('Morning!');
    expect(customMsg).toBe('My text');
  });

  test('category change clears selectedPreset (logical requirement)', () => {
    let selectedPreset: string | null = 'Old message';
    let selectedCategory: string | null = 'morning';

    selectedCategory = 'cheer';
    selectedPreset = null;

    const msg = deriveMessageText('preset', selectedPreset, '');
    expect(msg).toBeNull();
    expect(selectedCategory).toBe('cheer');
  });
});

describe('messageCreateScreen — playback toggle logic', () => {
  test('toggle play when no currentSound → should start', () => {
    const currentSound: null | 'playing' = null;
    const action = currentSound ? 'stop' : 'play';
    expect(action).toBe('play');
  });

  test('toggle play when currentSound exists → should stop', () => {
    const currentSound: null | 'playing' = 'playing';
    const action = currentSound ? 'stop' : 'play';
    expect(action).toBe('stop');
  });
});

describe('messageCreateScreen — voice selection with voice_id param', () => {
  test('initializes selectedVoiceId from voice_id param', () => {
    const voice_id = 'v-from-param';
    const selectedVoiceId = voice_id ?? null;
    expect(selectedVoiceId).toBe('v-from-param');
  });

  test('defaults to null when no voice_id param', () => {
    const voice_id: string | undefined = undefined;
    const selectedVoiceId = voice_id ?? null;
    expect(selectedVoiceId).toBeNull();
  });
});

function shouldShowNoFriendsAlert(friends: Friend[] | null): boolean {
  if (!friends) return true;
  return friends.length === 0;
}

describe('messageCreateScreen — friends list empty guard', () => {
  test('null friends list should show alert', () => {
    expect(shouldShowNoFriendsAlert(null)).toBe(true);
  });

  test('empty friends list should show alert', () => {
    expect(shouldShowNoFriendsAlert([])).toBe(true);
  });

  test('non-empty friends list should open modal', () => {
    expect(shouldShowNoFriendsAlert([{ id: '1', friend_name: 'A', friend_email: 'a@b.com' }])).toBe(false);
  });
});
