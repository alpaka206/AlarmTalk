// 가족 플랜 초대권 코드 — INV-123456 형식, 10분 만료, 일회용.
// 코드는 탈취 위험을 줄이기 위해 짧은 만료를 두고, 딥링크에 그대로 임베드한다.

export const INVITE_CODE_PREFIX = 'INV';
export const INVITE_CODE_DIGITS = 6;
export const INVITE_CODE_LENGTH = INVITE_CODE_PREFIX.length + 1 + INVITE_CODE_DIGITS;
export const INVITE_TTL_MINUTES = 10;
export const INVITE_WEB_HOST = 'https://voicealarm.pages.dev';
export const INVITE_APP_SCHEME = 'voicealarm';

const INVITE_CODE_RE = /^INV-[0-9]{6}$/;
const LEGACY_INVITE_CODE_RE = /^[0-9]{6}$/;

/** 암호학적 난수로 6자리 숫자 문자열을 생성 (leading zero 허용) */
function generateInviteDigits(): string {
  const bytes = new Uint8Array(INVITE_CODE_DIGITS);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < INVITE_CODE_DIGITS; i++) {
    out += String(bytes[i]! % 10);
  }
  return out;
}

/** 'INV-123456' 형태의 초대권 코드를 생성 */
export function generateInviteCode(): string {
  return `${INVITE_CODE_PREFIX}-${generateInviteDigits()}`;
}

export function normalizeInviteCode(raw: string): string {
  const upper = raw.trim().toUpperCase();
  const compact = upper.replace(/-/g, '');
  const taggedPattern = new RegExp(`^${INVITE_CODE_PREFIX}[0-9]{${INVITE_CODE_DIGITS}}$`);
  if (taggedPattern.test(compact)) {
    return `${INVITE_CODE_PREFIX}-${compact.slice(INVITE_CODE_PREFIX.length)}`;
  }
  return upper;
}

export function isValidInviteCodeFormat(raw: string): boolean {
  const normalized = normalizeInviteCode(raw);
  return INVITE_CODE_RE.test(normalized) || LEGACY_INVITE_CODE_RE.test(normalized);
}

/** 모바일 앱 딥링크 (`voicealarm://invite/INV-123456`) */
export function buildInviteDeepLink(code: string): string {
  return `${INVITE_APP_SCHEME}://invite/${code}`;
}

/** 웹 fallback URL (`https://voicealarm.pages.dev/invite/INV-123456`) */
export function buildInviteWebUrl(code: string): string {
  return `${INVITE_WEB_HOST}/invite/${code}`;
}

/** 초대 만료 시각 (ISO 문자열) — 기본 10분 뒤 */
export function computeInviteExpiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + INVITE_TTL_MINUTES * 60 * 1000).toISOString();
}
