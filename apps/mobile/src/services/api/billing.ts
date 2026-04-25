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

// ===== Subscription API =====

export interface SubscriptionPlan {
  id: string;
  key: string;
  name: string;
  plan_type: string;
  period_days: number;
  max_members: number;
  price_krw: number;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  plan_group_id: string | null;
  status: string;
  starts_at: string;
  expires_at: string;
}

export async function getSubscription() {
  return get<{ subscription: Subscription | null; plan: SubscriptionPlan | null }>(
    '/billing/subscription',
  );
}

export interface CheckoutResult {
  success: true;
  checkout_stub: true;
  subscription: Subscription;
  plan: SubscriptionPlan;
  plan_group: { id: string; owner_user_id: string; max_members: number } | null;
  voucher: { id: string; code: string; expires_at: string };
}

export async function checkout(planKey: string) {
  return post<CheckoutResult>('/billing/checkout', { plan_key: planKey });
}
