import type { Env } from '../types';
import { ElevenLabsClient } from './elevenlabs';

export interface VoiceProviderEnrollResult {
  provider: string;
  providerVoiceId: string;
  status: 'processing' | 'ready' | 'failed';
}

export interface VoiceProviderEnrollAttempt {
  provider: string;
  enroll(): Promise<VoiceProviderEnrollResult>;
}

export interface VoiceProviderSynthesizeResult {
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
  voiceSettings?: Record<string, string | number | boolean | null | undefined>;
  synthesize(): Promise<VoiceProviderSynthesizeResult>;
}

export interface VoiceProviderProfile {
  perso_voice_id?: string | null;
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

const ELEVENLABS_V3_MODEL_ID = 'eleven_v3';
const ELEVENLABS_V3_WAKE_SETTINGS = {
  stability: 0.45,
  similarity_boost: 0.82,
  style: 0.28,
  speed: 0.96,
};
const ELEVENLABS_V3_FOCUS_SETTINGS = {
  stability: 0.52,
  similarity_boost: 0.82,
  style: 0.2,
  speed: 0.94,
};
const ELEVENLABS_V3_CHEER_SETTINGS = {
  stability: 0.44,
  similarity_boost: 0.8,
  style: 0.3,
  speed: 0.97,
};
const ELEVENLABS_V3_DONE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.82,
  style: 0.24,
  speed: 0.95,
};
const ELEVENLABS_V3_SLEEP_SETTINGS = {
  stability: 0.58,
  similarity_boost: 0.84,
  style: 0.18,
  speed: 0.92,
};
const ELEVENLABS_V3_LOVE_SETTINGS = {
  stability: 0.55,
  similarity_boost: 0.84,
  style: 0.2,
  speed: 0.93,
};
const SUPPORTED_SYNTHESIS_LANGUAGES = new Set(['ko', 'en', 'ja', 'fr', 'it']);

export function createEnrollmentAttempts(params: {
  env: Env;
  audioData: ArrayBuffer;
  name: string;
}): VoiceProviderEnrollAttempt[] {
  const attempts: VoiceProviderEnrollAttempt[] = [];

  if (params.env.PERSO_API_KEY) {
    attempts.push({
      provider: 'perso',
      enroll: async () => {
        // The current Perso codepath in this repository targets upload/dubbing
        // projects. Keep Perso first in the chain, but do not call an uncertain
        // paid endpoint until the direct voice cloning API contract is proven.
        throw new UnsupportedVoiceProviderError('Perso direct voice clone is not available in this backend yet.');
      },
    });
  }

  if (params.env.ELEVENLABS_API_KEY) {
    attempts.push({
      provider: 'elevenlabs',
      enroll: async () => {
        const client = new ElevenLabsClient(params.env.ELEVENLABS_API_KEY);
        const result = await client.createInstantClone(params.audioData, params.name, {
          removeBackgroundNoise: true,
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
  category?: string;
}): VoiceProviderAttempt[] {
  const attempts: VoiceProviderAttempt[] = [];
  const voiceSettings = elevenLabsV3VoiceSettings(params.category, params.text);

  if (params.profile.perso_voice_id) {
    attempts.push({
      provider: 'perso',
      providerVoiceId: params.profile.perso_voice_id,
      modelId: 'perso-direct-tts',
      outputFormat: 'mp3',
      synthesize: async () => {
        // The currently documented/implemented Perso integration in this repo
        // is video dubbing oriented, not direct voice-id TTS. Keep this attempt
        // in the chain so Perso can become primary once that API is available,
        // but fall back without charging a provider request today.
        throw new UnsupportedVoiceProviderError('Perso direct voice-id TTS is not available in this backend yet.');
      },
    });
  }

  if (params.profile.elevenlabs_voice_id && params.env.ELEVENLABS_API_KEY) {
    attempts.push({
      provider: 'elevenlabs',
      providerVoiceId: params.profile.elevenlabs_voice_id,
      modelId: ELEVENLABS_V3_MODEL_ID,
      outputFormat: 'mp3',
      voiceSettings,
      synthesize: async () => {
        const client = new ElevenLabsClient(params.env.ELEVENLABS_API_KEY);
        const audioBuffer = await client.textToSpeech(params.profile.elevenlabs_voice_id!, params.text, {
          model_id: ELEVENLABS_V3_MODEL_ID,
          language_code: normalizeLanguageCode(params.language),
          ...voiceSettings,
        });
        return {
          provider: 'elevenlabs',
          providerVoiceId: params.profile.elevenlabs_voice_id!,
          modelId: ELEVENLABS_V3_MODEL_ID,
          outputFormat: 'mp3',
          mimeType: 'audio/mpeg',
          bytes: new Uint8Array(audioBuffer),
        };
      },
    });
  }

  return attempts;
}

export function noVoiceProviderError(): VoiceProviderUnavailableError {
  return new VoiceProviderUnavailableError('No usable provider voice ID is available for this profile.');
}

function elevenLabsV3VoiceSettings(category: string | undefined, text: string) {
  const inferred = inferAlarmCategory(category, text);
  if (inferred === 'night') return ELEVENLABS_V3_SLEEP_SETTINGS;
  if (inferred === 'love') return ELEVENLABS_V3_LOVE_SETTINGS;
  if (inferred === 'evening') return ELEVENLABS_V3_DONE_SETTINGS;
  if (inferred === 'health' || inferred === 'lunch' || inferred === 'study') {
    return ELEVENLABS_V3_FOCUS_SETTINGS;
  }
  if (inferred === 'cheer') return ELEVENLABS_V3_CHEER_SETTINGS;
  return ELEVENLABS_V3_WAKE_SETTINGS;
}

function inferAlarmCategory(category: string | undefined, text: string): string {
  if (category && category !== 'custom') return category;
  const lower = text.toLowerCase();
  if (/(잘\s*자|밤|sleep|night|good night)/i.test(lower)) return 'night';
  if (/(고생|수고|퇴근|done|rest)/i.test(lower)) return 'evening';
  if (/(공부|집중|study|focus)/i.test(lower)) return 'study';
  if (/(건강|약|물|health|medicine|water)/i.test(lower)) return 'health';
  if (/(점심|밥|식사|lunch|meal)/i.test(lower)) return 'lunch';
  if (/(사랑|보고\s*싶|love)/i.test(lower)) return 'love';
  if (/(아침|일어나|기상|wake|morning)/i.test(lower)) return 'morning';
  if (/(힘내|응원|할 수|cheer|encourage)/i.test(lower)) return 'cheer';
  return 'morning';
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

function normalizeLanguageCode(language: string): string {
  return normalizeSynthesisLanguage(language);
}
