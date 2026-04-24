export interface VoiceProfile {
  id: string;
  user_id: string;
  name: string;
  perso_voice_id: string | null;
  elevenlabs_voice_id: string | null;
  avatar_url: string | null;
  status: 'processing' | 'ready' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  user_id: string;
  voice_profile_id: string;
  text: string;
  audio_url: string | null;
  category: string;
  is_preset: boolean;
  created_at: string;
  voice_name?: string;
}

export type AlarmMode = 'tts' | 'sound-only';
export type VibrationPattern = 'default' | 'strong' | 'none';
export type WakeMode = 'sound_then_voice' | 'voice_only';

export interface Alarm {
  id: string;
  user_id: string;
  target_user_id: string | null;
  message_id: string;
  time: string;
  // 백엔드 정규화로 배열이 오지만 과거 응답 호환을 위해 string 도 허용
  repeat_days: number[] | string;
  is_active: boolean;
  snooze_minutes: number;
  created_at: string;
  updated_at: string;
  mode?: AlarmMode;
  vibration_pattern?: VibrationPattern;
  wake_mode?: WakeMode;
  voice_profile_id?: string | null;
  speaker_id?: string | null;
  message_text?: string;
  voice_name?: string;
  category?: string;
  sender_user_id?: string | null;
  sender_name?: string | null;
  sender_email?: string | null;
  is_family_alarm?: boolean;
  is_received_family_alarm?: boolean;
}

export interface Friend {
  id: string;
  user_a: string;
  user_b: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
  friend_email?: string;
  friend_name?: string;
  friend_picture?: string;
  friend_last_active_at?: string;
}

export interface PendingFriendRequest {
  id: string;
  user_a: string;
  user_b: string;
  status: 'pending';
  created_at: string;
  requester_email?: string;
  requester_name?: string;
  requester_picture?: string;
}

export interface Gift {
  id: string;
  sender_id: string;
  recipient_id: string;
  message_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  note: string | null;
  created_at: string;
  message_text?: string;
  audio_url?: string;
  category?: string;
  sender_name?: string;
  sender_email?: string;
  sender_picture?: string;
}

export interface LibraryItem {
  id: string;
  user_id: string;
  message_id: string;
  voice_name?: string;
  avatar_url?: string;
  text: string;
  category: string;
  is_favorite: boolean;
  received_at: string;
}

export interface Speaker {
  speaker_id: string;
  label: string;
  segments: Array<{ start: number; end: number }>;
  total_duration: number;
}

export interface DubLanguage {
  code: string;
  name: string;
  experiment: boolean;
}

export interface DubJob {
  id: string;
  source_message_id: string | null;
  source_language: string;
  target_language: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  progress: number;
  result_message_id: string | null;
  error_message: string | null;
  created_at: string;
}

export interface DubResult {
  dub_id: string;
  status: string;
  progress: number;
  result_message_id?: string;
  audio_base64?: string;
  audio_format?: string;
  error_message?: string;
  expected_remaining_minutes?: number;
}

export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (
    err != null &&
    typeof err === 'object' &&
    'responseData' in err &&
    err.responseData != null &&
    typeof err.responseData === 'object' &&
    'error' in err.responseData &&
    typeof (err.responseData as Record<string, unknown>).error === 'string'
  ) {
    return (err.responseData as Record<string, unknown>).error as string;
  }
  return fallback;
}
