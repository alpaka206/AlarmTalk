import { z } from 'zod';

export const PasswordSchema = z
  .string()
  .min(8, '비밀번호는 최소 8자 이상이어야 합니다')
  .max(128, '비밀번호는 최대 128자까지 허용됩니다');

export const EmailVerificationCodeSchema = z
  .string()
  .regex(/^\d{6}$/, '인증 코드는 6자리 숫자여야 합니다');

export const EmailVerificationRequestSchema = z.object({
  email: z.string().email(),
});
export type EmailVerificationRequest = z.infer<typeof EmailVerificationRequestSchema>;

export const EmailVerificationConfirmRequestSchema = z.object({
  email: z.string().email(),
  code: EmailVerificationCodeSchema,
});
export type EmailVerificationConfirmRequest = z.infer<typeof EmailVerificationConfirmRequestSchema>;

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: PasswordSchema,
  email_verification_code: EmailVerificationCodeSchema,
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

export const AppleLoginRequestSchema = z.object({
  id_token: z.string().min(1),
  email: z.string().email().optional(),
  name: z.string().min(1).max(64).optional(),
  // 클라이언트가 SecRandomCopyBytes 로 생성한 raw nonce.
  // 서버는 이 값을 SHA256 해싱해 id_token.nonce 와 비교한다.
  nonce: z.string().min(16).max(128).optional(),
});
export type AppleLoginRequest = z.infer<typeof AppleLoginRequestSchema>;

export const AuthResponseSchema = z.object({
  token: z.string().min(1),
  user: z.object({
    id: z.string().min(1),
    email: z.string().email(),
    name: z.string(),
    plan: z.enum(['free', 'plus', 'family']),
    apple_user_id: z.string().nullable().optional(),
  }),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
