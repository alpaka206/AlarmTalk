import type { Env } from '../types';
import { ElevenLabsClient } from './elevenlabs';
import { TTS_MODEL_ID } from './tts-model';
import {
  appliedPitchSemitones,
  bakePitchMp3,
  PITCH_PCM_OUTPUT_FORMAT,
  type VoicePitch,
} from './voice-pitch';

interface VoiceProviderEnrollResult {
  provider: string;
  providerVoiceId: string;
  status: 'processing' | 'ready' | 'failed';
}

export interface VoiceProviderEnrollAttempt {
  provider: string;
  enroll(): Promise<VoiceProviderEnrollResult>;
}

interface VoiceProviderSynthesizeResult {
  provider: string;
  providerVoiceId: string;
  modelId: string;
  outputFormat: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface VoiceProviderAttempt {
  provider: string;
  providerVoiceId: string;
  modelId: string;
  outputFormat: string;
  /**
   * 이 합성에 굽는 목소리 높이(반음, 0 이면 굽지 않는다 — `appliedPitchSemitones`). 캐시 키에 들어간다
   * (`computeTtsCacheKey` 의 `pitchSemitones` — 0 이면 빠져 예전 키 그대로다).
   */
  pitchSemitones: number;
  synthesize(): Promise<VoiceProviderSynthesizeResult>;
}

export interface VoiceProviderProfile {
  elevenlabs_voice_id?: string | null;
}

export class VoiceProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceProviderUnavailableError';
  }
}

export class UnsupportedVoiceProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedVoiceProviderError';
  }
}

const SUPPORTED_SYNTHESIS_LANGUAGES = new Set(['ko', 'en', 'ja', 'fr', 'it']);

export function createEnrollmentAttempts(params: {
  env: Env;
  audioData: ArrayBuffer;
  name: string;
  audioMimeType?: string | null;
  audioFileName?: string | null;
}): VoiceProviderEnrollAttempt[] {
  const attempts: VoiceProviderEnrollAttempt[] = [];

  if (params.env.ELEVENLABS_API_KEY) {
    attempts.push({
      provider: 'elevenlabs',
      enroll: async () => {
        const client = new ElevenLabsClient(params.env.ELEVENLABS_API_KEY);
        const result = await client.createInstantClone(params.audioData, params.name, {
          removeBackgroundNoise: true,
          mimeType: params.audioMimeType,
          fileName: params.audioFileName,
        });
        return {
          provider: 'elevenlabs',
          providerVoiceId: result.voice_id,
          status: 'ready',
        };
      },
    });
  }

  return attempts;
}

export function createSynthesisAttempts(params: {
  env: Env;
  profile: VoiceProviderProfile;
  text: string;
  language: string;
  /**
   * 그 목소리의 등록 높이(`voice_profiles.pitch_semitones`·`pitch_model_id` — `voicePitchFromRow`). 없으면 원래
   * 소리다. 프리셋 사전렌더·직접 입력이 모두 여기를 지나므로 **굽는 자리는 여기 한 곳**이다(스펙 §4-3).
   */
  pitch?: VoicePitch | null;
  /** 테스트용 — 굽는 함수를 바꿔 끼운다(기본 `bakePitchMp3`). */
  bake?: (pcm: Uint8Array, semitones: number) => Promise<Uint8Array>;
}): VoiceProviderAttempt[] {
  const attempts: VoiceProviderAttempt[] = [];

  if (params.profile.elevenlabs_voice_id && params.env.ELEVENLABS_API_KEY) {
    // 모델은 코드 상수 하나다(`TTS_MODEL_ID`) — 캐시 키의 modelId 와 실제 합성 모델이 갈라질 수 없다.
    const modelId = TTS_MODEL_ID;
    const pitchSemitones = appliedPitchSemitones(params.pitch, modelId);
    const bake = params.bake ?? bakePitchMp3;
    attempts.push({
      provider: 'elevenlabs',
      providerVoiceId: params.profile.elevenlabs_voice_id,
      modelId,
      // 파일 확장자/캐시키용 coarse 라벨. 실제 제공자 출력은 elevenlabs.ts 의
      // ELEVENLABS_TTS_OUTPUT_FORMAT(mp3_44100_128) 로 고정되며 그 형식은 mp3(audio/mpeg)라 일치한다.
      // 높이를 굽는 목소리도 결과는 같은 MP3 다(PCM 으로 받아 구운 뒤 MP3 로 만든다).
      outputFormat: 'mp3',
      pitchSemitones,
      synthesize: async () => {
        const client = new ElevenLabsClient(params.env.ELEVENLABS_API_KEY);
        const audioBuffer = await client.textToSpeech(
          params.profile.elevenlabs_voice_id!,
          params.text,
          {
            language_code: normalizeSynthesisLanguage(params.language),
            ...(pitchSemitones !== 0 ? { output_format: PITCH_PCM_OUTPUT_FORMAT } : {}),
          },
        );
        const bytes =
          pitchSemitones !== 0
            ? await bake(new Uint8Array(audioBuffer), pitchSemitones)
            : new Uint8Array(audioBuffer);
        return {
          provider: 'elevenlabs',
          providerVoiceId: params.profile.elevenlabs_voice_id!,
          modelId,
          outputFormat: 'mp3',
          mimeType: 'audio/mpeg',
          bytes,
        };
      },
    });
  }

  return attempts;
}

export function noVoiceProviderError(): VoiceProviderUnavailableError {
  return new VoiceProviderUnavailableError(
    'No usable provider voice ID is available for this profile.',
  );
}

export function normalizeSynthesisLanguage(language: string | null | undefined): string {
  const normalized = language?.trim().toLowerCase().split(/[-_]/)[0] || 'ko';
  return SUPPORTED_SYNTHESIS_LANGUAGES.has(normalized) ? normalized : 'ko';
}

export function inferSynthesisLanguage(text: string, fallback = 'ko'): string {
  if (/[\uAC00-\uD7A3]/.test(text)) return 'ko';
  if (/[\u3040-\u30FF\u31F0-\u31FF]/.test(text)) return 'ja';
  if (/[A-Za-z]/.test(text)) return 'en';
  return normalizeSynthesisLanguage(fallback);
}
