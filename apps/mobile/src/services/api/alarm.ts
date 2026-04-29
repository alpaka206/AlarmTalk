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
  message_id?: string | null;
  time: string;
  repeat_days?: number[];
  snooze_minutes?: number;
  target_user_id?: string;
  mode?: 'tts' | 'sound-only';
  vibration_pattern?: 'default' | 'strong' | 'none';
  wake_mode?: 'sound_then_voice' | 'voice_only';
  voice_profile_id?: string;
  speaker_id?: string;
  raw_audio_url?: string | null;
  raw_audio_duration_ms?: number | null;
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
    message_id?: string | null;
    mode?: 'tts' | 'sound-only';
    vibration_pattern?: 'default' | 'strong' | 'none';
    wake_mode?: 'sound_then_voice' | 'voice_only';
    voice_profile_id?: string | null;
    speaker_id?: string | null;
    raw_audio_url?: string | null;
    raw_audio_duration_ms?: number | null;
  },
) {
  await patch(`/alarm/${id}`, params);
}

/**
 * Uploads a short raw audio clip (≤30s) for an "original audio" alarm and
 * returns the bucket URL/key the alarm payload should reference.
 */
export async function uploadAlarmSource(audioFile: {
  uri: string;
  name: string;
  type: string;
  durationMs: number;
}): Promise<{ raw_audio_url: string; duration_ms: number }> {
  const formData = new FormData();
  // React Native FormData accepts {uri,name,type} for file fields.
  formData.append('audio', {
    uri: audioFile.uri,
    name: audioFile.name,
    type: audioFile.type,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  formData.append('durationMs', String(audioFile.durationMs));
  const data = await post<{ raw_audio_url: string; duration_ms: number; object_key: string }>(
    '/alarm/source',
    formData,
    { isFormData: true },
  );
  return { raw_audio_url: data.raw_audio_url, duration_ms: data.duration_ms };
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
