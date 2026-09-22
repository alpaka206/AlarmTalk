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

/**
 * 이메일 **형식 규칙의 단일 출처** — 서버·안드로이드·iOS 가 이 한 줄을 베껴 쓴다.
 *
 * 예전에는 규칙이 셋으로 갈라져 있었다: 서버는 zod 의 `.email()`, 안드로이드는
 * `android.util.Patterns.EMAIL_ADDRESS`, iOS 는 화면 안에 박힌 자체 정규식이었다.
 * 셋 다 "이메일처럼 생겼는가" 를 보지만 **받는 글자가 서로 달랐다.**
 *  - 앱 둘은 로컬 파트에 **아포스트로피를 허용하지 않았다.** 서버는 허용한다 —
 *    그래서 `o'brien@example.com` 으로 가입한 사람은 **앱에서 로그인 자체가
 *    불가능**했다(계정 잠금). CLAUDE.md 「남기는 것: 따옴표·세미콜론·하이픈 —
 *    "O'Brien" 은 정당한 이름이다」와 정면으로 어긋난다.
 *  - 반대로 앱 둘은 `%` 를 허용했는데 서버는 거부한다 — 앱은 통과시키고 서버가
 *    400 으로 잘라, 사용자는 왜 막히는지 모른 채 같은 주소를 다시 친다.
 *
 * ⚠ **이 값은 좁히면 안 된다.** 좁히는 순간 그 형태로 이미 가입한 사람이 로그인을
 * 못 한다. 지금 값은 zod 4.6.2 의 `z.string().email()` 기본 정규식과 **동작이 같고**
 * (`test/schemas.test.ts` 가 로컬·도메인·TLD 조각을 곱한 표로 대조해 고정한다),
 * 이스케이프만 Java/ICU 에서도 같은 뜻이 되도록 `\-` → 클래스 맨 끝 `-` 로 바꿔 적었다.
 *
 * 앱의 짝(**같은 문자열**):
 *  - 안드로이드 `ui/auth/AuthEmail.kt` 의 `AuthEmailPattern`
 *  - iOS `AuthEmailFormat.swift` 의 `AuthEmailFormat.pattern`
 */
export const EMAIL_PATTERN =
  "^(?:[A-Za-z0-9_'+-]+\\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\\.)+[A-Za-z]{2,}$";

const EMAIL_RE = new RegExp(EMAIL_PATTERN);

/**
 * 형식을 보기 **전에** 거치는 정규화. 자동완성·복사붙여넣기가 붙이는 앞뒤 공백과
 * 대문자를 여기서 걷어낸다 — 순서가 뒤집히면 공백 하나에 400 이 난다.
 * 앱의 짝: 안드로이드 `normalizeAuthEmail`, iOS `AuthEmailFormat.normalize`.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 정규화한 값이 [EMAIL_PATTERN] 에 맞는가. 세 구현이 같은 답을 내야 한다. */
export function isValidEmailFormat(value: string): boolean {
  return EMAIL_RE.test(normalizeEmail(value));
}

/**
 * 이메일을 받는 **모든** 요청이 쓰는 스키마. 새 경로가 이메일을 받으면 자체
 * `z.string().email()` 을 쓰지 말고 이걸 가져다 쓴다 — 같은 값에 규칙이 여러 개면
 * 가장 느슨한 경로가 실질 규칙이 된다.
 *
 * `issue.path` 는 계속 필드 한 칸(`['email']`)이다 — 백엔드의
 * `isEmailOnlyValidationFailure` 가 그걸 보고 `AUTH_EMAIL_INVALID` 로 답한다.
 */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => EMAIL_RE.test(value), {
    message: '이메일 주소 형식이 올바르지 않습니다',
  });

export const EmailVerificationRequestSchema = z.object({
  email: EmailSchema,
});
export type EmailVerificationRequest = z.infer<typeof EmailVerificationRequestSchema>;

export const EmailVerificationConfirmRequestSchema = z.object({
  email: EmailSchema,
  code: EmailVerificationCodeSchema,
});
export type EmailVerificationConfirmRequest = z.infer<typeof EmailVerificationConfirmRequestSchema>;

export const PasswordResetRequestSchema = z.object({
  email: EmailSchema,
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetConfirmRequestSchema = z.object({
  email: EmailSchema,
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
  email: EmailSchema,
  password: PasswordSchema,
  email_verification_code: EmailVerificationCodeSchema,
  name: DisplayNameSchema,
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/**
 * 로그인 요청.
 *
 * ⚠ **이메일은 형식을 보기 전에 정규화한다.** `trim()`·`toLowerCase()` 를 `.email()`
 * **앞**에 두는 것이 전부지만, 순서가 뒤집히면 앞뒤 공백 하나에 400 이 난다. 예전에는
 * 여기서 `z.string().email()` 만 보고 정규화는 라우트(`routes/auth.ts`)가 **검증 뒤에**
 * 했다 — 그래서 자동완성·복사붙여넣기가 붙인 공백이나 대문자로 친 주소가 DB 까지
 * 가 보지도 못하고 `AUTH_VALIDATION_FAILED` 로 잘렸다. 가입(`RegisterRequestSchema`)도
 * 라우트에서 `normalizeAuthEmail` 로 같은 값을 만들므로, 저장된 행과 여기서 조회하는
 * 키는 계속 일치한다. 정규화·형식 판정은 이제 [EmailSchema] 한 곳에 있다.
 *
 * 비밀번호는 **존재만 확인한다**(정책 재검증 금지). 로그인에 `PasswordSchema` 를 걸면
 * 규칙을 올린 날 옛 비밀번호를 쓰던 사람이 로그인 자체를 못 하게 되고, 그건 사용자에게
 * "비밀번호가 틀렸다" 로 읽힌다.
 */
export const LoginRequestSchema = z.object({
  email: EmailSchema,
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
