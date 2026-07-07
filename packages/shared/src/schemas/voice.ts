/**
 * 음성 프로필 도메인 스키마. 클로닝 진행 상태(processing/ready/failed)와
 * 프로필 메타데이터(이름 등)를 정의한다.
 *
 * 필드 형태는 백엔드가 실제로 직렬화하는 raw DB row(snake_case)와 일치시킨다
 * (voice-profile.ts 의 `SELECT *` 스프레드). 신규 컬럼이 추가돼도 깨지지 않도록
 * 핵심 필드만 required, 나머지는 optional 로 둔다.
 */
import { z } from 'zod';

export const VoiceProfileStatusSchema = z.enum(['processing', 'ready', 'failed']);
export type VoiceProfileStatus = z.infer<typeof VoiceProfileStatusSchema>;

// 음성(화자)의 성별. 일본어 1인칭(僕/俺/私) 등 언어별 톤을 가볍게 보정하는 데 쓴다.
export const VoiceGenderSchema = z.enum(['male', 'female', 'neutral']);
export type VoiceGender = z.infer<typeof VoiceGenderSchema>;

// 어체 격식: 'auto'(관계 기반, 기본) / 'polite'(캐주얼 관계여도 ja=です・ます, ko=해요체로 격상).
export const SpeechFormalitySchema = z.enum(['auto', 'polite']);
export type SpeechFormality = z.infer<typeof SpeechFormalitySchema>;

export const VoiceProfileSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  // 백엔드 create/update 가 강제하는 한도와 동일(1-50자). voice-profile.ts:446,760.
  name: z.string().min(1).max(50),
  status: VoiceProfileStatusSchema,
  voice_gender: VoiceGenderSchema.nullable().optional(),
  speech_formality: SpeechFormalitySchema.nullable().optional(),
  is_shared: z.boolean().optional(),
  is_draft: z.boolean().optional(),
  is_system: z.boolean().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
