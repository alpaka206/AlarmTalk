import type { Alarm } from '../../types';
import { get, post, patch, del, request } from './core';

// ===== Alarm API =====

export async function getAlarms() {
  const data = await get<{ alarms: Alarm[] }>('/alarm');
  return data.alarms;
}

export async function getAlarm(id: string) {
  const data = await get<{ alarm: Alarm }>(`/alarm/${id}`);
  return data.alarm;
}

export async function createAlarm(params: {
  message_id: string;
  time: string;
  repeat_days?: number[];
  snooze_minutes?: number;
  target_user_id?: string;
  mode?: 'tts' | 'sound-only';
  vibration_pattern?: 'default' | 'strong' | 'none';
  wake_mode?: 'sound_then_voice' | 'voice_only';
  voice_profile_id?: string;
  speaker_id?: string;
}) {
  const data = await post<{ alarm: Alarm }>('/alarm', params);
  return data.alarm;
}

export async function updateAlarm(
  id: string,
  params: {
    time?: string;
    repeat_days?: number[];
    is_active?: boolean;
    snooze_minutes?: number;
    message_id?: string;
    mode?: 'tts' | 'sound-only';
    vibration_pattern?: 'default' | 'strong' | 'none';
    wake_mode?: 'sound_then_voice' | 'voice_only';
    voice_profile_id?: string | null;
    speaker_id?: string | null;
  },
) {
  await patch(`/alarm/${id}`, params);
}

export async function deleteAlarm(id: string) {
  await del(`/alarm/${id}`);
}

// ===== Push Token API =====

export async function registerPushToken(token: string, platform: 'ios' | 'android' | 'web') {
  return post<{ success: boolean }>('/push/token', { token, platform });
}

export async function unregisterPushToken(token: string) {
  return request<{ success: boolean }>({ method: 'DELETE', path: '/push/token', body: { token } });
}
