/**
 * 인증 관련 요청/응답 스키마.
 *
 * 이메일+비밀번호 가입/로그인, 이메일 인증 코드(6자리), Google/Apple
 * 소셜 로그인, 그리고 공통 인증 응답(JWT 토큰 + 사용자 요약)을 정의한다.
 * 백엔드 `routes/auth.ts` 가 이 스키마로 입력을 검증한다.
 */
import { z } from 'zod';

export const PasswordSchema = z
  .string()
  .min(8, '비밀번호는 최소 8자 이상이어야 합니다')
  .max(128, '비밀번호는 최대 128자까지 허용됩니다')
  .regex(/[A-Za-z]/, '영문자를 최소 1자 포함해야 합니다')
  .regex(/[0-9]/, '숫자를 최소 1자 포함해야 합니다');

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

export const PasswordResetRequestSchema = z.object({
  email: z.string().email(),
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetConfirmRequestSchema = z.object({
  email: z.string().email(),
  code: EmailVerificationCodeSchema,
  password: PasswordSchema,
});
export type PasswordResetConfirmRequest = z.infer<typeof PasswordResetConfirmRequestSchema>;

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
