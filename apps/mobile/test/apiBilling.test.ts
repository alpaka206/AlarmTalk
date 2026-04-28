jest.mock('../src/services/api/core', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

import { get, post } from '../src/services/api/core';
import {
  getVouchers,
  registerCode,
} from '../src/services/api/billing';
import type {
  VoucherItem,
  CodeRegisterVoucherResult,
  CodeRegisterInviteResult,
} from '../src/services/api/billing';

const mockGet = get as jest.MockedFunction<typeof get>;
const mockPost = post as jest.MockedFunction<typeof post>;

beforeEach(() => jest.clearAllMocks());

describe('Voucher API', () => {
  it('getVouchers → GET /billing/vouchers', async () => {
    const vouchers: VoucherItem[] = [
      {
        id: 'v1',
        code: 'ABC123',
        plan_id: 'p1',
        plan_key: 'personal_30',
        plan_name: 'Personal 30일',
        plan_type: 'personal',
        subscription_id: null,
        redeemed_by_user_id: null,
        status: 'issued',
        issued_at: '2026-01-01T00:00:00Z',
        used_at: null,
        expires_at: '2026-12-31T23:59:59Z',
      },
    ];
    mockGet.mockResolvedValue({ vouchers });

    const result = await getVouchers();

    expect(mockGet).toHaveBeenCalledWith('/billing/vouchers');
    expect(result).toEqual(vouchers);
  });

  it('getVouchers returns empty array', async () => {
    mockGet.mockResolvedValue({ vouchers: [] });

    const result = await getVouchers();

    expect(result).toEqual([]);
  });
});

describe('Code Registration API', () => {
  it('registerCode → POST /code/register with voucher result', async () => {
    const voucherResult: CodeRegisterVoucherResult = {
      success: true,
      type: 'voucher',
      subscription: {
        id: 's1',
        plan_id: 'p1',
        status: 'active',
        starts_at: '2026-01-01',
        expires_at: '2026-01-31',
      },
      plan: {
        key: 'personal_30',
        name: 'Personal 30일',
        plan_type: 'personal',
        period_days: 30,
      },
    };
    mockPost.mockResolvedValue(voucherResult);

    const result = await registerCode('VOUCHER-CODE');

    expect(mockPost).toHaveBeenCalledWith('/code/register', { code: 'VOUCHER-CODE' });
    expect(result.type).toBe('voucher');
    if (result.type === 'voucher') {
      expect(result.subscription.plan_id).toBe('p1');
      expect(result.plan.period_days).toBe(30);
    }
  });

  it('registerCode → POST /code/register with invite result', async () => {
    const inviteResult: CodeRegisterInviteResult = {
      success: true,
      type: 'invite',
      membership: {
        id: 'm1',
        plan_group_id: 'pg1',
        role: 'member',
      },
    };
    mockPost.mockResolvedValue(inviteResult);

    const result = await registerCode('INVITE-CODE');

    expect(mockPost).toHaveBeenCalledWith('/code/register', { code: 'INVITE-CODE' });
    expect(result.type).toBe('invite');
    if (result.type === 'invite') {
      expect(result.membership.role).toBe('member');
    }
  });
});
