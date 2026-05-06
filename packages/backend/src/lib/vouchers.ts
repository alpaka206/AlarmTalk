// 가족/커플 공유 코드(=구 voucher) 생성/해시 — 포맷 'INV-XXXX-XXXX-XXXX' (X = A-Z0-9 혼합, 12자)
// 시각적 혼동 방지를 위해 0/O/1/I/L 은 제외.

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

/** 'INV-XXXX-XXXX-XXXX' 형태 평문 코드 생성 */
export function generateVoucherCodePlain(): string {
  const groups: string[] = [];
  for (let i = 0; i < GROUP_COUNT; i++) groups.push(randomGroup());
  return `INV-${groups.join('-')}`;
}

export async function hashVoucherCode(code: string): Promise<string> {
  const buf = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 평문+해시 페어 생성 — 등록 시 lookup 에 hash 사용, 발급자 UI 는 평문 */
export async function generateVoucherCode(): Promise<GeneratedVoucher> {
  const code = generateVoucherCodePlain();
  const hash = await hashVoucherCode(code);
  return { code, hash };
}

const VOUCHER_CODE_RE = /^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function isValidVoucherCodeFormat(raw: string): boolean {
  return VOUCHER_CODE_RE.test(raw);
}
