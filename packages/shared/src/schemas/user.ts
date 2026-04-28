import { z } from 'zod';

export const UserPlanSchema = z.enum(['free', 'plus', 'family']);
export type UserPlan = z.infer<typeof UserPlanSchema>;

export const UserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).max(64),
  plan: UserPlanSchema,
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;
