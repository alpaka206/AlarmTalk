// 합성 모델과 설정 — 서버(`elevenlabs.ts`·`voice-provider.ts`)와 스톡 스크립트가 함께 쓰는 단일 출처.
// `elevenlabs.ts` 와 따로 둔 것은 그 모듈을 통째로 목킹하는 테스트에서도 이 값이 살아 있게 하려는 것이다.

/**
 * 합성 모델. **이 상수 하나가 정한다 — 워커 변수로 바꾸는 길은 없다**(2026-09-30).
 *
 * 서버(`voice-provider.ts`)와 스톡 스크립트(`scripts/prerender-stock-preview.ts`·`scripts/publish-stock-clips.ts`)가
 * 모두 이 값을 가져다 쓴다. 모델 id 는 캐시 키(`computeTtsCacheKey`)와 시청본 지문에 들어가므로, 한쪽만 다른
 * 값을 쓰면 미리 게시한 클립을 서버가 '없다' 로 세어 다시 굽는다. 예전 워커 변수 `ELEVENLABS_TTS_MODEL_ID` 가
 * 바로 그 갈림길이라 없앴다.
 *
 * ⚠ **바꾸면 게시된 클립은 저절로 다시 굽히지 않는다.** 무엇을 구울지는 `messages` 행으로 고른다
 *   (`findMissingStockTargets`). v3 → v4 Turbo 전환 때는 시스템 스톡을 `publish:stock` 의 제자리 교체로,
 *   클론을 마이그레이션 #124(큐 재적재)로 다시 구웠다 — 절차는 `docs/ops/tts-model-rerender.md`.
 */
export const TTS_MODEL_ID = 'eleven_v4_turbo';
/**
 * 합성 설정. v4 계열은 **stability 와 similarity_boost 만** 받는다 — v3 시절의 style·speed·use_speaker_boost 는
 * 보내도 200 으로 받고 조용히 무시한다(2026-09-29 실측: speed 0.7 과 1.2 의 발화 길이가 4.68초·4.81초).
 * 말 속도는 문장부호(`…`·쉼표)로만 조절된다.
 *
 * ⚠ 이 값은 캐시 키에 들어가지 않는다(`computeTtsCacheKey`) — 바꾸면 이미 만든 오디오가 옛 설정 그대로
 *   서빙된다. 시청본 지문(`scripts/stock-preview-fingerprint.ts`)에는 들어간다.
 */
export const TTS_VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.8 } as const;
