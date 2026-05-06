import type { DbExecutor } from './transactions';
import { generateVoucherCode, type VoucherKind } from './vouchers';

export interface IssuedVoucherCode {
  id: string;
  code: string;
  max_uses: number;
  use_count: number;
  expires_at: string;
}

export async function issueVoucherCode(
  db: DbExecutor,
  params: {
    kind: VoucherKind;
    planId: string;
    issuerUserId: string;
    issuerSubscriptionId: string | null;
    issuedAt: string;
    expiresAt: string;
    maxUses: number;
  },
): Promise<IssuedVoucherCode> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const voucherId = crypto.randomUUID();
    const { code, hash } = await generateVoucherCode(params.kind);
    const result = await db.execute({
      sql: `INSERT OR IGNORE INTO voucher_codes
            (id, code, code_hash, plan_id, issuer_user_id, issuer_subscription_id,
             status, issued_at, expires_at, max_uses)
            VALUES (?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)`,
      args: [
        voucherId,
        code,
        hash,
        params.planId,
        params.issuerUserId,
        params.issuerSubscriptionId,
        params.issuedAt,
        params.expiresAt,
        params.maxUses,
      ],
    });
    if (result.rowsAffected > 0) {
      return {
        id: voucherId,
        code,
        max_uses: params.maxUses,
        use_count: 0,
        expires_at: params.expiresAt,
      };
    }
  }
  throw new Error('Failed to generate a unique voucher code');
}
