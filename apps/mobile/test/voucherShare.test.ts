import {
  maskVoucherCode,
  formatVoucherStatus,
  isVoucherRedeemable,
  buildVoucherShareText,
} from '../src/lib/voucherShare';
import type { TFunction } from 'i18next';

const t = ((key: string, opts?: Record<string, string>) => {
  if (opts) {
    return Object.entries(opts).reduce(
      (s, [k, v]) => s.replace(`{{${k}}}`, v),
      key,
    );
  }
  return key;
}) as TFunction;

describe('maskVoucherCode (mobile)', () => {
  it('첫 그룹만 공개하고 나머지는 ****', () => {
    expect(maskVoucherCode('VA-ABCD-EFGH-JKLM')).toBe('VA-ABCD-****-****');
  });

  it('잘못된 포맷은 원본 반환', () => {
    expect(maskVoucherCode('not-a-code')).toBe('not-a-code');
    expect(maskVoucherCode('')).toBe('');
  });
});

describe('formatVoucherStatus (mobile)', () => {
  it('issued → statusIssued, used → statusUsed, expired → statusExpired', () => {
    expect(formatVoucherStatus('issued', t)).toBe('voucher.statusIssued');
    expect(formatVoucherStatus('used', t)).toBe('voucher.statusUsed');
    expect(formatVoucherStatus('expired', t)).toBe('voucher.statusExpired');
  });
});

describe('isVoucherRedeemable (mobile)', () => {
  const NOW = new Date('2026-04-21T00:00:00Z');

  it('issued + 만료 전 → true', () => {
    expect(
      isVoucherRedeemable(
        { code: 'VA-A-B-C', status: 'issued', expires_at: '2026-05-21T00:00:00Z' },
        NOW,
      ),
    ).toBe(true);
  });

  it('issued 이지만 만료일 지남 → false', () => {
    expect(
      isVoucherRedeemable(
        { code: 'VA-A-B-C', status: 'issued', expires_at: '2026-04-01T00:00:00Z' },
        NOW,
      ),
    ).toBe(false);
  });

  it('used / expired → false', () => {
    expect(
      isVoucherRedeemable(
        { code: 'VA-A-B-C', status: 'used', expires_at: '2026-05-21T00:00:00Z' },
        NOW,
      ),
    ).toBe(false);
    expect(
      isVoucherRedeemable(
        { code: 'VA-A-B-C', status: 'expired', expires_at: '2026-05-21T00:00:00Z' },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('buildVoucherShareText (mobile)', () => {
  it('5줄 공유 텍스트 생성 (i18n 키 기반)', () => {
    const text = buildVoucherShareText({
      code: 'VA-ABCD-EFGH-JKLM',
      planName: '가족',
      expiresAt: '2026-05-21T00:00:00Z',
    }, t);
    const lines = text.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('voucher.shareTitle');
    expect(lines[1]).toBe('voucher.sharePlan');
    expect(lines[2]).toBe('voucher.shareCode');
    expect(lines[3]).toBe('voucher.shareExpiry');
    expect(lines[4]).toBe('voucher.shareInstruction');
  });
});
