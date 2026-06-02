import type { Env } from '../types';

export const EMAIL_VERIFICATION_TTL_SECONDS = 10 * 60;
export const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;

export function normalizeAuthEmail(email: string): string {
  return email.toLowerCase().trim();
}

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

export async function sendEmailVerificationCode(
  env: Env,
  email: string,
  code: string,
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
      subject: 'AlarmTalk 이메일 인증 코드',
      text: `AlarmTalk 인증 코드: ${code}\n10분 안에 입력해 주세요.`,
      html: `<p>AlarmTalk 인증 코드입니다.</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>10분 안에 입력해 주세요.</p>`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Email delivery failed (${res.status})`);
  }
}
