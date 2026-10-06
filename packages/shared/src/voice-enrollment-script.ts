import scriptsJson from './voice-enrollment-script.json';

/**
 * 목소리 등록 화면이 읽으라고 권하는 **제시 대본** — 단일 출처는 옆의 `voice-enrollment-script.json` 이다.
 *
 * 두 앱은 TypeScript 를 못 쓰니 같은 글을 손으로 둔다(안드로이드 `voices2_record_script` — `res/values{,-en,-ja}/strings.xml`,
 * iOS `VoiceCloneUploadFlow.recordingScript`). 서버는 이 글로 등록 녹음 전사가 **대본을 읽은 것인지** 가린다
 * (`packages/backend/src/lib/enrollment-script.ts`) — 대본은 존댓말이라, 읽은 녹음의 어체는 화자의 것이 아니다
 * (`docs/spec/voice-and-message.md` §4-2).
 *
 * ⚠ **대본을 고치면 여기도 고친다.** 앱만 고치면 서버가 새 대본을 못 알아봐 그 녹음의 존댓말이 다시 화자의 어체로
 * 저장된다. 문장부호·띄어쓰기만 다른 것은 같은 글로 본다(iOS 영어는 줄표를 쓴다). CI lint 의
 * `scripts/check-voice-enrollment-script.py` 가 세 벌을 대조한다.
 */
export const VOICE_ENROLLMENT_SCRIPT_LANGUAGES = ['ko', 'en', 'ja'] as const;
export type VoiceEnrollmentScriptLanguage = (typeof VOICE_ENROLLMENT_SCRIPT_LANGUAGES)[number];

export const VOICE_ENROLLMENT_SCRIPTS: Readonly<Record<VoiceEnrollmentScriptLanguage, string>> =
  scriptsJson;
