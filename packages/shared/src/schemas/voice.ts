/**
 * 음성 프로필 도메인 스키마. 클로닝 진행 상태(processing/ready/failed)와
 * 프로필 메타데이터(이름, 샘플 수)를 정의한다.
 */
import { z } from 'zod';

export const VoiceProfileStatusSchema = z.enum(['processing', 'ready', 'failed']);
export type VoiceProfileStatus = z.infer<typeof VoiceProfileStatusSchema>;

export const VoiceProfileSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1).max(32),
  status: VoiceProfileStatusSchema,
  sampleCount: z.number().int().nonnegative(),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
