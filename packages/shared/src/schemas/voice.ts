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
