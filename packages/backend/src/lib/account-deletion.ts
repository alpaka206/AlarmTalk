import type { DbExecutor } from './transactions';
import { cancelActiveSubscriptionsForUser } from './billing-cancel';
import { enqueueUserVoiceArtifacts } from './audio-retention';
import { revokeDeletedVoices } from './voice-revocation';

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

/** 탈퇴 커밋 후 보내야 할 알림. 그대로 `notifyDowngradedAlarms` 의 3·4번째 인자다. */
export type AccountPurgeNotifications = {
  /** 서버 알람 행에서 찾은 강등 대상. 받은 알람이면 pull, 본인 알람이면 접근권 재확인. */
  downgradedAlarms: RevokedRecipientTarget[];
  /**
   * 서버 알람 행과 **무관하게** 목소리 접근권을 잃은 계정들.
   *
   * 알람은 로컬이 원본이라, 아직 서버로 동기화되지 않은 알람은 위 목록에 안 잡힌다.
   * 그런데 발사는 로컬이고 울림 시점 게이트도 이 경우를 못 봐서, 그 기기는 탈퇴자의
   * 녹음으로 계속 울린다. 그래서 **내 목소리를 볼 수 있었던 사람 전부**에게 알린다.
   */
  voiceAccessRevokedUserIds: string[];
};

/**
 * 사용자 계정과 모든 관련 데이터를 영구 삭제한다. DELETE /user/me 핸들러와 탈퇴 유예
 * cron 양쪽에서 재사용한다. SQL 발행 순서는 기존 핸들러와 동일하게 유지한다.
 *
 * 반환값은 **커밋 후에** 보내야 할 알림이다(트랜잭션 안에서 push 를 보내면 롤백될 수
 * 있는 변경을 미리 알리게 된다).
 */
