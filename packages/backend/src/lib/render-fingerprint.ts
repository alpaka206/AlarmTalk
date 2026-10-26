import {
  TTS_FINAL_AUDIO_FORMAT,
  TTS_LOUDNESS_BOOST_DB,
  TTS_MODEL_ID,
  TTS_POSTPROCESS_VERSION,
  TTS_TEXT_NORMALIZATION_VERSION,
  TTS_VOICE_SETTINGS,
} from './tts-model';

/**
 * **렌더 지문 — 이 소리 파일이 어떤 설정으로 만들어졌는가**(`docs/spec/tts-render-and-budget.md` §1).
 *
 * 두 겹을 가른다:
 *  - **논리 결과**(`manualResultLogicalKey`) — 사용자가 고른 것: 누구의·어느 목소리(그 세대)·어느 언어·어떤 문구.
 *    직접 입력 한도는 이것으로 센다. 같은 논리 결과를 서비스가 새 설정으로 다시 구워도 **새 제작이 아니다.**
 *  - **물리 렌더**(`renderFingerprint`) — 그 결과를 실제로 만든 설정 전부: 공급자·모델·provider voice·언어·합성 옵션·
 *    글자 규칙 세대·높이·음량·후처리 세대·최종 형식·굽는 길. 원장(`generated_audio_assets.render_fingerprint`)에 적는다.
 *
 * `renderRevision` 은 그중 **목소리·언어와 무관한 전역 설정**만의 세대다 — 다시 구울 목록(`render-backlog.ts`)이
 * "지금 세대가 아닌 행" 을 SQL 한 줄로 고르는 데 쓴다.
 *
 * ⚠ 이 모듈은 캐시 키 공식을 **바꾸지 않는다** — 지금 값이 기준값(`BASELINE_RENDER_EXTRAS`)이면 부가 설정은 키에서
 *   빠진다(`renderExtrasCacheKeyPart`). 기준값을 고치면 모든 캐시 키가 한꺼번에 갈려 전부 다시 합성된다.
 */

/** 한 렌더를 만든 설정 전부. */
export interface RenderSettings {
  provider: string;
  modelId: string;
  providerVoiceId: string;
  language: string;
  voiceSettings: Readonly<Record<string, number>>;
  textNormalizationVersion: number;
  postprocessVersion: number;
  pitchSemitones: number;
  loudnessBoostDb: number;
  /** 최종 파일 형식(코덱·샘플레이트·비트레이트) — `TTS_FINAL_AUDIO_FORMAT`. */
  finalFormat: string;
  /**
   * 바이트를 만든 길. 같은 최종 형식이라도 손실 압축을 몇 번 거쳤는지가 다르다.
   *  - `pcm_44100>bake>mp3_128` — 서버 합성, PCM 을 받아 높이·음량을 굽는다(`voice-pitch.ts`).
   *  - `provider_mp3` — 서버 합성, 굽지 않고 제공자 MP3 그대로(높이·음량이 둘 다 0 일 때).
   *  - `preview_mp3>boost` — 기본 목소리 게시본, 사람이 들어 본 시청본 MP3 를 음량만 올린 사본(`publish-stock-clips.ts`).
   */
  pipeline: string;
}

export type RenderPipeline = 'pcm_44100>bake>mp3_128' | 'provider_mp3' | 'preview_mp3>boost';

/** 렌더 지문 + 전역 세대 — 원장 행에 함께 적는다. */
export interface RenderStamp {
  fingerprint: string;
  revision: string;
}

/**
 * **캐시 키에 원래 없던 렌더 설정** — 합성 옵션·글자 규칙 세대·후처리 세대·최종 형식. 모델·provider voice·언어·높이·
 * 음량·형식 라벨은 이미 키에 있다(`computeTtsCacheKey`).
 */
export interface RenderExtras {
  voiceSettings: Readonly<Record<string, number>>;
  textNormalizationVersion: number;
  postprocessVersion: number;
  finalFormat: string;
}

/**
 * **2026-10-26 의 부가 설정 — 이 값이면 캐시 키에서 빠진다.** 지문을 들이기 전에 만든 모든 캐시 키가 이 설정으로
 * 만들어졌으므로, 지금 값과 같으면 키가 예전 그대로다(쌓인 캐시를 한꺼번에 버리지 않는다).
 *
 * ⚠ **이 리터럴은 고치지 않는다.** `tts-model.ts` 의 값을 바꾸면 그 값이 이것과 달라져 키에 들어가고, 그때부터 만드는
 *   소리만 새 키를 쓴다. 이 리터럴을 함께 고치면 옛 설정으로 만든 소리를 새 설정의 결과로 계속 내준다(예전의 그 버그).
 */
export const BASELINE_RENDER_EXTRAS: RenderExtras = Object.freeze({
  voiceSettings: Object.freeze({ stability: 0.5, similarity_boost: 0.8 }),
  textNormalizationVersion: 1,
  postprocessVersion: 1,
  finalFormat: 'mp3_44100_128',
});

/** 지금 코드의 부가 설정. */
export function currentRenderExtras(): RenderExtras {
  return {
    voiceSettings: { ...TTS_VOICE_SETTINGS },
    textNormalizationVersion: TTS_TEXT_NORMALIZATION_VERSION,
    postprocessVersion: TTS_POSTPROCESS_VERSION,
    finalFormat: TTS_FINAL_AUDIO_FORMAT,
  };
}

