import { get, post } from './core';

// ===== Billing / Voucher API =====

export interface VoucherItem {
  id: string;
  code: string;
  plan_id: string;
  plan_key: string;
  plan_name: string;
  plan_type: string;
  subscription_id: string | null;
  redeemed_by_user_id: string | null;
  status: 'issued' | 'used' | 'expired';
  issued_at: string;
  used_at: string | null;
  expires_at: string;
}

export async function getVouchers() {
  const data = await get<{ vouchers: VoucherItem[] }>('/billing/vouchers');
  return data.vouchers;
}

// ===== Code Registration (Unified) =====

export interface CodeRegisterVoucherResult {
  success: true;
  type: 'voucher';
  subscription: {
    id: string;
    plan_id: string;
    status: string;
    starts_at: string;
    expires_at: string;
  };
  plan: {
    key: string;
    name: string;
    plan_type: string;
    period_days: number;
  };
}

export interface CodeRegisterInviteResult {
  success: true;
  type: 'invite';
  membership: {
    id: string;
    plan_group_id: string;
    role: string;
  };
}

export type CodeRegisterResult = CodeRegisterVoucherResult | CodeRegisterInviteResult;

export async function registerCode(code: string): Promise<CodeRegisterResult> {
  return post<CodeRegisterResult>('/code/register', { code });
}
