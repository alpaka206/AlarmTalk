import type { DbExecutor } from './transactions';
import { cancelActiveSubscriptionsForUser } from './billing-cancel';
import { enqueueUserVoiceArtifacts } from './audio-retention';

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
  // 결제 금액(plans.price_krw)을 함께 보존해 전자상거래법상 '대금결제 기록'이 완전해지도록 한다.
  const subs = await tx.execute({
    sql: `SELECT s.id, s.plan_id, s.status, s.starts_at, s.expires_at, p.price_krw
          FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
          WHERE s.user_id = ?`,
    args: [userPk],
  });
  for (const row of subs.rows) {
    await tx.execute({
      sql: `INSERT INTO retained_billing_records
              (id, pseudonym, plan_id, status, starts_at, expires_at, amount_krw, retained_reason, retain_until)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'ecommerce_act_5y', ?)`,
      args: [
        crypto.randomUUID(),
        pseudonym,
        (row.plan_id as string | null) ?? null,
        (row.status as string | null) ?? null,
        (row.starts_at as string | null) ?? null,
        (row.expires_at as string | null) ?? null,
        row.price_krw != null ? Number(row.price_krw) : null,
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
  // userPk(users.id) 를 해석하지 못한 채 진행하면 PK 로 연결된 자식 PII(클론 음성·
  // 결제 등)가 고아로 남는다. 사용자 행이 실제로 존재하는데 userPk 만 null 이면
  // 해석 실패이므로 소리 없이 users 만 지우지 말고 throw 해 호출부에서 롤백되게 한다.
  if (!userPk) {
    const orphanGuard = await tx.execute({
      sql: `SELECT id FROM users WHERE google_id = ? OR id = ? LIMIT 1`,
      args: [userId, userId],
    });
    if (orphanGuard.rows.length > 0) {
      throw new Error(
        `purgeUserAccount: userPk unresolved for existing user (userId=${userId}); aborting to avoid orphaning child PII`,
      );
    }
  }
  if (userPk) {
    const userIds = [userPk, userId];
    // 클론 voice/R2 오디오의 외부 삭제 참조를 행 삭제 *전에* 큐에 적재한다.
    // 실제 삭제는 cron 의 drainExternalDeletions 가 수행 (GDPR/개인정보보호법 잔존 방지).
    await enqueueUserVoiceArtifacts(tx, userIds);
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
    // 결제 검증 원본(store_transactions)도 함께 파기한다. user_id(원본 식별자)가 남으면
    // 가명보존(retained_billing_records) 설계를 우회해 탈퇴자 직접식별자가 잔존한다
    // (개인정보보호법 제21조). 보존이 필요한 거래 사실은 위 가명보존 레코드가 담는다.
    await tx.execute({
      sql: `DELETE FROM store_transactions WHERE user_id IN (?, ?)`,
      args: [userPk, userId],
    });

    await tx.execute({
      sql: `DELETE FROM push_tokens WHERE user_id = ?`,
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
      sql: `DELETE FROM messages WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    await tx.execute({
      sql: `DELETE FROM voice_prerender_queue WHERE owner_user_id IN (?, ?)`,
      args: userIds,
    });
    await tx.execute({
      sql: `DELETE FROM voice_draft_attempt_usage WHERE owner_user_id IN (?, ?)`,
      args: userIds,
    });
    await tx.execute({
      sql: `DELETE FROM voice_profile_change_ledger WHERE owner_user_id IN (?, ?)`,
      args: userIds,
    });
    // 관계/호칭 행은 voice_profiles FK 라 프로필 삭제 전에 지운다 — 내 행과,
    // '내 프로필'을 참조하는 타인 행(공유 보이스 뷰어 호칭) 모두.
    await tx.execute({
      sql: `DELETE FROM voice_profile_relationships
            WHERE user_id IN (?, ?)
               OR voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (?, ?))`,
      args: [...userIds, ...userIds],
    });
    await tx.execute({
      sql: `DELETE FROM voice_profiles WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    await tx.execute({
      sql: `DELETE FROM user_consents WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    // FK 는 없지만 사용자 식별자가 남는 테이블들 — 개인정보 파기 범위에 포함한다.
    await tx.execute({
      sql: `DELETE FROM alarm_recipient_state WHERE recipient_user_id IN (?, ?)`,
      args: userIds,
    });
    await tx.execute({
      sql: `DELETE FROM promo_code_redemptions WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    await tx.execute({
      sql: `DELETE FROM paid_voice_retention WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    // 인증 코드(이메일 키)는 users 행 삭제 전에 이메일을 역참조해 지운다.
    await tx.execute({
      sql: `DELETE FROM email_verification_codes
            WHERE email IN (SELECT email FROM users WHERE id = ? OR google_id = ?)`,
      args: [userPk, userId],
    });
  }

  await tx.execute({
    sql: `DELETE FROM users WHERE id = ? OR google_id = ?`,
    args: [userPk ?? userId, userId],
  });
}
