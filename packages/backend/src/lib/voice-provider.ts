import type { Env } from '../types';
import { ElevenLabsClient } from './elevenlabs';

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

const DEFAULT_TTS_MODEL_ID = 'eleven_v3';

/**
 * 합성 모델 id. 워커 변수 `ELEVENLABS_TTS_MODEL_ID` 가 비어 있으면 `eleven_v3` 다 — **어디에도 설정하지 않는다.**
 *
 * ⚠ **바꾸려면 재렌더 계획이 먼저다.** 이미 게시된 클립(시스템 스톡·클론 사전렌더)은 전부 v3 로 구웠고,
 *   무엇을 구울지는 `messages` 행으로 고르므로(`findMissingStockTargets`) 모델만 바꾸면 **다시 굽지 않는다** —
 *   새로 만드는 것(직접 입력·새 클론)만 새 모델이 되어 한 사람의 알람에 두 모델 소리가 섞인다. 직접 입력은
 *   모델 id 가 캐시 키에 들어가(`computeTtsCacheKey`) 같은 문구도 새로 합성된다. 스톡 게시 스크립트
 *   (`scripts/publish-stock-clips.ts`·`scripts/prerender-stock-preview.ts`)는 `eleven_v3` 를 박아 두었고, 말끝
 *   처리(`withClosingBreath`·`appendMp3TrailingSilence`)는 v3 의 급마감 때문에 있다. 2026-09-29 비교에서
 *   v4 는 speed·style 을 **조용히 무시**했고(운영의 speed 0.9 가 안 먹는다) 남자 목소리의 음높이가 크게
 *   올랐다 — 비교 기록은 `docs/spec/voice-and-message.md` 「합성 모델」.
 */
function ttsModelId(env: Env): string {
  return env.ELEVENLABS_TTS_MODEL_ID?.trim() || DEFAULT_TTS_MODEL_ID;
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
}): VoiceProviderAttempt[] {
  const attempts: VoiceProviderAttempt[] = [];

  if (params.profile.elevenlabs_voice_id && params.env.ELEVENLABS_API_KEY) {
    const modelId = ttsModelId(params.env);
    attempts.push({
      provider: 'elevenlabs',
      providerVoiceId: params.profile.elevenlabs_voice_id,
      modelId,
      // 파일 확장자/캐시키용 coarse 라벨. 실제 제공자 출력은 elevenlabs.ts 의
      // ELEVENLABS_TTS_OUTPUT_FORMAT(mp3_44100_128) 로 고정되며 그 형식은 mp3(audio/mpeg)라 일치한다.
      outputFormat: 'mp3',
      synthesize: async () => {
        const client = new ElevenLabsClient(params.env.ELEVENLABS_API_KEY);
        const audioBuffer = await client.textToSpeech(
          params.profile.elevenlabs_voice_id!,
          params.text,
          {
            model_id: modelId,
            language_code: normalizeSynthesisLanguage(params.language),
          },
        );
        return {
          provider: 'elevenlabs',
          providerVoiceId: params.profile.elevenlabs_voice_id!,
          modelId,
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
