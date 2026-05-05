// 가족 플랜 초대권 코드 — INV-XXXX-XXXX-XXXX 형식, 10분 만료, 일회용.
// 코드는 탈취 위험을 줄이기 위해 짧은 만료를 두고, 딥링크에 그대로 임베드한다.

export const INVITE_CODE_PREFIX = 'INV';
export const INVITE_CODE_GROUP_SIZE = 4;
export const INVITE_CODE_GROUP_COUNT = 3;
export const INVITE_CODE_LENGTH =
  INVITE_CODE_PREFIX.length +
  1 +
  INVITE_CODE_GROUP_COUNT * INVITE_CODE_GROUP_SIZE +
  (INVITE_CODE_GROUP_COUNT - 1);
export const INVITE_TTL_MINUTES = 10;
export const INVITE_WEB_HOST = 'https://voicealarm.pages.dev';
export const INVITE_APP_SCHEME = 'voicealarm';

const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_CODE_RE = /^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const LEGACY_TAGGED_INVITE_CODE_RE = /^INV-[0-9]{6}$/;
const LEGACY_INVITE_CODE_RE = /^[0-9]{6}$/;

function generateInviteGroup(): string {
  const bytes = new Uint8Array(INVITE_CODE_GROUP_SIZE);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < INVITE_CODE_GROUP_SIZE; i++) {
    out += INVITE_ALPHABET[bytes[i]! % INVITE_ALPHABET.length]!;
  }
  return out;
}

/** 'INV-XXXX-XXXX-XXXX' 형태의 초대권 코드를 생성 */
export function generateInviteCode(): string {
  const groups: string[] = [];
  for (let i = 0; i < INVITE_CODE_GROUP_COUNT; i++) {
    groups.push(generateInviteGroup());
  }
  return `${INVITE_CODE_PREFIX}-${groups.join('-')}`;
}

export function normalizeInviteCode(raw: string): string {
  const upper = raw.trim().toUpperCase();
  const compact = upper.replace(/-/g, '');
  const taggedPattern = new RegExp(
    `^${INVITE_CODE_PREFIX}[A-Z0-9]{${INVITE_CODE_GROUP_COUNT * INVITE_CODE_GROUP_SIZE}}$`,
  );
  if (taggedPattern.test(compact)) {
    const body = compact.slice(INVITE_CODE_PREFIX.length);
    const groups: string[] = [];
    for (let i = 0; i < INVITE_CODE_GROUP_COUNT; i++) {
      const start = i * INVITE_CODE_GROUP_SIZE;
      groups.push(body.slice(start, start + INVITE_CODE_GROUP_SIZE));
    }
    return `${INVITE_CODE_PREFIX}-${groups.join('-')}`;
  }
  const legacyTaggedPattern = new RegExp(`^${INVITE_CODE_PREFIX}[0-9]{6}$`);
  if (legacyTaggedPattern.test(compact)) {
    return `${INVITE_CODE_PREFIX}-${compact.slice(INVITE_CODE_PREFIX.length)}`;
  }
  return upper;
}

export function isValidInviteCodeFormat(raw: string): boolean {
  const normalized = normalizeInviteCode(raw);
  return (
    INVITE_CODE_RE.test(normalized) ||
    LEGACY_TAGGED_INVITE_CODE_RE.test(normalized) ||
    LEGACY_INVITE_CODE_RE.test(normalized)
  );
}

/** 모바일 앱 딥링크 (`voicealarm://invite/INV-XXXX-XXXX-XXXX`) */
export function buildInviteDeepLink(code: string): string {
  return `${INVITE_APP_SCHEME}://invite/${code}`;
}

/** 웹 fallback URL (`https://voicealarm.pages.dev/invite/INV-XXXX-XXXX-XXXX`) */
export function buildInviteWebUrl(code: string): string {
  return `${INVITE_WEB_HOST}/invite/${code}`;
}

/** 초대 만료 시각 (ISO 문자열) — 기본 10분 뒤 */
export function computeInviteExpiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + INVITE_TTL_MINUTES * 60 * 1000).toISOString();
}
