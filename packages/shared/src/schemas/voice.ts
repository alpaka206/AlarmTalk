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
 * 목소리의 결 — 등록할 때 사용자가 고른다(관계·호칭과 같이 초안 단계에서만 바꿀 수 있다).
 * '' = 자동: 등록 녹음 전사로 추정한 값(`speech_style.energy`)을 쓰고, 그것도 없으면 결을 따로 정하지 않는다.
 * 알람 문구의 문장 에너지와 딜리버리 태그가 이 결을 따른다 — 경쾌한 목소리가 굳은 문장을 읽거나
 * 진중한 목소리가 깔깔대면 그 목소리의 핵심이 깨진다.
 *
 * ⚠ 음향은 보지 않는다. 음성 파일을 Vertex 로 보내려면 처리방침·동의부터 바꿔야 해서 사용자 선택으로 정했다.
 */
export const VoiceEnergySchema = z.enum(['', 'lively', 'calm']);
export type VoiceEnergy = z.infer<typeof VoiceEnergySchema>;
