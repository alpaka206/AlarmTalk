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
 * 탈퇴로 목소리가 철회된 받은-알람. 수신자 기기가 **즉시** 걷어내도록 커밋 후 push 를
 * 보내야 해서, 행이 지워지기 전에 모아 호출부로 돌려준다.
 * (`notifyDowngradedAlarms` 의 target 형태 그대로 — 수신자당 한 번으로 접어 보낸다.)
 */
export type RevokedRecipientTarget = {
  alarmId: string;
  ownerUserId: string;
  isReceived: boolean;
};

/**
 * 사용자 계정과 모든 관련 데이터를 영구 삭제한다. DELETE /user/me 핸들러와 탈퇴 유예
 * cron 양쪽에서 재사용한다. SQL 발행 순서는 기존 핸들러와 동일하게 유지한다.
 *
 * 반환값은 **커밋 후에** 알려야 할 수신자 목록이다(트랜잭션 안에서 push 를 보내면
 * 롤백될 수 있는 변경을 미리 알리게 된다).
 */
export async function purgeUserAccount(
  tx: DbExecutor,
  userPk: string | null,
  // 토큰이 담고 있던 로그인 식별자. 통일 이전에 user_id 컬럼에 이 값이 저장된 자식
  // 데이터까지 지우려면 users.id 와 함께 넘겨야 한다(같은 값이면 자연히 한 벌로 동작).
  userLoginId: string,
): Promise<RevokedRecipientTarget[]> {
  // userPk(users.id) 를 해석하지 못한 채 진행하면 PK 로 연결된 자식 PII(클론 음성·
  // 결제 등)가 고아로 남는다. 사용자 행이 실제로 존재하는데 userPk 만 null 이면
  // 해석 실패이므로 소리 없이 users 만 지우지 말고 throw 해 호출부에서 롤백되게 한다.
  if (!userPk) {
    const orphanGuard = await tx.execute({
      sql: `SELECT id FROM users WHERE google_id = ? OR id = ? LIMIT 1`,
      args: [userLoginId, userLoginId],
    });
    if (orphanGuard.rows.length > 0) {
      throw new Error(
        `purgeUserAccount: userPk unresolved for existing user (loginId=${userLoginId}); aborting to avoid orphaning child PII`,
      );
    }
  }
  const revokedTargets: RevokedRecipientTarget[] = [];
  if (userPk) {
    // 중복을 제거하지 않는다. 아래 DELETE 들이 `IN (?, ?)` 로 개수를 고정해 두고 있어서,
    // 두 값이 같을 때(=정규화 이후의 일반적인 경우) 하나로 줄이면 바인딩 개수가 어긋나
    // 트랜잭션이 통째로 롤백되고 DELETE /user/me 가 500 이 된다.
    const userIds = [userPk, userLoginId];
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
      args: [userPk, userLoginId],
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
    // 이 사람이 **남에게 보낸** 알람은 지우기 전에 수신자 쪽에 철회 기록을 남긴다.
    // 안 남기면 수신자 기기는 '보낸 사람이 알람 하나를 지웠다'(=내 알람은 남긴다)와
    // 구분하지 못해, 탈퇴한 사람의 복제 목소리가 그 기기에서 계속 울린다.
    // 기록을 보면 수신자 앱이 목소리만 걷어내고 알람은 남긴다(RemoteAlarmPullSyncService).
    //
    // 알릴 대상은 행이 지워지기 전에 뽑아 둔다. 기록만 남기고 알리지 않으면 수신자가
    // 백그라운드일 때 다음 주기 pull 까지 탈퇴자의 목소리로 계속 울린다 — 파기 요구가
    // 걸린 생체정보를 폴백 주기만큼 더 들고 있게 된다.
    const revoked = await tx.execute({
      sql: `SELECT a.id AS alarm_id, a.target_user_id AS recipient_user_id
              FROM alarms a
             WHERE a.user_id IN (?, ?)
               AND a.target_user_id IS NOT NULL
               AND a.target_user_id NOT IN (?, ?)`,
      args: [...userIds, ...userIds],
    });
    for (const row of revoked.rows) {
      revokedTargets.push({
        alarmId: String(row.alarm_id),
        ownerUserId: String(row.recipient_user_id),
        isReceived: true,
      });
    }
    await tx.execute({
      sql: `INSERT INTO alarm_recipient_state
              (alarm_id, recipient_user_id, declined, revoked, created_at, updated_at)
            SELECT a.id, a.target_user_id, 0, 1, datetime('now'), datetime('now')
              FROM alarms a
             WHERE a.user_id IN (?, ?)
               AND a.target_user_id IS NOT NULL
               AND a.target_user_id NOT IN (?, ?)
            ON CONFLICT(alarm_id, recipient_user_id)
              DO UPDATE SET revoked = 1, updated_at = datetime('now')`,
      args: [...userIds, ...userIds],
    });
    await tx.execute({
      sql: `DELETE FROM alarms
            WHERE user_id IN (?, ?) OR target_user_id IN (?, ?)`,
      args: [...userIds, ...userIds],
    });
    // **내 클론 목소리를 쓰던 남의 알람도 목소리를 잃는다.**
    //
    // 위 철회 기록은 '내가 보낸 알람' 만 덮는다. 그런데 같은 플랜 그룹에서 내 목소리를 공유
    // 받은 사람은 **자기 알람**에 내 클론을 골라 뒀을 수 있다. 그 알람은 내 알람이 아니라
    // 지워지지 않고, 그 기기는 캐시된 녹음으로 계속 울린다 — 파기 대상인 내 생체정보다.
    // 서버 행을 알람음으로 내리고(아래 UPDATE), 주인들에게 알려 기기에서도 걷어내게 한다
    // (isReceived=false → voice_access_revoked → VoiceAccessSyncWorker).
    //
    // 여긴 `DELETE FROM alarms` **뒤**라 내 알람은 이미 없다 — 남의 알람만 남는다.
    // messages·voice_profiles 는 아직 살아 있어야 하므로 그 삭제보다는 **앞**이어야 한다.
    const cloneProfiles = await tx.execute({
      // is_system 이 시스템/클론을 가르는 유일한 컬럼이다(paid-voice-cleanup.ts 와 같은 기준).
      sql: `SELECT id FROM voice_profiles
            WHERE user_id IN (?, ?) AND COALESCE(is_system, 0) = 0`,
      args: userIds,
    });
    const cloneIds = cloneProfiles.rows.map((row) => String(row.id));
    if (cloneIds.length > 0) {
      const cph = cloneIds.map(() => '?').join(', ');
      const sharedScope = `voice_profile_id IN (${cph})
             OR message_id IN (SELECT id FROM messages WHERE voice_profile_id IN (${cph}))`;
      const sharedArgs = [...cloneIds, ...cloneIds];
      const sharedVoiceAlarms = await tx.execute({
        sql: `SELECT id, COALESCE(target_user_id, user_id) AS owner_user_id,
                     target_user_id IS NOT NULL AS is_received
                FROM alarms
               WHERE ${sharedScope}`,
        args: sharedArgs,
      });
      for (const row of sharedVoiceAlarms.rows) {
        revokedTargets.push({
          alarmId: String(row.id),
          ownerUserId: String(row.owner_user_id),
          isReceived: Number(row.is_received) === 1,
        });
      }
      await tx.execute({
        sql: `UPDATE alarms
              SET mode = 'sound-only', wake_mode = 'sound_then_voice',
                  message_id = NULL, voice_profile_id = NULL
              WHERE ${sharedScope}`,
        args: sharedArgs,
      });
    }
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
      args: [userPk, userLoginId],
    });
  }

  await tx.execute({
    sql: `DELETE FROM users WHERE id = ? OR google_id = ?`,
    args: [userPk ?? userLoginId, userLoginId],
  });

  return revokedTargets;
}
