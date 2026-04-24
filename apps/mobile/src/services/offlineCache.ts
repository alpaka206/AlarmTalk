import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Alarm, Message, LibraryItem, VoiceProfile } from '../types';

const KEYS = {
  alarms: 'offline_cache_alarms',
  messages: 'offline_cache_messages',
  library: 'offline_cache_library',
  voices: 'offline_cache_voices',
  recentPresets: 'recent_preset_messages',
} as const;

const MAX_RECENT_PRESETS = 5;

export async function cacheAlarms(alarms: Alarm[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.alarms, JSON.stringify(alarms));
}

export async function getCachedAlarms(): Promise<Alarm[] | null> {
  const raw = await AsyncStorage.getItem(KEYS.alarms);
  if (!raw) return null;
  return JSON.parse(raw) as Alarm[];
}

export async function cacheMessages(messages: Message[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.messages, JSON.stringify(messages));
}

export async function getCachedMessages(): Promise<Message[] | null> {
  const raw = await AsyncStorage.getItem(KEYS.messages);
  if (!raw) return null;
  return JSON.parse(raw) as Message[];
}

export async function cacheLibrary(items: LibraryItem[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.library, JSON.stringify(items));
}

export async function getCachedLibrary(): Promise<LibraryItem[] | null> {
  const raw = await AsyncStorage.getItem(KEYS.library);
  if (!raw) return null;
  return JSON.parse(raw) as LibraryItem[];
}

export async function cacheVoices(voices: VoiceProfile[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.voices, JSON.stringify(voices));
}

export async function getCachedVoices(): Promise<VoiceProfile[] | null> {
  const raw = await AsyncStorage.getItem(KEYS.voices);
  if (!raw) return null;
  return JSON.parse(raw) as VoiceProfile[];
}

export async function getRecentPresetMessages(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEYS.recentPresets);
  if (!raw) return [];
  return JSON.parse(raw) as string[];
}

export async function addRecentPresetMessage(text: string): Promise<void> {
  const existing = await getRecentPresetMessages();
  const deduped = [text, ...existing.filter((m) => m !== text)].slice(0, MAX_RECENT_PRESETS);
  await AsyncStorage.setItem(KEYS.recentPresets, JSON.stringify(deduped));
}
