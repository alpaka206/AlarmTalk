/**
 * 음성 프로필 도메인 스키마. 클로닝 진행 상태(processing/ready/failed)와
 * 프로필 메타데이터(이름 등)를 정의한다.
 *
 * 필드 형태는 백엔드가 실제로 직렬화하는 raw DB row(snake_case)와 일치시킨다
 * (voice-profile.ts 의 `SELECT *` 스프레드). 신규 컬럼이 추가돼도 깨지지 않도록
 * 핵심 필드만 required, 나머지는 optional 로 둔다.
 */
import { z } from 'zod';

/**
 * 등록 미리듣기 문구 직접 수정(초안 전용) 요청 바디.
 * 길이 한도는 생성 경로(generatePrerenderClipText)의 검증 상한(200자)과 동일.
 * 합성 텍스트가 "[태그] 문구" 로 조립되므로 대괄호는 태그 주입 방지를 위해 금지.
 */
export const VoicePreviewTextUpdateSchema = z.object({
  preview_text: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((text) => !/[[\]]/.test(text), { message: 'Brackets are not allowed' }),
});
export type VoicePreviewTextUpdate = z.infer<typeof VoicePreviewTextUpdateSchema>;

/**
 * 목소리 높이(반음) — 등록 미리듣기에서 사용자가 막대로 고른 값이다(`docs/spec/voice-and-message.md` §4-3).
 *
 * 클론이 실제 목소리보다 높거나 낮게 나올 때 바로잡는 값이라, **등록 확정 때 한 번** 정하고(`PATCH /voice/:id` 의
 * `pitch_semitones`, 초안 → 정식일 때만) 서버가 그 목소리로 만드는 모든 알람 소리(프리셋·직접 입력)에 굽는다 —
 * 공유받은 가족·가족 알람 수신자·다른 기기도 같은 소리를 듣는다. 높이만 바꾸는 몸집 유지 TD-PSOLA 다
 * (`@alarmtalk/voice` 의 `shiftVoicePitch`, 두 앱과 같은 셈 — 앱 쪽은 PR #870). 0 은 원래 소리이고, 이 기능 이전에 등록한 목소리와
 * 값을 보내지 않는 앱(1.2.10)은 0 이다.
 */
export const VOICE_PITCH_MIN_SEMITONES = -6;
export const VOICE_PITCH_MAX_SEMITONES = 3;
/** 막대 눈금 — 앱 막대와 같아야 한다(PR #870). */
export const VOICE_PITCH_STEP_SEMITONES = 0.5;

export const VoicePitchSemitonesSchema = z
  .number()
  .finite()
  .min(VOICE_PITCH_MIN_SEMITONES)
  .max(VOICE_PITCH_MAX_SEMITONES)
  .refine((value) => Number.isInteger(value / VOICE_PITCH_STEP_SEMITONES), {
    message: `Pitch must be a multiple of ${VOICE_PITCH_STEP_SEMITONES} semitones`,
  });
export type VoicePitchSemitones = z.infer<typeof VoicePitchSemitonesSchema>;

/**
 * 목소리의 결(경쾌/차분) — ⚠ **1.2.10 앱 호환용으로만 남은 계약이다.**
 * 1.2.10 만 등록 '세부 정보' 단계에서 '목소리 느낌'(자동/경쾌/차분)을 고르게 하고 이 값을 보낸다
 * (`POST voice/clone` 의 `voiceEnergy`, `PATCH voice/:id/relationship` 의 `voice_energy`, '' = 자동).
 * 그다음 앱은 선택지를 뺐고(2026-09-29) 이 값을 보내지 않는다 — 그러면 서버는 등록 녹음 전사로 추정한
 * 말투(`speech_style.energy`)를 쓰고, 그것도 없으면 결을 따로 정하지 않는다. 이미 저장된 고른 값은
 * 추정값보다 앞선다(`withVoiceEnergy`). 알람 문구의 문장 에너지와 딜리버리 태그가 이 결을 따른다.
 *
 * 받는 처리(와 이 스키마)는 두 스토어의 `minSupported`(`lib/app-version.ts`)가 선택지를 뺀 릴리스를
 * 넘긴 뒤에 지운다 — `docs/spec/voice-and-message.md` 4-2, `docs/qa/dev-test-handoff.md`
 * 「서버의 목소리 느낌 받는 처리 정리」. 먼저 지우면 1.2.10 의 선택지가 죽은 컨트롤이 된다.
 *
 * ⚠ 음향은 보지 않는다. Gemini 가 받는 것은 전사(글자)뿐이라, 추정하는 결도 목소리 톤이 아니라 말투다.
 */
export const VoiceEnergySchema = z.enum(['', 'lively', 'calm']);
export type VoiceEnergy = z.infer<typeof VoiceEnergySchema>;
