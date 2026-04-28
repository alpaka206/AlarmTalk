const store: Record<string, string> = {};

jest.mock('../src/services/notifications', () => ({
  unregisterPushTokenFromServer: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn((key: string, value: string) => {
    store[key] = value;
    return Promise.resolve();
  }),
  getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
  removeItem: jest.fn((key: string) => {
    delete store[key];
    return Promise.resolve();
  }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../src/stores/useAppStore';
import type { VoiceProfile } from '../src/stores/useAppStore';

const initialState = {
  isAuthenticated: false,
  firebaseToken: null,
  userId: null,
  plan: 'free' as const,
  dailyTtsCount: 0,
  voiceProfiles: [],
  isPlaying: false,
  currentPlayingId: null,
  hasCompletedOnboarding: false,
  stateLoaded: false,
  defaultSnoozeMinutes: 5,
  darkMode: false,
};

const makeVoice = (id: string, name = '테스트 음성'): VoiceProfile => ({
  id,
  name,
  perso_voice_id: null,
  elevenlabs_voice_id: null,
  avatar_url: null,
  status: 'ready',
  created_at: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  jest.clearAllMocks();
  useAppStore.setState(initialState);
});

describe('useAppStore — 초기 상태', () => {
  it('기본값이 올바르다', () => {
    const s = useAppStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.firebaseToken).toBeNull();
    expect(s.userId).toBeNull();
    expect(s.plan).toBe('free');
    expect(s.dailyTtsCount).toBe(0);
    expect(s.voiceProfiles).toEqual([]);
    expect(s.isPlaying).toBe(false);
    expect(s.currentPlayingId).toBeNull();
    expect(s.hasCompletedOnboarding).toBe(false);
    expect(s.stateLoaded).toBe(false);
    expect(s.defaultSnoozeMinutes).toBe(5);
    expect(s.darkMode).toBe(false);
  });
});

describe('useAppStore — setAuth', () => {
  it('토큰과 userId를 설정한다', async () => {
    await useAppStore.getState().setAuth('tok-123', 'user-1');
    const s = useAppStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.firebaseToken).toBe('tok-123');
    expect(s.userId).toBe('user-1');
  });

  it('AsyncStorage에 저장한다', async () => {
    await useAppStore.getState().setAuth('tok-abc', 'user-2');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('auth_token', 'tok-abc');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('user_id', 'user-2');
    expect(store['auth_token']).toBe('tok-abc');
    expect(store['user_id']).toBe('user-2');
  });

  it('두 번 호출 시 마지막 값 유지', async () => {
    await useAppStore.getState().setAuth('tok-1', 'u1');
    await useAppStore.getState().setAuth('tok-2', 'u2');
    const s = useAppStore.getState();
    expect(s.firebaseToken).toBe('tok-2');
    expect(s.userId).toBe('u2');
  });
});

describe('useAppStore — clearAuth', () => {
  it('인증 상태를 초기화한다', async () => {
    await useAppStore.getState().setAuth('tok', 'uid');
    await useAppStore.getState().clearAuth();
    const s = useAppStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.firebaseToken).toBeNull();
    expect(s.userId).toBeNull();
  });

  it('AsyncStorage에서 제거한다', async () => {
    await useAppStore.getState().setAuth('tok', 'uid');
    await useAppStore.getState().clearAuth();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('auth_token');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('user_id');
    expect(store['auth_token']).toBeUndefined();
    expect(store['user_id']).toBeUndefined();
  });
});

describe('useAppStore — setPlan', () => {
  it('플랜을 변경한다', () => {
    useAppStore.getState().setPlan('family');
    expect(useAppStore.getState().plan).toBe('family');
  });

  it.each(['free', 'plus', 'family'] as const)('플랜 %s 설정', (plan) => {
    useAppStore.getState().setPlan(plan);
    expect(useAppStore.getState().plan).toBe(plan);
  });
});

describe('useAppStore — voiceProfiles', () => {
  it('setVoiceProfiles로 전체 교체', () => {
    const profiles = [makeVoice('v1'), makeVoice('v2')];
    useAppStore.getState().setVoiceProfiles(profiles);
    expect(useAppStore.getState().voiceProfiles).toEqual(profiles);
  });

  it('addVoiceProfile은 배열 앞에 추가', () => {
    useAppStore.getState().setVoiceProfiles([makeVoice('v1')]);
    useAppStore.getState().addVoiceProfile(makeVoice('v2', '새 음성'));
    const profiles = useAppStore.getState().voiceProfiles;
    expect(profiles).toHaveLength(2);
    expect(profiles[0]!.id).toBe('v2');
    expect(profiles[1]!.id).toBe('v1');
  });

  it('removeVoiceProfile은 해당 ID만 제거', () => {
    useAppStore.getState().setVoiceProfiles([makeVoice('v1'), makeVoice('v2'), makeVoice('v3')]);
    useAppStore.getState().removeVoiceProfile('v2');
    const ids = useAppStore.getState().voiceProfiles.map((p) => p.id);
    expect(ids).toEqual(['v1', 'v3']);
  });

  it('존재하지 않는 ID 제거 시 변경 없음', () => {
    useAppStore.getState().setVoiceProfiles([makeVoice('v1')]);
    useAppStore.getState().removeVoiceProfile('nonexistent');
    expect(useAppStore.getState().voiceProfiles).toHaveLength(1);
  });

  it('빈 배열에서 제거 시도 시 빈 배열 유지', () => {
    useAppStore.getState().removeVoiceProfile('v1');
    expect(useAppStore.getState().voiceProfiles).toEqual([]);
  });
});

describe('useAppStore — setPlaying', () => {
  it('ID 설정 시 isPlaying=true', () => {
    useAppStore.getState().setPlaying('msg-1');
    const s = useAppStore.getState();
    expect(s.isPlaying).toBe(true);
    expect(s.currentPlayingId).toBe('msg-1');
  });

  it('null 설정 시 isPlaying=false', () => {
    useAppStore.getState().setPlaying('msg-1');
    useAppStore.getState().setPlaying(null);
    const s = useAppStore.getState();
    expect(s.isPlaying).toBe(false);
    expect(s.currentPlayingId).toBeNull();
  });
});

describe('useAppStore — completeOnboarding', () => {
  it('온보딩 완료 플래그를 설정한다', async () => {
    await useAppStore.getState().completeOnboarding();
    expect(useAppStore.getState().hasCompletedOnboarding).toBe(true);
  });

  it('AsyncStorage에 저장한다', async () => {
    await useAppStore.getState().completeOnboarding();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('onboarding_complete', 'true');
    expect(store['onboarding_complete']).toBe('true');
  });
});

describe('useAppStore — incrementTtsCount', () => {
  it('1씩 증가한다', () => {
    useAppStore.getState().incrementTtsCount();
    expect(useAppStore.getState().dailyTtsCount).toBe(1);
  });

  it('여러 번 호출 시 누적', () => {
    useAppStore.getState().incrementTtsCount();
    useAppStore.getState().incrementTtsCount();
    useAppStore.getState().incrementTtsCount();
    expect(useAppStore.getState().dailyTtsCount).toBe(3);
  });
});

describe('useAppStore — setDefaultSnoozeMinutes', () => {
  it('스누즈 분을 변경한다', async () => {
    await useAppStore.getState().setDefaultSnoozeMinutes(10);
    expect(useAppStore.getState().defaultSnoozeMinutes).toBe(10);
  });

  it('AsyncStorage에 문자열로 저장', async () => {
    await useAppStore.getState().setDefaultSnoozeMinutes(15);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('default_snooze_minutes', '15');
    expect(store['default_snooze_minutes']).toBe('15');
  });
});

describe('useAppStore — setDarkMode', () => {
  it('다크모드 활성화', async () => {
    await useAppStore.getState().setDarkMode(true);
    expect(useAppStore.getState().darkMode).toBe(true);
  });

  it('다크모드 비활성화', async () => {
    await useAppStore.getState().setDarkMode(true);
    await useAppStore.getState().setDarkMode(false);
    expect(useAppStore.getState().darkMode).toBe(false);
  });

  it('AsyncStorage에 true/false 문자열로 저장', async () => {
    await useAppStore.getState().setDarkMode(true);
    expect(store['dark_mode']).toBe('true');
    await useAppStore.getState().setDarkMode(false);
    expect(store['dark_mode']).toBe('false');
  });
});

describe('useAppStore — loadPersistedState', () => {
  it('저장된 상태를 복원한다', async () => {
    store['auth_token'] = 'saved-tok';
    store['user_id'] = 'saved-uid';
    store['onboarding_complete'] = 'true';
    store['default_snooze_minutes'] = '10';
    store['dark_mode'] = 'true';

    await useAppStore.getState().loadPersistedState();
    const s = useAppStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.firebaseToken).toBe('saved-tok');
    expect(s.userId).toBe('saved-uid');
    expect(s.hasCompletedOnboarding).toBe(true);
    expect(s.defaultSnoozeMinutes).toBe(10);
    expect(s.darkMode).toBe(true);
    expect(s.stateLoaded).toBe(true);
  });

  it('저장된 값이 없으면 기본값 사용', async () => {
    await useAppStore.getState().loadPersistedState();
    const s = useAppStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.firebaseToken).toBeNull();
    expect(s.userId).toBeNull();
    expect(s.hasCompletedOnboarding).toBe(false);
    expect(s.defaultSnoozeMinutes).toBe(5);
    expect(s.darkMode).toBe(false);
    expect(s.stateLoaded).toBe(true);
  });

  it('토큰만 있고 userId 없으면 인증 상태', async () => {
    store['auth_token'] = 'tok-only';
    await useAppStore.getState().loadPersistedState();
    const s = useAppStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.firebaseToken).toBe('tok-only');
    expect(s.userId).toBeNull();
  });

  it('onboarding false/미존재는 미완료', async () => {
    store['onboarding_complete'] = 'false';
    await useAppStore.getState().loadPersistedState();
    expect(useAppStore.getState().hasCompletedOnboarding).toBe(false);
  });

  it('snooze_minutes 비정상 값은 NaN → 기본값 5 사용', async () => {
    store['default_snooze_minutes'] = 'abc';
    await useAppStore.getState().loadPersistedState();
    expect(useAppStore.getState().defaultSnoozeMinutes).toBe(NaN);
  });

  it('dark_mode 값이 true가 아닌 문자열이면 false', async () => {
    store['dark_mode'] = 'yes';
    await useAppStore.getState().loadPersistedState();
    expect(useAppStore.getState().darkMode).toBe(false);
  });
});
