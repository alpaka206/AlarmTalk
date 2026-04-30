import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface VoiceProfile {
  id: string;
  name: string;
  perso_voice_id: string | null;
  elevenlabs_voice_id: string | null;
  avatar_url: string | null;
  status: 'processing' | 'ready' | 'failed';
  created_at: string;
}

export interface Message {
  id: string;
  voice_profile_id: string;
  voice_name: string;
  text: string;
  audio_local_path: string | null;
  category: string;
  created_at: string;
}

export interface AlarmItem {
  id: string;
  message_id: string;
  message_text: string;
  voice_name: string;
  category: string;
  time: string;
  repeat_days: number[];
  is_active: boolean;
  snooze_minutes: number;
}

export interface LibraryItem {
  id: string;
  message_id: string;
  text: string;
  category: string;
  voice_name: string;
  avatar_url: string | null;
  is_favorite: boolean;
  received_at: string;
}

interface AppState {
  // Auth
  isAuthenticated: boolean;
  firebaseToken: string | null;
  userId: string | null;

  // User
  plan: 'free' | 'plus' | 'family';
  dailyTtsCount: number;

  // Voice profiles
  voiceProfiles: VoiceProfile[];

  // Current playback
  isPlaying: boolean;
  currentPlayingId: string | null;

  // Onboarding
  hasCompletedOnboarding: boolean;
  stateLoaded: boolean;

  // Preferences
  defaultSnoozeMinutes: number;
  darkMode: boolean;
  alarmNotifications: boolean;
  messageNotifications: boolean;

  // Actions
  setAuth: (token: string, userId: string) => void;
  clearAuth: () => void;
  setPlan: (plan: 'free' | 'plus' | 'family') => void;
  setVoiceProfiles: (profiles: VoiceProfile[]) => void;
  addVoiceProfile: (profile: VoiceProfile) => void;
  removeVoiceProfile: (id: string) => void;
  setPlaying: (id: string | null) => void;
  completeOnboarding: () => void;
  incrementTtsCount: () => void;
  setDefaultSnoozeMinutes: (minutes: number) => void;
  setDarkMode: (enabled: boolean) => void;
  setAlarmNotifications: (enabled: boolean) => void;
  setMessageNotifications: (enabled: boolean) => void;
  loadPersistedState: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, _get) => ({
  isAuthenticated: false,
  firebaseToken: null,
  userId: null,
  plan: 'free',
  dailyTtsCount: 0,
  voiceProfiles: [],
  isPlaying: false,
  currentPlayingId: null,
  hasCompletedOnboarding: false,
  stateLoaded: false,
  defaultSnoozeMinutes: 5,
  darkMode: false,
  alarmNotifications: true,
  messageNotifications: true,

  setAuth: async (token, userId) => {
    await AsyncStorage.setItem('auth_token', token);
    await AsyncStorage.setItem('user_id', userId);
    set({ isAuthenticated: true, firebaseToken: token, userId });
  },

  clearAuth: async () => {
    await AsyncStorage.removeItem('auth_token');
    await AsyncStorage.removeItem('user_id');
    set({ isAuthenticated: false, firebaseToken: null, userId: null });
  },

  setPlan: (plan) => set({ plan }),

  setVoiceProfiles: (profiles) => set({ voiceProfiles: profiles }),

  addVoiceProfile: (profile) =>
    set((state) => ({ voiceProfiles: [profile, ...state.voiceProfiles] })),

  removeVoiceProfile: (id) =>
    set((state) => ({
      voiceProfiles: state.voiceProfiles.filter((p) => p.id !== id),
    })),

  setPlaying: (id) => set({ isPlaying: id !== null, currentPlayingId: id }),

  completeOnboarding: async () => {
    await AsyncStorage.setItem('onboarding_complete', 'true');
    set({ hasCompletedOnboarding: true });
  },

  incrementTtsCount: () => set((state) => ({ dailyTtsCount: state.dailyTtsCount + 1 })),

  setDefaultSnoozeMinutes: async (minutes) => {
    await AsyncStorage.setItem('default_snooze_minutes', String(minutes));
    set({ defaultSnoozeMinutes: minutes });
  },

  setDarkMode: async (enabled) => {
    await AsyncStorage.setItem('dark_mode', enabled ? 'true' : 'false');
    set({ darkMode: enabled });
  },

  setAlarmNotifications: async (enabled) => {
    await AsyncStorage.setItem('alarm_notifications', enabled ? 'true' : 'false');
    set({ alarmNotifications: enabled });
  },

  setMessageNotifications: async (enabled) => {
    await AsyncStorage.setItem('message_notifications', enabled ? 'true' : 'false');
    set({ messageNotifications: enabled });
  },

  loadPersistedState: async () => {
    const token = await AsyncStorage.getItem('auth_token');
    const userId = await AsyncStorage.getItem('user_id');
    const onboarding = await AsyncStorage.getItem('onboarding_complete');
    const snooze = await AsyncStorage.getItem('default_snooze_minutes');
    const dark = await AsyncStorage.getItem('dark_mode');
    const alarmNotif = await AsyncStorage.getItem('alarm_notifications');
    const msgNotif = await AsyncStorage.getItem('message_notifications');

    set({
      firebaseToken: token,
      userId: userId,
      isAuthenticated: !!token,
      hasCompletedOnboarding: onboarding === 'true',
      defaultSnoozeMinutes: snooze ? parseInt(snooze, 10) : 5,
      darkMode: dark === 'true',
      alarmNotifications: alarmNotif !== 'false',
      messageNotifications: msgNotif !== 'false',
      stateLoaded: true,
    });
  },
}));
