// 결제 시 발급되는 공유/선물 코드.
//   - 'invite' 종류: 가족/커플 합류용 (포맷 'INV-XXXX-XXXX-XXXX')
//   - 'gift'   종류: 개인 플랜 선물용  (포맷 'GIFT-XXXX-XXXX-XXXX')
// 시각적 혼동 방지를 위해 0/O/1/I/L 은 제외.

export type VoucherKind = 'invite' | 'gift';

const VOUCHER_PREFIX: Record<VoucherKind, string> = {
  invite: 'INV',
  gift: 'GIFT',
};

const VOUCHER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUP_SIZE = 4;
const GROUP_COUNT = 3;

export interface GeneratedVoucher {
  code: string;
  hash: string;
}

function randomGroup(): string {
  const bytes = new Uint8Array(GROUP_SIZE);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < GROUP_SIZE; i++) {
    out += VOUCHER_ALPHABET[bytes[i]! % VOUCHER_ALPHABET.length]!;
  }
  return out;
}

/** 종류별 평문 코드 생성 */
export function generateVoucherCodePlain(kind: VoucherKind = 'invite'): string {
  const groups: string[] = [];
  for (let i = 0; i < GROUP_COUNT; i++) groups.push(randomGroup());
  return `${VOUCHER_PREFIX[kind]}-${groups.join('-')}`;
}

export async function hashVoucherCode(code: string): Promise<string> {
  const buf = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 평문+해시 페어 생성 — 등록 시 lookup 에 hash 사용, 발급자 UI 는 평문 */
export async function generateVoucherCode(kind: VoucherKind = 'invite'): Promise<GeneratedVoucher> {
  const code = generateVoucherCodePlain(kind);
  const hash = await hashVoucherCode(code);
  return { code, hash };
}

const VOUCHER_CODE_RE = /^(INV|GIFT)-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function isValidVoucherCodeFormat(raw: string): boolean {
  return VOUCHER_CODE_RE.test(raw);
}
