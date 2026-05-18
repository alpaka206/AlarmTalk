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
const ELEVENLABS_V3_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.82,
  style: 0.25,
  speed: 0.96,
};

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
      voiceSettings: ELEVENLABS_V3_VOICE_SETTINGS,
      synthesize: async () => {
        const client = new ElevenLabsClient(params.env.ELEVENLABS_API_KEY);
        const audioBuffer = await client.textToSpeech(params.profile.elevenlabs_voice_id!, params.text, {
          model_id: ELEVENLABS_V3_MODEL_ID,
          ...ELEVENLABS_V3_VOICE_SETTINGS,
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
