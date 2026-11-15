import { currentRenderExtras, renderExtrasCacheKeyPart, type RenderExtras } from './render-fingerprint';

export interface TtsCacheInput {
  provider: string;
  providerVoiceId: string;
  voiceProfileId: string;
  modelId: string;
  language: string;
  languageCode?: string;
  text: string;
  outputFormat: string;
  /**
   * **누구의 무엇인가** — 같은 보이스·같은 글자라도 쓰임이 다르면 키를 가른다(아래 두 값만 쓴다).
   * 비우면 예전 키 그대로다(`JSON.stringify` 가 undefined 를 빼므로).
   *
   * ⚠ 왜 필요한가(Codex #840): `generated_audio_assets.request_hash` 는 **전역 UNIQUE** 인데 오브젝트 키는
   *   주인을 담는다(`generatedTtsObjectKey`). 키가 겹치면 두 번째 렌더의 원장 행이 `INSERT OR IGNORE` 로 조용히
   *   빠져, 그 오브젝트는 원장에 없는 채 남는다 — 원장은 R2 키의 유일한 출처라 계정 삭제·보관 정리가 그걸
   *   못 찾는다. v3 시절에는 태그와 스톡의 여운 꼬리(` ...`)가 우연히 키를 갈라 놓았는데, eleven_v4_turbo 로
   *   둘 다 뺀 뒤로는 사용자가 스톡 문장을 그대로 치거나 두 사람이 같은 글을 치면 키가 같아진다.
   */
  scope?: string;
  /**
   * 그 합성에 구운 목소리 높이(반음 — `VoiceProviderAttempt.pitchSemitones`). 0 이거나 비우면 키에서 빠져 예전 키
   * 그대로다. 높이는 등록 확정 때 한 번 정하고 교체 등록은 provider voice id 를 바꾸므로 지금 규칙으로는 높이만 다른
   * 두 소리가 같은 키를 쓸 일이 없지만, 높이를 구운 소리와 원래 소리가 한 키를 나눠 쓰지 않게 넣어 둔다.
   */
  pitchSemitones?: number;
  /**
   * 그 합성에 올린 음량(dB — `VoiceProviderAttempt.loudnessBoostDb`, 곧 `TTS_LOUDNESS_BOOST_DB`). 0 이거나 비우면 키에서
   * 빠져 예전 키 그대로다. 넣는 이유: 같은 모델·같은 글자라도 올리기 전에 만든 소리는 작다 — 키를 갈라 캐시가 그 소리를
   * 다시 내주지 않게 한다(값을 바꾸면 또 갈린다). 높이와는 따로 들어간다.
   *
   * ⚠ 스톡 게시 스크립트(`scripts/publish-stock-clips.ts`)도 **올린 바이트를 올릴 때** 같은 값을 넣어야 서버
   *   (`generateStockClip`)와 키가 맞는다 — 범위(`STOCK_TTS_CACHE_SCOPE`)와 같은 규칙이다.
   */
  loudnessBoostDb?: number;
  /**
   * **원래 키에 없던 렌더 설정**(합성 옵션·글자 규칙 세대·후처리 세대·최종 형식 — `lib/render-fingerprint.ts`). 비우면
   * 지금 코드 값이다. 2026-10-26 의 기준값(`BASELINE_RENDER_EXTRAS`)과 같으면 키에서 빠져 예전 키 그대로고, 다르면
   * 그 해시가 들어가 옛 설정으로 만든 소리를 다시 내주지 않는다. 테스트만 넘긴다.
   *
   * ⚠ 예전에는 `TTS_VOICE_SETTINGS` 를 바꿔도 키가 그대로라 옛 설정의 소리가 계속 서빙됐다(`tts-model.ts` 의 옛 ⚠).
   */
  renderExtras?: RenderExtras;
}

/**
 * 스톡 클립(시스템 스톡 게시·클론 사전렌더)의 범위. 서버(`generateStockClip`)와 게시 스크립트
 * (`scripts/publish-stock-clips.ts`)가 **같은 값**을 넣어야 키가 맞는다.
 */
export const STOCK_TTS_CACHE_SCOPE = 'stock';

/**
 * 직접 입력의 범위 — 그 사람 것이다. 직접 입력 캐시는 원래 남과 나누지 않으므로(`findCachedGeneratedAudio`
 * 의 `anyUser: false`) 잃는 캐시 적중이 없다.
 */
export function manualTtsCacheScope(userPk: string): string {
  return `manual:${userPk}`;
}

function normalizeTtsText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export async function computeTtsCacheKey(input: TtsCacheInput): Promise<string> {
  const normalized = {
    provider: input.provider,
    providerVoiceId: input.providerVoiceId,
    voiceProfileId: input.voiceProfileId,
    modelId: input.modelId,
    language: input.language,
    languageCode: input.languageCode ?? input.language,
    text: normalizeTtsText(input.text),
    outputFormat: input.outputFormat,
    scope: input.scope,
    // 0·undefined 는 빼서(`JSON.stringify` 가 undefined 를 버린다) 높이 없는 목소리의 키를 바꾸지 않는다.
    pitchSemitones: input.pitchSemitones ? input.pitchSemitones : undefined,
    // 음량도 같다 — 0·undefined 면 빠져, 올리지 않은 소리의 키는 예전 그대로다.
    loudnessBoostDb: input.loudnessBoostDb ? input.loudnessBoostDb : undefined,
    // 부가 설정 — 기준값이면 undefined 라 빠진다(예전 키 그대로).
    renderExtras: await renderExtrasCacheKeyPart(input.renderExtras ?? currentRenderExtras()),
  };
  return sha256Hex(JSON.stringify(normalized));
}

export function generatedTtsObjectKey(userId: string, cacheKey: string, format = 'mp3'): string {
  const safeFormat = format.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp3';
  return `generated-tts/${encodeURIComponent(userId)}/${cacheKey}.${safeFormat}`;
}

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
