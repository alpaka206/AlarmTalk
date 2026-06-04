import type { DbExecutor } from './transactions';
import { cancelActiveSubscriptionsForUser } from './billing-cancel';

const TEXT_ENCODER = new TextEncoder();

/**
 * user_id 를 비가역 가명 키로 변환한다 (개인정보보호법 제2조 가명처리).
 * pseudonym = SHA-256(user_id + salt). salt(=PASSWORD_PEPPER) 없이는 원본을 복원할 수 없다.
 */
export async function pseudonymizeUserId(userId: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    TEXT_ENCODER.encode(`${userId}:${salt ?? ''}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 전자상거래법(계약·결제 기록 5년) 보존을 위해, 영구파기 직전 결제·구독 기록을
 * 가명처리해 분리 테이블(retained_billing_records)로 옮긴다. 직접 식별자는 남기지 않는다.
 */
export async function pseudonymizeBillingForRetention(
  tx: DbExecutor,
  userPk: string,
  salt: string,
  now: Date,
): Promise<void> {
  const pseudonym = await pseudonymizeUserId(userPk, salt);
  const retainUntil = new Date(now.getTime() + 5 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const subs = await tx.execute({
    sql: `SELECT id, plan_id, status, starts_at, expires_at FROM subscriptions WHERE user_id = ?`,
    args: [userPk],
  });
  for (const row of subs.rows) {
    await tx.execute({
      sql: `INSERT INTO retained_billing_records
              (id, pseudonym, plan_id, status, starts_at, expires_at, retained_reason, retain_until)
            VALUES (?, ?, ?, ?, ?, ?, 'ecommerce_act_5y', ?)`,
      args: [
        crypto.randomUUID(),
        pseudonym,
        (row.plan_id as string | null) ?? null,
        (row.status as string | null) ?? null,
        (row.starts_at as string | null) ?? null,
        (row.expires_at as string | null) ?? null,
        retainUntil,
      ],
    });
  }
}

/**
 * 사용자 계정과 모든 관련 데이터를 영구 삭제한다. DELETE /user/me 핸들러와 탈퇴 유예
 * cron 양쪽에서 재사용한다. SQL 발행 순서는 기존 핸들러와 동일하게 유지한다.
 */
export async function purgeUserAccount(
  tx: DbExecutor,
  userPk: string | null,
  userId: string,
): Promise<void> {
  if (userPk) {
    const userIds = [userPk, userId];
    await cancelActiveSubscriptionsForUser(tx, userPk);

    await tx.execute({
      sql: `DELETE FROM voucher_redemptions
            WHERE user_id = ?
               OR voucher_id IN (
                 SELECT id FROM voucher_codes WHERE issuer_user_id = ?
               )`,
      args: [userPk, userPk],
    });
    await tx.execute({
      sql: `UPDATE voucher_codes
            SET redeemed_by_user_id = NULL
            WHERE redeemed_by_user_id = ?`,
      args: [userPk],
    });
    await tx.execute({
      sql: `DELETE FROM voucher_codes WHERE issuer_user_id = ?`,
      args: [userPk],
    });

    await tx.execute({
      sql: `DELETE FROM plan_group_invites
            WHERE inviter_user_id = ?
               OR used_by_user_id = ?
               OR plan_group_id IN (
                 SELECT id FROM plan_groups WHERE owner_user_id = ?
               )`,
      args: [userPk, userPk, userPk],
    });
    await tx.execute({
      sql: `DELETE FROM plan_group_members WHERE user_id = ?`,
      args: [userPk],
    });
    await tx.execute({
      sql: `DELETE FROM plan_group_members
            WHERE plan_group_id IN (SELECT id FROM plan_groups WHERE owner_user_id = ?)`,
      args: [userPk],
    });
    await tx.execute({
      sql: `DELETE FROM plan_groups WHERE owner_user_id = ?`,
      args: [userPk],
    });
    await tx.execute({
      sql: `DELETE FROM subscriptions WHERE user_id = ?`,
      args: [userPk],
    });

    await tx.execute({
      sql: `DELETE FROM notes WHERE sender_id = ? OR receiver_id = ?`,
      args: [userPk, userPk],
    });
    await tx.execute({
      sql: `DELETE FROM push_tokens WHERE user_id = ?`,
      args: [userPk],
    });
    await tx.execute({
      sql: `DELETE FROM character_xp_logs
            WHERE character_id IN (SELECT id FROM characters WHERE user_id = ?)`,
      args: [userPk],
    });
    await tx.execute({
      sql: `DELETE FROM character_stats
            WHERE character_id IN (SELECT id FROM characters WHERE user_id = ?)`,
      args: [userPk],
    });
    await tx.execute({
      sql: `DELETE FROM streak_achievements
            WHERE character_id IN (SELECT id FROM characters WHERE user_id = ?)`,
      args: [userPk],
    });
    await tx.execute({
      sql: `DELETE FROM characters WHERE user_id = ?`,
      args: [userPk],
    });
    await tx.execute({
      sql: `DELETE FROM voice_speakers
            WHERE upload_id IN (SELECT id FROM voice_uploads WHERE user_id = ?)`,
      args: [userPk],
    });
    await tx.execute({
      sql: `DELETE FROM voice_uploads WHERE user_id = ?`,
      args: [userPk],
    });

    await tx.execute({
      sql: `DELETE FROM generated_audio_assets
            WHERE user_id IN (?, ?)
               OR voice_profile_id IN (
                 SELECT id FROM voice_profiles WHERE user_id IN (?, ?)
               )
               OR message_id IN (
                 SELECT id FROM messages WHERE user_id IN (?, ?)
               )`,
      args: [...userIds, ...userIds, ...userIds],
    });
    await tx.execute({
      sql: `DELETE FROM alarms
            WHERE user_id IN (?, ?) OR target_user_id IN (?, ?)`,
      args: [...userIds, ...userIds],
    });
    await tx.execute({
      sql: `DELETE FROM message_library
            WHERE user_id IN (?, ?)
               OR message_id IN (
                 SELECT id FROM messages WHERE user_id IN (?, ?)
               )`,
      args: [...userIds, ...userIds],
    });
    await tx.execute({
      sql: `DELETE FROM gifts
            WHERE sender_id IN (?, ?)
               OR recipient_id IN (?, ?)
               OR message_id IN (
                 SELECT id FROM messages WHERE user_id IN (?, ?)
               )`,
      args: [...userIds, ...userIds, ...userIds],
    });
    await tx.execute({
      sql: `DELETE FROM messages WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    await tx.execute({
      sql: `DELETE FROM voice_profiles WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    await tx.execute({
      sql: `DELETE FROM friendships
            WHERE user_a IN (?, ?) OR user_b IN (?, ?)`,
      args: [...userIds, ...userIds],
    });
    await tx.execute({
      sql: `DELETE FROM user_consents WHERE user_id IN (?, ?)`,
      args: userIds,
    });
  }

  await tx.execute({
    sql: `DELETE FROM users WHERE id = ? OR google_id = ?`,
    args: [userPk ?? userId, userId],
  });
}
