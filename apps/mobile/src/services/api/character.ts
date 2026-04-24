import { get, post } from './core';

export type CharacterStage = 'seed' | 'sprout' | 'tree' | 'bloom';

export type XpEvent =
  | 'alarm_completed'
  | 'alarm_snoozed'
  | 'alarm_dismissed'
  | 'family_alarm_received'
  | 'friend_invited'
  | 'streak_bonus_7'
  | 'streak_bonus_30'
  | 'streak_bonus_90';

export interface CharacterPayload {
  id: string;
  user_id: string;
  name: string;
  level: number;
  xp: number;
  affection: number;
  stage: CharacterStage;
  daily_xp: number;
  daily_xp_reset_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CharacterProgress {
  xp_into_level: number;
  xp_to_next_level: number;
  level_span: number;
  progress_ratio: number;
}

export interface CharacterStreak {
  current: number;
  longest: number;
  last_wakeup_date: string | null;
}

export interface CharacterStats {
  diligence: number;
  health: number;
  consistency: number;
}

export interface StreakAchievement {
  milestone: number;
  bonus_xp: number;
  achieved_at: string;
}

export interface CharacterResponse {
  character: CharacterPayload;
  progress: CharacterProgress;
  streak: CharacterStreak;
  stats: CharacterStats;
  achievements: StreakAchievement[];
}

export interface CharacterGrantResponse extends CharacterResponse {
  grant: {
    event: XpEvent;
    granted_xp: number;
    affection: number;
    capped: boolean;
    remaining_cap: number;
    duplicated: boolean;
    milestone_grants?: Array<{ event: XpEvent; xp: number }>;
  };
}

export async function getCharacterMe(): Promise<CharacterResponse> {
  return get<CharacterResponse>('/characters/me');
}

export async function grantCharacterXp(payload: {
  event: XpEvent;
  client_nonce?: string;
  local_date?: string;
}): Promise<CharacterGrantResponse> {
  return post<CharacterGrantResponse>('/characters/xp', payload);
}
