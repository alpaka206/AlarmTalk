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
const SUPPORTED_SYNTHESIS_LANGUAGES = new Set(['ko', 'en', 'ja', 'fr', 'it']);

export function createEnrollmentAttempts(params: {
  env: Env;
  audioData: ArrayBuffer;
  name: string;
  audioMimeType?: string | null;
  audioFileName?: string | null;
}): VoiceProviderEnrollAttempt[] {
  const attempts: VoiceProviderEnrollAttempt[] = [];

  if (params.env.PERSO_API_KEY) {
    attempts.push({
      provider: 'perso',
      enroll: async () => {
        // The current Perso codepath in this repository targets upload/dubbing
        // projects. Keep Perso first in the chain, but do not call an uncertain
        // paid endpoint until the direct voice cloning API contract is proven.
        throw new UnsupportedVoiceProviderError(
          'Perso direct voice clone is not available in this backend yet.',
        );
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
  category?: string;
}): VoiceProviderAttempt[] {
  const attempts: VoiceProviderAttempt[] = [];

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
        throw new UnsupportedVoiceProviderError(
          'Perso direct voice-id TTS is not available in this backend yet.',
        );
      },
    });
  }

  if (params.profile.elevenlabs_voice_id && params.env.ELEVENLABS_API_KEY) {
    attempts.push({
      provider: 'elevenlabs',
      providerVoiceId: params.profile.elevenlabs_voice_id,
      modelId: ELEVENLABS_V3_MODEL_ID,
      outputFormat: 'mp3',
      synthesize: async () => {
        const client = new ElevenLabsClient(params.env.ELEVENLABS_API_KEY);
        const audioBuffer = await client.textToSpeech(
          params.profile.elevenlabs_voice_id!,
          params.text,
          {
            model_id: ELEVENLABS_V3_MODEL_ID,
            language_code: normalizeLanguageCode(params.language),
          },
        );
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

function normalizeLanguageCode(language: string): string {
  return normalizeSynthesisLanguage(language);
}
