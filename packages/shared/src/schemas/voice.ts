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

export const VoiceProfileSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  // 백엔드 create/update 가 강제하는 한도와 동일(1-50자). voice-profile.ts:446,760.
  name: z.string().min(1).max(50),
  status: VoiceProfileStatusSchema,
  is_shared: z.boolean().optional(),
  is_draft: z.boolean().optional(),
  is_system: z.boolean().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
