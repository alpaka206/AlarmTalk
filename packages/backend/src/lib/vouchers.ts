// 결제 시 발급되는 초대 코드 — 커플·가족 이용권 합류용(포맷 'INV-XXXX-XXXX-XXXX').
// 시각적 혼동 방지를 위해 0/O/1/I/L 은 제외.
//
// ⚠ **선물 코드('GIFT-')는 2026-10-14 에 없앴다 — 되살리지 말 것.** iOS 1.2.12 가 App Store 심사
// 지침 3.1.1 로 **두 번째** 반려됐다(1.2.11 은 프로모 코드). 선물은 스토어 결제로 샀어도 받는 사람이
// **코드를 쳐서** 유료 기능을 연다 — 애플이 막는 것이 그 '코드로 해제' 다. 종류를 'invite' 하나로
// 줄여 둔 것은 일부러다: 새 발급처가 다른 종류를 넘기면 컴파일이 막는다. 형식 검사도 INV- 만 통과
// 시키므로 옛 선물 행이 `voucher_codes` 에 남아 있어도(이력이라 지우지 않는다) 등록되지 않는다.
// 할인·무료 이용은 스토어 오퍼 코드(App Store 오퍼 코드·Play 프로모션 코드)로 준다.

export type VoucherKind = 'invite';

const VOUCHER_PREFIX: Record<VoucherKind, string> = {
  invite: 'INV',
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

/** 받는 형식은 초대 코드(INV- 4-4-4) 하나뿐이다 — GIFT- 를 다시 넣지 말 것(맨 위 ⚠). */
const VOUCHER_CODE_RE = /^INV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function isValidVoucherCodeFormat(raw: string): boolean {
  return VOUCHER_CODE_RE.test(raw);
}
