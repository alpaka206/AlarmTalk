import type { Env } from '../types';
import { ElevenLabsClient } from './elevenlabs';
import { TTS_LOUDNESS_BOOST_DB, TTS_MODEL_ID } from './tts-model';
import {
  appliedPitchSemitones,
  bakeVoiceMp3,
  needsVoiceBake,
  SYNTHESIS_PCM_OUTPUT_FORMAT,
  type VoiceBake,
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
   * 이 합성에 굽는 목소리 높이(반음, 0 이면 높이를 바꾸지 않는다 — `appliedPitchSemitones`). 캐시 키에 들어간다
   * (`computeTtsCacheKey` 의 `pitchSemitones` — 0 이면 빠져 예전 키 그대로다).
   */
  pitchSemitones: number;
  /**
   * 이 합성에 올리는 음량(dB — `TTS_LOUDNESS_BOOST_DB`, 0 이면 올리지 않는다). 캐시 키에 들어간다
   * (`computeTtsCacheKey` 의 `loudnessBoostDb` — 0 이면 빠진다). 올리기 전에 만든 소리를 다시 내주지 않게 한다.
   */
  loudnessBoostDb: number;
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
   * 높이다. 프리셋 사전렌더·직접 입력·등록 미리듣기가 모두 여기를 지나므로 **굽는 자리는 여기 한 곳**이다 — 높이(스펙
   * §4-3)와 음량(§10) 둘 다.
   */
  pitch?: VoicePitch | null;
  /** 테스트용 — 굽는 함수를 바꿔 끼운다(기본 `bakeVoiceMp3`). */
  bake?: (pcm: Uint8Array, recipe: VoiceBake) => Promise<Uint8Array>;
}): VoiceProviderAttempt[] {
  const attempts: VoiceProviderAttempt[] = [];

  if (params.profile.elevenlabs_voice_id && params.env.ELEVENLABS_API_KEY) {
    // 모델은 코드 상수 하나다(`TTS_MODEL_ID`) — 캐시 키의 modelId 와 실제 합성 모델이 갈라질 수 없다.
    const modelId = TTS_MODEL_ID;
    // 굽는 것 — 그 목소리의 높이(모델이 바뀌었으면 0)와 **모든 합성에 같은** 음량. 둘 다 캐시 키에 들어가므로
    // 실제로 구운 값을 그대로 attempt 에 싣는다(호출부는 이 값으로 키를 만든다).
    const recipe: VoiceBake = {
      pitchSemitones: appliedPitchSemitones(params.pitch, modelId),
      loudnessBoostDb: TTS_LOUDNESS_BOOST_DB,
    };
    const baked = needsVoiceBake(recipe);
    const bake = params.bake ?? bakeVoiceMp3;
    attempts.push({
      provider: 'elevenlabs',
      providerVoiceId: params.profile.elevenlabs_voice_id,
      modelId,
      // 파일 확장자/캐시키용 coarse 라벨. 굽는 합성은 PCM 으로 받아 구운 뒤 MP3 128 kbps 로 만들고, 굽지 않으면
      // 제공자 출력(elevenlabs.ts 의 ELEVENLABS_TTS_OUTPUT_FORMAT, mp3_44100_128)을 그대로 쓴다 — 어느 쪽이든
      // mp3(audio/mpeg)라 일치한다.
      outputFormat: 'mp3',
      pitchSemitones: recipe.pitchSemitones,
      loudnessBoostDb: recipe.loudnessBoostDb,
      synthesize: async () => {
        const client = new ElevenLabsClient(params.env.ELEVENLABS_API_KEY);
        const audioBuffer = await client.textToSpeech(
          params.profile.elevenlabs_voice_id!,
          params.text,
          {
            language_code: normalizeSynthesisLanguage(params.language),
            ...(baked ? { output_format: SYNTHESIS_PCM_OUTPUT_FORMAT } : {}),
          },
        );
        // ⚠ 굽기가 실패하면 그대로 던진다 — 받은 소리(올리지 않은 크기)로 대신 돌려주지 말 것(`bakeVoiceMp3`).
        const bytes = baked ? await bake(new Uint8Array(audioBuffer), recipe) : new Uint8Array(audioBuffer);
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
