import { z } from 'zod';

export const PasswordSchema = z
  .string()
  .min(8, '비밀번호는 최소 8자 이상이어야 합니다')
  .max(128, '비밀번호는 최대 128자까지 허용됩니다');

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: PasswordSchema,
  name: z.string().min(1).max(64),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const GoogleLoginRequestSchema = z.object({
  id_token: z.string().min(1),
});
export type GoogleLoginRequest = z.infer<typeof GoogleLoginRequestSchema>;

export const AuthResponseSchema = z.object({
  token: z.string().min(1),
  user: z.object({
    id: z.string().min(1),
    email: z.string().email(),
    name: z.string(),
    plan: z.enum(['free', 'plus', 'family']),
  }),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
