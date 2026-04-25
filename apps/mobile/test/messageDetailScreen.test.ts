interface Message {
  id: string;
  text: string;
  category: string;
  voice_name: string | null;
  voice_profile_id: string | null;
  audio_url: string | null;
  created_at: string;
  is_favorite: boolean;
}

function findMessageById(
  messages: Message[] | undefined,
  id: string | undefined,
): Message | undefined {
  if (!messages || !id) return undefined;
  return messages.find((m) => m.id === id);
}

function hasVoice(message: Message): boolean {
  return !!message.voice_name;
}

function getVoiceInitial(message: Message): string {
  return message.voice_name ? message.voice_name.charAt(0) : '';
}

function getCategoryDisplay(category: string): string {
  return category.toUpperCase();
}

function shouldShowPlayButton(cached: boolean | null): boolean {
  return cached === true;
}

function shouldShowTranslateButton(cached: boolean | null): boolean {
  return cached === true;
}

function buildAlarmRoute(messageId: string): string {
  return `/alarm/create?message_id=${messageId}`;
}

function buildTranslateRoute(messageId: string): string {
  return `/dub/translate?message_id=${messageId}`;
}

function buildCreateAnotherRoute(voiceProfileId: string | null): string {
  return `/message/create?voice_id=${voiceProfileId ?? ''}`;
}

function buildVoiceDetailRoute(voiceProfileId: string | null): string {
  return `/voice/${voiceProfileId ?? ''}`;
}

function getPlaybackLabel(isPlaying: boolean, playLabel: string, stopLabel: string): string {
  return isPlaying ? stopLabel : playLabel;
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    text: 'Hello world',
    category: 'encouragement',
    voice_name: 'Alice',
    voice_profile_id: 'vp-1',
    audio_url: 'https://example.com/audio.mp3',
    created_at: '2026-04-25T08:00:00Z',
    is_favorite: false,
    ...overrides,
  };
}

describe('MessageDetailScreen — findMessageById', () => {
  const messages = [
    makeMessage({ id: 'msg-1' }),
    makeMessage({ id: 'msg-2', text: 'Second' }),
    makeMessage({ id: 'msg-3', text: 'Third' }),
  ];

  it('finds message by id', () => {
    const result = findMessageById(messages, 'msg-2');
    expect(result?.text).toBe('Second');
  });

  it('returns undefined for non-existent id', () => {
    expect(findMessageById(messages, 'msg-999')).toBeUndefined();
  });

  it('returns undefined for undefined messages', () => {
    expect(findMessageById(undefined, 'msg-1')).toBeUndefined();
  });

  it('returns undefined for undefined id', () => {
    expect(findMessageById(messages, undefined)).toBeUndefined();
  });

  it('returns undefined for empty messages', () => {
    expect(findMessageById([], 'msg-1')).toBeUndefined();
  });
});

describe('MessageDetailScreen — hasVoice', () => {
  it('returns true when voice_name exists', () => {
    expect(hasVoice(makeMessage({ voice_name: 'Alice' }))).toBe(true);
  });

  it('returns false when voice_name is null', () => {
    expect(hasVoice(makeMessage({ voice_name: null }))).toBe(false);
  });

  it('returns false when voice_name is empty string', () => {
    expect(hasVoice(makeMessage({ voice_name: '' }))).toBe(false);
  });
});

describe('MessageDetailScreen — getVoiceInitial', () => {
  it('returns first char of voice name', () => {
    expect(getVoiceInitial(makeMessage({ voice_name: 'Alice' }))).toBe('A');
  });

  it('returns empty string when no voice', () => {
    expect(getVoiceInitial(makeMessage({ voice_name: null }))).toBe('');
  });

  it('handles Korean voice name', () => {
    expect(getVoiceInitial(makeMessage({ voice_name: '엄마' }))).toBe('엄');
  });
});

describe('MessageDetailScreen — getCategoryDisplay', () => {
  it('uppercases category', () => {
    expect(getCategoryDisplay('encouragement')).toBe('ENCOURAGEMENT');
  });

  it('handles already uppercase', () => {
    expect(getCategoryDisplay('ALARM')).toBe('ALARM');
  });

  it('handles mixed case', () => {
    expect(getCategoryDisplay('Morning Greet')).toBe('MORNING GREET');
  });
});

describe('MessageDetailScreen — cache-dependent buttons', () => {
  it('shows play button when cached is true', () => {
    expect(shouldShowPlayButton(true)).toBe(true);
  });

  it('hides play button when cached is false', () => {
    expect(shouldShowPlayButton(false)).toBe(false);
  });

  it('hides play button when cached is null (loading)', () => {
    expect(shouldShowPlayButton(null)).toBe(false);
  });

  it('shows translate button when cached is true', () => {
    expect(shouldShowTranslateButton(true)).toBe(true);
  });

  it('hides translate button when cached is false', () => {
    expect(shouldShowTranslateButton(false)).toBe(false);
  });
});

describe('MessageDetailScreen — route builders', () => {
  it('builds alarm create route', () => {
    expect(buildAlarmRoute('msg-1')).toBe('/alarm/create?message_id=msg-1');
  });

  it('builds translate route', () => {
    expect(buildTranslateRoute('msg-1')).toBe('/dub/translate?message_id=msg-1');
  });

  it('builds create another route with voice id', () => {
    expect(buildCreateAnotherRoute('vp-1')).toBe('/message/create?voice_id=vp-1');
  });

  it('builds create another route with null voice id', () => {
    expect(buildCreateAnotherRoute(null)).toBe('/message/create?voice_id=');
  });

  it('builds voice detail route', () => {
    expect(buildVoiceDetailRoute('vp-1')).toBe('/voice/vp-1');
  });

  it('builds voice detail route with null id', () => {
    expect(buildVoiceDetailRoute(null)).toBe('/voice/');
  });
});

describe('MessageDetailScreen — getPlaybackLabel', () => {
  it('returns stop label when playing', () => {
    expect(getPlaybackLabel(true, '재생', '정지')).toBe('정지');
  });

  it('returns play label when not playing', () => {
    expect(getPlaybackLabel(false, '재생', '정지')).toBe('재생');
  });
});

describe('MessageDetailScreen — empty state', () => {
  it('renders not found when message is undefined', () => {
    const message = findMessageById([], 'nonexistent');
    expect(message).toBeUndefined();
  });
});
