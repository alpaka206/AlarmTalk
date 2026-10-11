import { normalizeEmail } from '@alarmtalk/shared';

import type { Env } from '../types';

export const EMAIL_VERIFICATION_TTL_SECONDS = 10 * 60;
export const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
// 재발송 쿨다운: 동일 이메일로 이 시간 안에 이미 코드를 발급했다면 새 코드를
// 보내지 않고(이메일 폭탄/Resend 비용 남용 방지) 기존 코드를 그대로 둔다.
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;
// 동일 이메일 1일 발급 상한(IP 와 무관). 초과 시 추가 발송하지 않는다.
export const EMAIL_VERIFICATION_DAILY_CAP = 10;

/**
 * 이메일 정규화 — 규칙의 **유일 출처는 `@alarmtalk/shared` 의 `normalizeEmail`** 이다.
 *
 * ⚠ **여기에 자체 구현을 다시 두지 말 것.** 예전에는 `toLowerCase().trim()` 이 따로
 * 박혀 있었다. 결과는 같았지만 출처가 둘이라, 한쪽만 고치면 조용히 갈라진다 —
 * `EmailSchema`(요청 검증)와 이 함수(저장·조회 키·코드 해시 입력)가 다른 값을 내는
 * 순간, 검증은 통과하는데 **가입 때 쓴 키와 로그인 때 만드는 키가 달라진다.**
 * 앱의 짝도 같은 규칙이다(안드로이드 `normalizeAuthEmail`, iOS `AuthEmailFormat.normalize`).
 *
 * 이름은 그대로 둔다 — 라우트 5곳(`routes/auth.ts`)과 아래 코드 해시가 이 이름을 부른다.
 */
export const normalizeAuthEmail = normalizeEmail;

export function generateEmailVerificationCode(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0]! % 1_000_000).padStart(6, '0');
}

