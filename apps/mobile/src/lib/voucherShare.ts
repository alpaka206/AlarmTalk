import type { TFunction } from 'i18next';

export type VoucherStatus = 'issued' | 'used' | 'expired';

export interface VoucherLite {
  code: string;
  status: string;
  expires_at: string;
}

const VOUCHER_CODE_RE = /^VA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function maskVoucherCode(code: string): string {
  if (!VOUCHER_CODE_RE.test(code)) return code;
  const groups = code.split('-');
  return `${groups[0]}-${groups[1]}-****-****`;
}

export function formatVoucherStatus(status: string, t: TFunction): string {
  if (status === 'used') return t('voucher.statusUsed');
  if (status === 'expired') return t('voucher.statusExpired');
  return t('voucher.statusIssued');
}

export function isVoucherRedeemable(voucher: VoucherLite, now: Date = new Date()): boolean {
  if (voucher.status !== 'issued') return false;
  const exp = new Date(voucher.expires_at);
  if (!Number.isFinite(exp.getTime())) return false;
  return exp.getTime() > now.getTime();
}

export interface ShareTextInput {
  code: string;
  planName: string;
  expiresAt: string;
}

export function buildVoucherShareText(input: ShareTextInput, t: TFunction): string {
  const exp = new Date(input.expiresAt);
  const expLabel = Number.isFinite(exp.getTime())
    ? `${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, '0')}-${String(exp.getDate()).padStart(2, '0')}`
    : input.expiresAt;
  return [
    t('voucher.shareTitle'),
    t('voucher.sharePlan', { plan: input.planName }),
    t('voucher.shareCode', { code: input.code }),
    t('voucher.shareExpiry', { date: expLabel }),
    t('voucher.shareInstruction'),
  ].join('\n');
}