/**
 * 서버 합성 한 번의 설정 — 합성 갈래(`createSynthesisAttempts`)가 attempt 에 실은 값(공급자·provider voice·모델·높이·음량)
 * 과 그 합성의 언어로 만든다. 호출부(직접 입력·사전렌더)가 원장에 지문을 적을 때 쓴다.
 */
export function serverRenderSettings(parts: {
  provider: string;
  providerVoiceId: string;
  language: string;
  pitchSemitones?: number;
  loudnessBoostDb?: number;
  modelId?: string;
}): RenderSettings {
  const pitchSemitones = parts.pitchSemitones ?? 0;
  const loudnessBoostDb = parts.loudnessBoostDb ?? 0;
  const baked = pitchSemitones !== 0 || loudnessBoostDb !== 0;
  return {
    ...currentRenderExtras(),
    provider: parts.provider,
    modelId: parts.modelId ?? TTS_MODEL_ID,
    providerVoiceId: parts.providerVoiceId,
    language: parts.language,
    pitchSemitones,
    loudnessBoostDb,
    pipeline: baked ? 'pcm_44100>bake>mp3_128' : 'provider_mp3',
  };
}

/** 기본 목소리 게시본(시청본 MP3 → 음량 사본)의 설정 — 게시 스크립트·제자리 교체가 원장에 적는다. */
export function stockPublishRenderSettings(parts: {
  provider: string;
  providerVoiceId: string;
  language: string;
}): RenderSettings {
  return {
    ...currentRenderExtras(),
    provider: parts.provider,
    modelId: TTS_MODEL_ID,
    providerVoiceId: parts.providerVoiceId,
    language: parts.language,
    pitchSemitones: 0,
    loudnessBoostDb: TTS_LOUDNESS_BOOST_DB,
    pipeline: 'preview_mp3>boost',
  };
}

/** 키 순서를 고정한 JSON — 같은 설정은 언제나 같은 글자다. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 렌더 지문 — 설정 전부. `rf1-` + 32자. */
export async function renderFingerprint(settings: RenderSettings): Promise<string> {
  return `rf1-${(await sha256Hex(canonicalJson(settings))).slice(0, 32)}`;
}

/**
 * 전역 세대 — 목소리·언어·높이·굽는 길을 뺀 설정. `rv1-` + 16자. 서버 합성과 게시본은 굽는 길만 달라 같은 세대다.
 */
export async function renderRevision(settings: RenderSettings): Promise<string> {
  const global = {
    provider: settings.provider,
    modelId: settings.modelId,
    voiceSettings: settings.voiceSettings,
    textNormalizationVersion: settings.textNormalizationVersion,
    postprocessVersion: settings.postprocessVersion,
    loudnessBoostDb: settings.loudnessBoostDb,
    finalFormat: settings.finalFormat,
  };
  return `rv1-${(await sha256Hex(canonicalJson(global))).slice(0, 16)}`;
}

export async function renderStamp(settings: RenderSettings): Promise<RenderStamp> {
  return { fingerprint: await renderFingerprint(settings), revision: await renderRevision(settings) };
}

/** 지금 코드가 만드는 서버 합성의 전역 세대(공급자 elevenlabs) — 다시 구울 목록의 기준. */
export async function currentRenderRevision(provider = 'elevenlabs'): Promise<string> {
  return renderRevision(
    serverRenderSettings({ provider, providerVoiceId: '', language: '', pitchSemitones: 0, loudnessBoostDb: TTS_LOUDNESS_BOOST_DB }),
  );
}

/**
 * 캐시 키에 넣을 부가 설정 조각 — 기준값과 같으면 `undefined`(키에서 빠져 예전 키 그대로), 다르면 그 설정의 해시.
 */
export async function renderExtrasCacheKeyPart(extras: RenderExtras): Promise<string | undefined> {
  const pick = (e: RenderExtras) =>
    canonicalJson({
      voiceSettings: e.voiceSettings,
      textNormalizationVersion: e.textNormalizationVersion,
      postprocessVersion: e.postprocessVersion,
      finalFormat: e.finalFormat,
    });
  const encoded = pick(extras);
  if (encoded === pick(BASELINE_RENDER_EXTRAS)) return undefined;
  return (await sha256Hex(encoded)).slice(0, 32);
}

/**
 * **직접 입력의 논리 결과 키** — 사용자가 고른 것만 담는다. 렌더 설정(모델·음량·provider voice·합성 옵션)은 넣지 않는다:
 * 그것이 바뀌어 다시 굽는 것은 서비스 사정이라 새 제작으로 세지 않는다(스펙 §2).
 *
 * - `voiceGeneration` 은 목소리의 교체 세대(`voice_profiles.custom_audio_invalidated_at`)다. 사용자가 녹음을 갈아
 *   끼운 제자리 교체는 **새 목소리**라 새 결과다. LRU 반납 뒤 재등록은 세대를 바꾸지 않는다(서비스 사정).
 * - 글자는 앱이 보낸 그대로(`request_id` 지문과 같은 입력 — `manualRequestFingerprint`)다. 합성 글자는 글자 규칙 세대에
 *   따라 바뀌므로 쓰지 않는다.
 */
export async function manualResultLogicalKey(parts: {
  userPk: string;
  voiceProfileId: string;
  voiceGeneration: string;
  language: string;
  translate: boolean;
  text: string;
}): Promise<string> {
  return `lk1-${(await sha256Hex(canonicalJson(parts))).slice(0, 32)}`;
}
