/**
 * 음성 프로필 도메인 스키마. 클로닝 진행 상태(processing/ready/failed)와
 * 프로필 메타데이터(이름, 샘플 수)를 정의한다.
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
  userId: z.string().min(1),
  name: z.string().min(1).max(32),
  status: VoiceProfileStatusSchema,
  sampleCount: z.number().int().nonnegative(),
  voiceGender: VoiceGenderSchema.nullable().optional(),
  speechFormality: SpeechFormalitySchema.nullable().optional(),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
