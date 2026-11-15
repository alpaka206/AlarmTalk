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
 * ⚠ 바꾸면 **캐시 키가 갈린다**(2026-10-26 — `lib/render-fingerprint.ts` 의 「렌더 부가 설정」). 예전에는 키에 들어가지
 *   않아 바꿔도 옛 설정으로 만든 오디오가 그대로 서빙됐다. 지금 값은 기준값(`BASELINE_RENDER_EXTRAS`)이라 키에서
 *   빠진다 — 쌓인 캐시를 한꺼번에 버리지 않는다. 바꾸면 직접 입력은 **세지 않고** 다시 굽고(`docs/spec/tts-render-and-budget.md`
 *   §2), 스톡은 게시 스크립트의 교체 갈래로 간다. 시청본 지문(`scripts/stock-preview-fingerprint.ts`)에도 들어간다.
 */
export const TTS_VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.8 } as const;

/**
 * 합성한 소리를 올리는 음량(dB) — **v4 Turbo 가 v3 보다 작게 나와서** 올린다(2026-10-08 사용자: "4db 정도만 크게").
 * 서버가 만드는 모든 소리(`voice-provider.ts` 의 합성 갈래)와 기본 목소리 게시본·앱 번들 인사말이 같은 값·같은 셈
 * (`@alarmtalk/voice` 의 `boostLoudness`)을 쓴다. 봉우리가 −0.2 dBFS 에 닿으면 그 직전까지만 올린다.
 *
 * ⚠ 캐시 키에 들어간다(0 이 아닐 때만) — 바꾸면 옛 크기로 만든 소리를 다시 쓰지 않는다. 모델을 바꾸면 새 모델의
 *   크기를 재서 이 값을 다시 정한다.
 */
export const TTS_LOUDNESS_BOOST_DB = 4;

/**
 * **합성 글자를 만드는 규칙의 세대** — 공백 접기(`audio-cache.ts` 의 `normalizeTtsText`), 글자 웃음 → `[laughs]`
 * (`lib/typed-laughter.ts`), 화면 문구 → 합성 문구 같은 **같은 입력에서 다른 글자를 제공자에게 보내게 되는** 규칙을
 * 바꾸면 올린다. 렌더 지문과 캐시 키(기준값과 다를 때만)에 들어간다(`lib/render-fingerprint.ts`).
 */
export const TTS_TEXT_NORMALIZATION_VERSION = 1;

/**
 * **받은 소리를 굽는 셈의 세대** — 높이(`shiftVoicePitch`)·음량(`boostLoudness`)·MP3 인코더 설정처럼 같은 PCM 에서 다른
 * 바이트를 내게 되는 변경이면 올린다(리미터를 더할 때 등). 렌더 지문과 캐시 키(기준값과 다를 때만)에 들어간다.
 */
export const TTS_POSTPROCESS_VERSION = 1;

/**
 * 서버가 만드는 소리의 **최종 형식**(코덱·샘플레이트·비트레이트). 굽는 갈래(`voice-pitch.ts` — PCM 44.1 kHz → MP3
 * 128 kbps)와 굽지 않는 갈래(`elevenlabs.ts` 의 `ELEVENLABS_TTS_OUTPUT_FORMAT`)가 같은 값이다 — 테스트가 셋을 맞대 본다.
 */
export const TTS_FINAL_AUDIO_FORMAT = 'mp3_44100_128';
