import type { Alarm, AlarmMode, Message, VoiceProfile } from '../types';

// TODO: real perso.ai voice sample URL — 현재는 번들된 mock 파일 경로
export const MOCK_VOICE_SAMPLE_URI = 'asset:///audio/mock-voice-sample.mp3';
export const MOCK_DEFAULT_ALARM_URI = 'asset:///audio/mock-default-alarm.mp3';

export interface TtsPlaybackPlan {
  kind: 'tts';
  messageId: string;
  text: string;
  voiceName: string;
  category: string;
}

export interface SoundOnlyPlaybackPlan {
  kind: 'sound-only';
  voiceProfileId: string;
  voiceName: string;
  uri: string;
}

export interface FallbackPlaybackPlan {
  kind: 'fallback';
  uri: string;
  reasonKey: string;
}

export interface ErrorPlaybackPlan {
  kind: 'error';
  reasonKey: string;
}

export type PlaybackPlan =
  | TtsPlaybackPlan
  | SoundOnlyPlaybackPlan
  | FallbackPlaybackPlan
  | ErrorPlaybackPlan;

export function resolveAlarmPlayback(
  alarm: Pick<Alarm, 'mode' | 'voice_profile_id' | 'message_id' | 'message_text' | 'voice_name' | 'category'>,
  messages: Pick<Message, 'id' | 'text' | 'voice_name' | 'category'>[],
  voices: Pick<VoiceProfile, 'id' | 'name' | 'status'>[],
): PlaybackPlan {
  const mode: AlarmMode = alarm.mode === 'sound-only' ? 'sound-only' : 'tts';

  if (mode === 'sound-only') {
    const profileId = alarm.voice_profile_id ?? null;
    if (!profileId) {
      return {
        kind: 'fallback',
        uri: MOCK_DEFAULT_ALARM_URI,
        reasonKey: 'alarmPlayback.noVoiceProfile',
      };
    }
    const profile = voices.find((v) => v.id === profileId);
    if (!profile) {
      return {
        kind: 'fallback',
        uri: MOCK_DEFAULT_ALARM_URI,
        reasonKey: 'alarmPlayback.voiceNotFound',
      };
    }
    if (profile.status !== 'ready') {
      return {
        kind: 'fallback',
        uri: MOCK_DEFAULT_ALARM_URI,
        reasonKey: 'alarmPlayback.voiceNotReady',
      };
    }
    return {
      kind: 'sound-only',
      voiceProfileId: profile.id,
      voiceName: profile.name,
      uri: MOCK_VOICE_SAMPLE_URI,
    };
  }

  const message = messages.find((m) => m.id === alarm.message_id);
  const text = message?.text ?? alarm.message_text ?? '';
  const voiceName = message?.voice_name ?? alarm.voice_name ?? '';
  const category = message?.category ?? alarm.category ?? '';
  if (!alarm.message_id || !text) {
    return { kind: 'error', reasonKey: 'alarmPlayback.noMessage' };
  }
  return {
    kind: 'tts',
    messageId: alarm.message_id,
    text,
    voiceName,
    category,
  };
}

export function getAlarmModeBadge(mode: Alarm['mode']): { emoji: string; labelKey: string } {
  if (mode === 'sound-only') return { emoji: '🔊', labelKey: 'alarmPlayback.modeOriginal' };
  return { emoji: '🗣️', labelKey: 'alarmPlayback.modeTts' };
}

export interface NavigatePreviewAction {
  type: 'navigate';
  path: '/player';
  params: {
    messageId: string;
    text: string;
    voiceName: string;
    category: string;
  };
}

export interface AudioPreviewAction {
  type: 'preview-audio';
  uri: string;
  captionKey: string;
  captionParams?: Record<string, string>;
  voiceName: string;
}

export interface ToastPreviewAction {
  type: 'toast';
  messageKey: string;
}

export type PreviewAction =
  | NavigatePreviewAction
  | AudioPreviewAction
  | ToastPreviewAction;

export function buildAlarmPreviewAction(plan: PlaybackPlan): PreviewAction {
  switch (plan.kind) {
    case 'tts':
      return {
        type: 'navigate',
        path: '/player',
        params: {
          messageId: plan.messageId,
          text: plan.text,
          voiceName: plan.voiceName,
          category: plan.category,
        },
      };
    case 'sound-only':
      return {
        type: 'preview-audio',
        uri: plan.uri,
        captionKey: 'alarmPlayback.originalSample',
        captionParams: { name: plan.voiceName },
        voiceName: plan.voiceName,
      };
    case 'fallback':
      return {
        type: 'preview-audio',
        uri: plan.uri,
        captionKey: plan.reasonKey,
        voiceName: '',
      };
    case 'error':
      return { type: 'toast', messageKey: plan.reasonKey };
  }
}