export async function purgeUserAccount(
  tx: DbExecutor,
  userPk: string | null,
  // 토큰이 담고 있던 로그인 식별자. 통일 이전에 user_id 컬럼에 이 값이 저장된 자식
  // 데이터까지 지우려면 users.id 와 함께 넘겨야 한다(같은 값이면 자연히 한 벌로 동작).
  userLoginId: string,
): Promise<AccountPurgeNotifications> {
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
  const voiceAccessRevokedUserIds: string[] = [];
  if (userPk) {
    // 중복을 제거하지 않는다. 아래 DELETE 들이 `IN (?, ?)` 로 개수를 고정해 두고 있어서,
    // 두 값이 같을 때(=정규화 이후의 일반적인 경우) 하나로 줄이면 바인딩 개수가 어긋나
    // 트랜잭션이 통째로 롤백되고 DELETE /user/me 가 500 이 된다.
    const userIds = [userPk, userLoginId];
    // 클론 voice/R2 오디오의 외부 삭제 참조를 행 삭제 *전에* 큐에 적재한다.
    // 실제 삭제는 cron 의 drainExternalDeletions 가 수행 (GDPR/개인정보보호법 잔존 방지).
    await enqueueUserVoiceArtifacts(tx, userIds);
    await cancelActiveSubscriptionsForUser(tx, userPk);

    // **파기할 내 클론 목록.** 탈퇴가 남에게 미치는 영향은 전부 이 목록에서 나온다.
    // 클론이 하나도 없으면 파기할 생체정보가 없으니 아무도 안 깨운다.
    //
    // 뽑는 시점이 중요하다 — 아래에서 plan_group_members·plan_groups 를 지우고 나면
    // '누가 내 목소리를 쓸 수 있었는지' 를 알 방법이 없어진다. 그래서 그룹 해체 **전에**
    // `revokeDeletedVoices` 를 부른다(그 함수가 동석 멤버를 조회한다).
    const cloneProfiles = await tx.execute({
      // is_system 이 시스템/클론을 가르는 유일한 컬럼이다(paid-voice-cleanup.ts 와 같은 기준).
      sql: `SELECT id FROM voice_profiles
            WHERE user_id IN (?, ?) AND COALESCE(is_system, 0) = 0`,
      args: userIds,
    });
    const cloneIds = cloneProfiles.rows.map((row) => String(row.id));

    // ── 탈퇴가 남에게 미치는 영향은 **내 목소리가 사라지는 것** 하나다 ──────────────
    //
    // 예전에는 여기에 탈퇴 전용 갈래가 있었다: 내가 **보낸 알람 전부**를 목소리와 무관하게
    // 철회하고, 이미 지운 알람도 `sender_user_id` 표식으로 찾아 함께 철회했다. 그건 두 가지를
    // 뭉뚱그린 것이다 — 파기해야 할 것은 **내 생체정보(녹음)** 이지 남의 기상 시각이 아니다.
    // 기본 목소리로 보낸 알람에는 파기할 내 데이터가 없고, 받은 순간부터 그 알람은 받은
    // 사람 것이다(`docs/spec/family-alarm.md`).
    //
    // 그래서 판정을 **목소리 하나로** 모았다. 목소리 삭제·플랜 강등과 **같은 함수**가 돈다
    // (`lib/voice-revocation.ts`) — 같은 사건이므로 결과도 같아야 한다.
    //
    // ⚠ **자리를 옮기지 말 것.** 아래 세 가지보다 모두 앞이어야 한다:
    //   plan_group_members 삭제(누가 내 목소리를 볼 수 있었는지 알 수 없게 된다),
    //   `DELETE FROM alarms`(아직 수신 확인 전인 내 보낸 알람의 tombstone 을 여기서 남긴다),
    //   messages·voice_profiles 삭제(조회 대상이 사라진다).
    const revocation = await revokeDeletedVoices(tx, {
      voiceProfileIds: cloneIds,
      ownerUserIds: userIds,
      // 내 기기는 곧 사라진다 — 나에게 보내는 철회 푸시는 받을 사람이 없다.
      excludeOwnerUserIds: userIds,
    });
    revokedTargets.push(...revocation.downgradedAlarms);
    voiceAccessRevokedUserIds.push(...revocation.voiceAccessRevokedUserIds);

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
    // **보낸이 식별자는 지운다** — 탈퇴자의 직접 식별자를 남기지 않는다(개인정보보호법
    // 제21조). 이 행 자체는 수신자 것이라 남는다. 철회 여부는 위에서 목소리 기준으로 이미
    // 정해졌으므로 여기서 `revoked` 는 건드리지 않는다.
    await tx.execute({
      sql: `UPDATE alarm_recipient_state
               SET sender_user_id = NULL, updated_at = datetime('now')
             WHERE sender_user_id IN (?, ?)`,
      args: userIds,
    });
    // ⚠ **내가 만든 행만 지운다**(2026-08-24 축소). 예전에는 `target_user_id IN (나)` 까지
    // 지워서 **남이 나에게 보낸 행**(주인은 발신자)을 함께 없앴다. 그 행에는 내 목소리가
    // 없고(발신자 목소리이거나 기본 목소리) 내 데이터도 아니다 — 탈퇴가 파기해야 할 것은
    // **내 생체정보**이지 남의 발신 기록이 아니다. 지우면 발신자 쪽 같은 시각 슬롯 이력까지
    // 조용히 사라진다.
    //
    // 이 DELETE 자체는 뺄 수 없다 — `alarms.user_id` 가 `users(id)` FK 라, 내 행을 남기면
    // 아래 `DELETE FROM users` 가 FK 로 실패해 탈퇴가 통째로 500 이 된다.
    await tx.execute({
      sql: `DELETE FROM alarms WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    if (cloneIds.length > 0) {
      const cph = cloneIds.map(() => '?').join(', ');
      // 알람에서 목소리를 떼어 냈다고 끝이 아니다 — 그 알람이 쓰던 **문구 행**은 남의 것이라
      // (messages.user_id = 그 멤버) 아래 `DELETE FROM messages WHERE user_id IN (내 것)`
      // 에 안 걸리는데, messages.voice_profile_id 는 NOT NULL FK 로 내 클론을 가리킨다.
      // 그대로 두면 `DELETE FROM voice_profiles` 가 FK 로 실패해 **탈퇴가 통째로 500** 이
      // 된다(paid-voice-cleanup 이 같은 순서로 지우는 이유다). message_library 가
      // messages 를 참조하므로 그쪽을 먼저 지운다.
      await tx.execute({
        sql: `DELETE FROM message_library
              WHERE message_id IN (SELECT id FROM messages WHERE voice_profile_id IN (${cph}))`,
        args: cloneIds,
      });
      await tx.execute({
        sql: `DELETE FROM messages WHERE voice_profile_id IN (${cph})`,
        args: cloneIds,
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

  return { downgradedAlarms: revokedTargets, voiceAccessRevokedUserIds };
}
