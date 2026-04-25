import type { LibraryItem } from '../../types';
import { get, patch, del } from './core';

// ===== User API =====

export async function getUserProfile() {
  return get<{ id: string; email: string; name: string; plan: string }>('/user/me');
}

export async function updatePlan(plan: 'free' | 'plus' | 'family') {
  return patch<{ plan: string }>('/user/plan', { plan });
}

export async function deleteAccount() {
  return del<{ success: boolean }>('/user/me');
}

// ===== Stats API =====

export interface WeekTrend {
  thisWeek: number;
  lastWeek: number;
}

export interface Stats {
  alarms: { total: number; active: number };
  messages: { total: number };
  voices: { total: number };
  friends: { total: number };
  gifts: { received: number; receivedPending: number; sent: number };
  trends: {
    alarms: WeekTrend;
    messages: WeekTrend;
    voices: WeekTrend;
    friends: WeekTrend;
    gifts: WeekTrend;
  };
}

export async function getStats() {
  return get<Stats>('/stats');
}

// ===== Activity API =====

export type ActivityItem =
  | { id: string; type: 'alarm'; detail: { time: string }; created_at: string }
  | { id: string; type: 'message'; detail: { text: string }; created_at: string }
  | { id: string; type: 'gift'; detail: { note: string | null; status: string }; created_at: string }
  | { id: string; type: 'voice'; detail: { name: string; status: string }; created_at: string };

export async function getActivity() {
  const data = await get<{ activities: ActivityItem[] }>('/stats/activity');
  return data.activities;
}

export interface UserSearchResult {
  id: string;
  name: string;
  email: string;
  picture: string;
}

export async function searchUsers(q: string) {
  const data = await get<{ users: UserSearchResult[] }>('/user/search', { q });
  return data.users;
}

// ===== Library API =====

export async function getLibrary(filter?: string) {
  const params = filter ? { filter } : undefined;
  const data = await get<{ items: LibraryItem[] }>('/library', params);
  return data.items;
}

export async function toggleFavorite(id: string) {
  const data = await patch<{ is_favorite: boolean }>(`/library/${id}/favorite`);
  return data.is_favorite;
}

export async function deleteLibraryItem(id: string) {
  return del<{ ok: boolean }>(`/library/${id}`);
}
