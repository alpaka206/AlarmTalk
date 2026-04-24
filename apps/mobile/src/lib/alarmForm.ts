import type { TFunction } from 'i18next';

export type AlarmMode = 'tts' | 'sound-only';
export type VibrationPattern = 'default' | 'strong' | 'none';
export type WakeMode = 'sound_then_voice' | 'voice_only';

export interface AlarmFormInput {
  messageId: string | null;
  time: string;
  repeatDays: number[];
  mode: AlarmMode;
  vibrationPattern?: VibrationPattern;
  wakeMode?: WakeMode;
  voiceProfileId?: string | null;
  speakerId?: string | null;
  snoozeMinutes?: number;
  targetUserId?: string | null;
}

export interface AlarmCreatePayload {
  message_id: string;
  time: string;
  repeat_days: number[];
  mode: AlarmMode;
  vibration_pattern?: VibrationPattern;
  wake_mode?: WakeMode;
  voice_profile_id?: string;
  speaker_id?: string;
  snooze_minutes?: number;
  target_user_id?: string;
}

export type ValidationResult =
  | { ok: true; payload: AlarmCreatePayload }
  | { ok: false; error: string };

export function validateAlarmForm(input: AlarmFormInput, t: TFunction): ValidationResult {
  if (!input.messageId) {
    return { ok: false, error: t('alarmValidation.messageRequired') };
  }
  if (!/^\d{2}:\d{2}$/.test(input.time)) {
    return { ok: false, error: t('alarmValidation.invalidTime') };
  }
  if (input.mode !== 'tts' && input.mode !== 'sound-only') {
    return { ok: false, error: t('alarmValidation.invalidMode') };
  }
  if (input.mode === 'sound-only' && !input.voiceProfileId) {
    return { ok: false, error: t('alarmValidation.voiceProfileRequired') };
  }
  return { ok: true, payload: buildCreatePayload(input) };
}

export function buildCreatePayload(input: AlarmFormInput): AlarmCreatePayload {
  const payload: AlarmCreatePayload = {
    message_id: input.messageId ?? '',
    time: input.time,
    repeat_days: Array.isArray(input.repeatDays) ? input.repeatDays : [],
    mode: input.mode,
  };
  if (input.vibrationPattern) payload.vibration_pattern = input.vibrationPattern;
  if (input.wakeMode) payload.wake_mode = input.wakeMode;
  if (input.voiceProfileId) payload.voice_profile_id = input.voiceProfileId;
  if (input.speakerId) payload.speaker_id = input.speakerId;
  if (typeof input.snoozeMinutes === 'number') payload.snooze_minutes = input.snoozeMinutes;
  if (input.targetUserId) payload.target_user_id = input.targetUserId;
  return payload;
}

export function getTimeUntilAlarm(hour: number, minute: number): { hours: number; minutes: number } {
  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  const diff = target.getTime() - now.getTime();
  return {
    hours: Math.floor(diff / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
  };
}

export function parseRepeatDays(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.filter((n): n is number => Number.isInteger(n));
  }
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((n): n is number => Number.isInteger(n));
      }
    } catch {
      return [];
    }
  }
  return [];
}
