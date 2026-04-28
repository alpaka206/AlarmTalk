const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn((key: string, value: string) => {
    store[key] = value;
    return Promise.resolve();
  }),
  getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
}));

import {
  cacheAlarms,
  getCachedAlarms,
  cacheMessages,
  getCachedMessages,
  cacheLibrary,
  getCachedLibrary,
  cacheVoices,
  getCachedVoices,
} from '../src/services/offlineCache';
import type { Alarm, Message, LibraryItem, VoiceProfile } from '../src/types';

const alarm: Alarm = {
  id: 'a1',
  user_id: 'u1',
  target_user_id: null,
  message_id: 'm1',
  time: '07:30',
  repeat_days: [1, 2, 3],
  is_active: true,
  snooze_minutes: 5,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const message: Message = {
  id: 'm1',
  user_id: 'u1',
  voice_profile_id: 'v1',
  text: '좋은 아침!',
  audio_url: 'https://example.com/a.mp3',
  category: 'morning',
  is_preset: false,
  created_at: '2026-01-01T00:00:00Z',
};

const libraryItem: LibraryItem = {
  id: 'l1',
  user_id: 'u1',
  message_id: 'm1',
  text: '힘내!',
  category: 'cheer',
  is_favorite: true,
  received_at: '2026-01-01T00:00:00Z',
};

const voice: VoiceProfile = {
  id: 'v1',
  user_id: 'u1',
  name: '엄마 목소리',
  perso_voice_id: 'perso-1',
  elevenlabs_voice_id: null,
  avatar_url: null,
  status: 'ready',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  jest.clearAllMocks();
});

describe('offlineCache — alarms', () => {
  it('캐시 없을 때 null 반환', async () => {
    expect(await getCachedAlarms()).toBeNull();
  });

  it('저장 후 복원', async () => {
    await cacheAlarms([alarm]);
    const result = await getCachedAlarms();
    expect(result).toEqual([alarm]);
  });

  it('빈 배열 저장/복원', async () => {
    await cacheAlarms([]);
    expect(await getCachedAlarms()).toEqual([]);
  });

  it('여러 알람 저장', async () => {
    const alarms = [alarm, { ...alarm, id: 'a2', time: '08:00' }];
    await cacheAlarms(alarms);
    expect(await getCachedAlarms()).toEqual(alarms);
  });
});

describe('offlineCache — messages', () => {
  it('캐시 없을 때 null 반환', async () => {
    expect(await getCachedMessages()).toBeNull();
  });

  it('저장 후 복원', async () => {
    await cacheMessages([message]);
    expect(await getCachedMessages()).toEqual([message]);
  });

  it('빈 배열 저장/복원', async () => {
    await cacheMessages([]);
    expect(await getCachedMessages()).toEqual([]);
  });
});

describe('offlineCache — library', () => {
  it('캐시 없을 때 null 반환', async () => {
    expect(await getCachedLibrary()).toBeNull();
  });

  it('저장 후 복원', async () => {
    await cacheLibrary([libraryItem]);
    expect(await getCachedLibrary()).toEqual([libraryItem]);
  });

  it('즐겨찾기 포함 복원', async () => {
    const items = [libraryItem, { ...libraryItem, id: 'l2', is_favorite: false }];
    await cacheLibrary(items);
    const result = await getCachedLibrary();
    expect(result).toHaveLength(2);
    expect(result![0]!.is_favorite).toBe(true);
    expect(result![1]!.is_favorite).toBe(false);
  });
});

describe('offlineCache — voices', () => {
  it('캐시 없을 때 null 반환', async () => {
    expect(await getCachedVoices()).toBeNull();
  });

  it('저장 후 복원', async () => {
    await cacheVoices([voice]);
    expect(await getCachedVoices()).toEqual([voice]);
  });

  it('여러 보이스 프로필 저장', async () => {
    const voices = [voice, { ...voice, id: 'v2', name: '아빠 목소리', status: 'processing' as const }];
    await cacheVoices(voices);
    expect(await getCachedVoices()).toEqual(voices);
  });
});

describe('offlineCache — 격리', () => {
  it('서로 다른 캐시 키가 간섭하지 않는다', async () => {
    await cacheAlarms([alarm]);
    await cacheMessages([message]);
    expect(await getCachedAlarms()).toEqual([alarm]);
    expect(await getCachedMessages()).toEqual([message]);
    expect(await getCachedLibrary()).toBeNull();
    expect(await getCachedVoices()).toBeNull();
  });

  it('덮어쓰기: 같은 키에 두 번 저장 시 마지막 값만 유지', async () => {
    await cacheAlarms([alarm]);
    const updated = { ...alarm, time: '09:00' };
    await cacheAlarms([updated]);
    expect(await getCachedAlarms()).toEqual([updated]);
  });
});
