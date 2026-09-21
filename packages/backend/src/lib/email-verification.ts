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

export async function sendEmailVerificationCode(
  env: Env,
  email: string,
  code: string,
): Promise<void> {
  await sendAuthEmail(
    env,
    email,
    'AlarmTalk 이메일 인증 코드',
    `AlarmTalk 인증 코드: ${code}\n10분 안에 입력해 주세요.`,
    `<p>AlarmTalk 인증 코드입니다.</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>10분 안에 입력해 주세요.</p>`,
  );
}

export async function sendPasswordResetCode(
  env: Env,
  email: string,
  code: string,
): Promise<void> {
  await sendAuthEmail(
    env,
    email,
    'AlarmTalk 비밀번호 재설정 코드',
    `AlarmTalk 비밀번호 재설정 코드: ${code}\n10분 안에 입력해 주세요. 본인이 요청하지 않았다면 무시하세요.`,
    `<p>AlarmTalk 비밀번호 재설정 코드입니다.</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>10분 안에 입력해 주세요. 본인이 요청하지 않았다면 무시하세요.</p>`,
  );
}
