/**
 * 알람 도메인 계약 — 직접 입력 상한.
 *
 * 규칙 전문: `docs/spec/voice-and-message.md` §8.
 */

/**
 * **직접 입력 문구의 글자 상한**(사용자에게 들리는 말 기준). 서버 `POST /tts` 가 이 값으로 거절하고(`TEXT_TOO_LONG`),
 * 두 앱의 입력창도 같은 값을 쓴다. 프리셋은 이 상한에서 면제다(`routes/tts.ts` 의 주석).
 */
export const MANUAL_TTS_TEXT_MAX_LENGTH = 200;