export async function hashEmailVerificationCode(
  email: string,
  code: string,
  pepper: string,
): Promise<string> {
  const input = `${normalizeAuthEmail(email)}:${code}:${pepper ?? ''}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function emailVerificationExpiresAt(now = Date.now()): string {
  return new Date(now + EMAIL_VERIFICATION_TTL_SECONDS * 1000).toISOString();
}

export function shouldExposeDebugEmailCode(env: Env): boolean {
  return env.ENVIRONMENT !== 'production' && !env.RESEND_API_KEY;
}

async function sendAuthEmail(
  env: Env,
  email: string,
  subject: string,
  text: string,
  html: string,
): Promise<void> {
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) {
    if (env.ENVIRONMENT !== 'production') return;
    throw new Error('Email delivery is not configured');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.AUTH_EMAIL_FROM,
      to: [email],
      reply_to: env.AUTH_EMAIL_REPLY_TO || undefined,
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    throw new Error(`Email delivery failed (${res.status})`);
  }
}

/** 메일 한 통 — 제목과 본문 두 벌(text·html). */
export type AuthMail = { subject: string; text: string; html: string };

type AuthMailLanguage = 'ko' | 'en' | 'ja';
type AuthMailSection = { language: AuthMailLanguage; heading: string; lines: string[] };

// 메일이 말하는 수명은 **실제 TTL** 에서 만든다 — 숫자를 문장에 베끼면 TTL 을 바꾼 날 메일만 옛말을 한다.
const CODE_TTL_MINUTES = Math.round(EMAIL_VERIFICATION_TTL_SECONDS / 60);

/**
 * 세 언어가 함께 말하는 두 줄 — **수명**과 **가장 새 코드만 된다**.
 *
 * 한 통에 한국어·영어·일본어를 함께 쓴다. 코드를 요청할 때 서버는 그 사람의 언어를 모른다
 * (요청에는 주소뿐이다). 예전에는 한국어뿐이었다.
 *
 * '가장 최근 코드만' 은 서버 규칙(`checkEmailVerificationCode` 가 가장 새 줄 하나만 본다)을
 * 사용자가 아는 **유일한 자리**다 — 다시 받은 뒤 앞 메일의 숫자를 넣으면 숫자가 멀쩡해도
 * 거절되고 틀린 횟수로 센다(`docs/spec/session-and-auth.md` 「이메일 인증 코드」).
 */
function codeRuleSections(extra: Record<AuthMailLanguage, string[]>): AuthMailSection[] {
  return [
    {
      language: 'ko',
      heading: '한국어',
      lines: [
        `${CODE_TTL_MINUTES}분 안에 앱에 입력해 주세요.`,
        '가장 최근에 받은 코드만 쓸 수 있어요. 코드를 다시 받았다면 앞의 메일에 있는 코드는 쓸 수 없어요.',
        ...extra.ko,
      ],
    },
    {
      language: 'en',
      heading: 'English',
      lines: [
        `Enter this code in the app within ${CODE_TTL_MINUTES} minutes.`,
        'Only the most recent code works. If you asked for a new code, the code in any earlier email no longer works.',
        ...extra.en,
      ],
    },
    {
      language: 'ja',
      heading: '日本語',
      lines: [
        `${CODE_TTL_MINUTES}分以内にアプリで入力してください。`,
        '使えるのは、最後に届いたコードだけです。コードを再送信した場合、前のメールのコードは使えません。',
        ...extra.ja,
      ],
    },
  ];
}

/**
 * 제목 줄 → (머리말) → 코드 → 언어별 안내. text 와 html 을 **같은 순서**로 만든다 — 메일 앱의
 * 미리보기는 대개 html 의 앞머리에서 뽑으므로, 한쪽만 순서가 다르면 미리보기가 달라진다.
 *
 * ⚠ `code` 는 서버가 만든 숫자 여섯 자다(`generateEmailVerificationCode`). html 에 그대로
 * 들어가므로 사용자 입력을 여기로 넘기지 말 것.
 */
function renderAuthMail(params: {
  subject: string;
  title: string;
  preamble: string[];
  code: string;
  sections: AuthMailSection[];
}): AuthMail {
  const { subject, title, preamble, code, sections } = params;
  const text = [
    title,
    ...preamble,
    '',
    code,
    ...sections.flatMap((section) => ['', `[${section.heading}]`, ...section.lines]),
  ].join('\n');
  const html = [
    `<p>${title}</p>`,
    ...(preamble.length > 0 ? [`<p>${preamble.join('<br>')}</p>`] : []),
    `<p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p>`,
    ...sections.map(
      (section) =>
        `<p lang="${section.language}"><strong>${section.heading}</strong><br>${section.lines.join('<br>')}</p>`,
    ),
  ].join('');
  return { subject, text, html };
}

/**
 * 가입 인증 메일. **제목에 코드를 넣는다.**
 *
 * 예전 제목은 늘 같았다(`AlarmTalk 이메일 인증 코드`) — 같은 제목은 메일 앱이 한 대화로 묶기
 * 쉽고, 묶이면 **먼저 온 메일**이 먼저 보인다(그 숫자는 이미 죽은 코드다). 코드를 넣으면 제목이
 * 메일마다 달라지고, 알림에서 바로 읽힌다. 가입 코드는 아직 없는 계정의 주소 확인이라
 * 알림에 보여도 잃을 것이 없다.
 */
export function buildEmailVerificationMail(code: string): AuthMail {
  return renderAuthMail({
    subject: `AlarmTalk 인증 코드 ${code} · Verification code · 認証コード`,
    title: 'AlarmTalk 인증 코드 · Verification code · 認証コード',
    preamble: [],
    code,
    sections: codeRuleSections({ ko: [], en: [], ja: [] }),
  });
}

/**
 * 비밀번호 재설정 메일. ⚠ **제목에 코드를 넣지 않는다.**
 *
 * 제목은 잠금 화면 알림에 그대로 뜬다. 재설정 코드는 **비밀번호를 바꿀 권한**이라, 잠긴 폰을
 * 잠깐 손에 넣은 사람이 계정을 가져갈 수 있다. 가입 메일과 "같게 맞추자" 며 제목에 코드를
 * 넣지 말 것(`docs/spec/session-and-auth.md` 「메일」).
 *
 * 같은 이유로 본문도 코드로 **시작하지 않는다** — 알림의 미리보기는 본문 앞머리를 함께 보여
 * 주는 경우가 많다. 세 언어의 머리말 한 줄씩을 코드 앞에 둔다. (미리보기 길이는 메일 앱마다
 * 달라 이것으로 가려진다고 보장하지는 못한다 — 제목처럼 확실한 자리만은 비워 두는 것이다.)
 */
export function buildPasswordResetMail(code: string): AuthMail {
  const title = 'AlarmTalk 비밀번호 재설정 코드 · Password reset code · パスワード再設定コード';
  return renderAuthMail({
    subject: title,
    title,
    preamble: [
      '비밀번호를 다시 정하려면 아래 코드를 앱에 입력해 주세요.',
      'To reset your password, enter the code below in the app.',
      'パスワードを再設定するには、下のコードをアプリに入力してください。',
    ],
    code,
    sections: codeRuleSections({
      ko: ['본인이 요청하지 않았다면 이 메일은 무시해 주세요.'],
      en: ["If you didn't request this, you can ignore this email."],
      ja: ['お心当たりがない場合は、このメールを無視してください。'],
    }),
  });
}

export async function sendEmailVerificationCode(
  env: Env,
  email: string,
  code: string,
): Promise<void> {
  const mail = buildEmailVerificationMail(code);
  await sendAuthEmail(env, email, mail.subject, mail.text, mail.html);
}

export async function sendPasswordResetCode(
  env: Env,
  email: string,
  code: string,
): Promise<void> {
  const mail = buildPasswordResetMail(code);
  await sendAuthEmail(env, email, mail.subject, mail.text, mail.html);
}
