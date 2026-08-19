/**
 * 인증 관련 요청/응답 스키마.
 *
 * 이메일+비밀번호 가입/로그인, 이메일 인증 코드(6자리), Google
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

/**
 * 표시 이름(닉네임) 공통 규칙 — **모든 경로가 이걸 쓴다.**
 *
 * 예전에는 경로마다 달랐다: 가입은 `max(64)` 에 trim 도 없어 공백만인 이름이 통과했고,
 * `PATCH /user/me` 는 trim + 30자였으며, 구글 로그인은 검증이 아예 없어 재로그인 때마다
 * 외부 클레임이 그 30자 닉네임을 덮어썼다. 같은 값에 규칙이 셋이면 가장 느슨한 경로가
 * 실질 규칙이 된다.
 *
 * 걸러내는 문자는 앱의 `sanitizeDisplayName` 과 같은 이유다 — 제어문자는 로그를 깨고,
 * 제로폭·양방향 문자는 눈에 안 보이는 채로 다른 이름을 만들어 사칭에 쓰인다.
 * 양방향은 **방향 표식(U+061C ALM · U+200E LRM · U+200F RLM)까지** 포함한다 —
 * 삽입/오버라이드(U+202A~)·격리(U+2066~)만 막으면 표식으로 같은 일을 할 수 있다(Codex #672 P2). 이름은 다른
 * 사용자에게 노출된다(가족 멤버 목록·알람 보낸사람·공유 목소리 소유자).
 * 따옴표·하이픈 같은 정당한 문장부호는 남긴다 — SQL 은 `?`-바인딩이 막는다.
 */
export const DISPLAY_NAME_MAX_LENGTH = 30;

/**
 * 목소리 프로필 이름 상한. 계정 닉네임(30)과 **일부러 다르다** — 이건 사람 이름이 아니라
 * 라벨이라("엄마 목소리(2024년 녹음)") 조금 길게 둔다. 반면 **글자 규칙은 같다**
 * (`normalizeDisplayName` — 제어문자·제로폭·양방향 문자 제거, 줄바꿈→공백).
 * 값이 여기 한 곳에만 있어야 앱·서버가 갈라지지 않는다.
 */
export const VOICE_NAME_MAX_LENGTH = 50;

// eslint-disable-next-line no-control-regex -- 제어문자를 **일부러** 매칭한다. 걸러내는 게 목적이다.
const INVISIBLE_RE = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\uFEFF\u202A-\u202E\u2066-\u2069]/g;

export function normalizeDisplayName(raw: string): string {
  return (
    raw
      // 줄바꿈·탭은 지우지 않고 공백으로 — 지우면 없던 한 단어가 만들어진다.
      .replace(/[\r\n\t]/g, ' ')
      .replace(INVISIBLE_RE, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * 정리한 뒤 상한까지 자른다. **거부가 아니라 다듬기**가 필요한 곳에서 쓴다 —
 * 사용자가 직접 입력한 값은 스키마로 거부해 알려 주지만, 구글이 준 이름이나 옛 스키마로
 * 저장된 값은 거부해 봐야 알려 줄 사람이 없어 로그인이 막힐 뿐이다.
 *
 * `slice` 를 그냥 쓰면 안 된다. JS 문자열 길이는 UTF-16 코드 유닛이라, 29자 뒤에 이모지가
 * 오면 30에서 자를 때 **서러게이트 쌍의 앞쪽 절반만 남는다.** 그 깨진 문자가 DB·JWT·응답에
 * 그대로 실려 나간다. 경계가 쌍 한가운데면 그 글자를 통째로 버린다(Codex #671 P2).
 */
export function clampDisplayName(raw: string): string {
  const normalized = normalizeDisplayName(raw);
  if (normalized.length <= DISPLAY_NAME_MAX_LENGTH) return normalized;
  const cut = normalized.slice(0, DISPLAY_NAME_MAX_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  const cutsSurrogatePair = last >= 0xd800 && last <= 0xdbff;
  return cutsSurrogatePair ? cut.slice(0, -1) : cut;
}

export const DisplayNameSchema = z
  .string()
  .transform(normalizeDisplayName)
  .refine((v) => v.length >= 1 && v.length <= DISPLAY_NAME_MAX_LENGTH, {
    message: `name must be 1-${DISPLAY_NAME_MAX_LENGTH} characters`,
  });

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: PasswordSchema,
  email_verification_code: EmailVerificationCodeSchema,
  name: DisplayNameSchema,
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

// Sign in with Apple. 앱이 `ASAuthorizationAppleIDCredential` 에서 얻은 값을 그대로 보낸다.
//
// - `identity_token`: 애플이 서명한 JWT. 서버가 애플 공개키(JWKS)로 검증한다.
// - `nonce`: 앱이 만든 원본 nonce 의 **SHA-256 hex**. 재생 공격 방지용이라 선택이지만
//   앱은 항상 보내야 한다(옛 iOS 코드의 `NonceGenerator.swift` 가 이 값을 만든다).
// - `full_name`: 애플은 이름을 **최초 1회 로그인에만** 준다. 그 뒤로는 영영 안 준다.
//   그래서 앱이 받은 그 순간 서버로 보내야 하고, 없으면 없는 대로 진행한다.
//   서버는 이 값도 외부 입력으로 취급해 `clampDisplayName` 을 통과시킨다.
// - `authorization_code`: 탈퇴 때 애플 연결을 끊으려면 refresh token 이 필요하고, 그걸
//   얻는 유일한 재료가 이 코드다(**5분·1회용**이라 로그인 순간에 바로 교환해야 한다).
//   옛 앱은 안 보내므로 optional 이다 — 없으면 폐기 없이 로그인만 된다.
export const AppleLoginRequestSchema = z.object({
  identity_token: z.string().min(1),
  nonce: z.string().min(1).max(256).optional(),
  full_name: z.string().max(256).optional(),
  authorization_code: z.string().min(1).max(2048).optional(),
});
export type AppleLoginRequest = z.infer<typeof AppleLoginRequestSchema>;
