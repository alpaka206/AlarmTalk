// 가족 플랜 초대 코드 — 6자리 숫자 문자열, 10분 만료, 일회용.
// 코드는 탈취 위험을 줄이기 위해 짧은 만료를 두고, 딥링크에 그대로 임베드한다.

export const INVITE_CODE_LENGTH = 6;
export const INVITE_TTL_MINUTES = 10;
export const INVITE_WEB_HOST = 'https://voicealarm.pages.dev';
export const INVITE_APP_SCHEME = 'voicealarm';

const INVITE_CODE_RE = /^[0-9]{6}$/;

/** 암호학적 난수로 6자리 숫자 문자열을 생성 (leading zero 허용) */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += String(bytes[i]! % 10);
  }
  return out;
}

export function isValidInviteCodeFormat(raw: string): boolean {
  return INVITE_CODE_RE.test(raw);
}

/** 모바일 앱 딥링크 (`voicealarm://invite/123456`) */
export function buildInviteDeepLink(code: string): string {
  return `${INVITE_APP_SCHEME}://invite/${code}`;
}

/** 웹 fallback URL (`https://voicealarm.pages.dev/invite/123456`) */
export function buildInviteWebUrl(code: string): string {
  return `${INVITE_WEB_HOST}/invite/${code}`;
}

/** 초대 만료 시각 (ISO 문자열) — 기본 10분 뒤 */
export function computeInviteExpiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + INVITE_TTL_MINUTES * 60 * 1000).toISOString();
}
