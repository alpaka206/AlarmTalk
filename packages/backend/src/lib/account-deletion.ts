import type { DbExecutor } from './transactions';
import { cancelActiveSubscriptionsForUser } from './billing-cancel';
import { enqueueUserVoiceArtifacts } from './audio-retention';
import { revokeDeletedVoices } from './voice-revocation';

const TEXT_ENCODER = new TextEncoder();

export function billingRetentionUntil(now: Date): Date {
  const retainUntil = new Date(now);
  retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + 5);
  return retainUntil;
}

/**
 * user_id 를 비가역 가명 키로 변환한다 (개인정보보호법 제2조 가명처리).
 * pseudonym = SHA-256(user_id + salt). salt(=PASSWORD_PEPPER) 없이는 원본을 복원할 수 없다.
 */
async function pseudonymizeUserId(userId: string, salt: string): Promise<string> {
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
  const retainUntil = billingRetentionUntil(now).toISOString();
  // 결제 금액(plans.price_krw)을 함께 보존해 전자상거래법상 '대금결제 기록'이 완전해지도록 한다.
  //
  // ⚠ **스토어 증빙도 함께 남긴다**(코덱스 #730 4차). 예전에는 구독 갈래가 plan·기간·금액만
  //   적었는데, `purgeUserAccount` 가 `store_transactions` 를 통째로 지우므로 **남은 기록을
  //   실제 주문에 되짚을 방법이 사라졌다** — 결제 분쟁에서 "이 사람이 이 주문을 했다" 를
  //   보일 수 없다. 아래 일회성 갈래는 이미 그걸 남기고 있었다(마이그레이션 113 의 증빙
  //   컬럼이 그 용도다). 한 구독에 기록이 여럿이면(플랜 전환 등) **가장 최근 것**을 쓴다.
  const subs = await tx.execute({
    sql: `SELECT s.id, s.plan_id, s.status, s.starts_at, s.expires_at, p.price_krw,
                 st.provider, st.provider_transaction_id, st.product_id, st.raw_payload,
                 st.created_at AS txn_created_at,
                 -- 마지막 결제 시각의 추정치 = 지금 기간의 시작.
                 -- 갱신은 expires_at 만 미므로, 한 주기를 빼면 그 주기를 산 날이 된다.
                 CASE WHEN p.period_days > 0
                      THEN datetime(s.expires_at, '-' || p.period_days || ' days')
                 END AS last_paid_estimate
          FROM subscriptions s
          LEFT JOIN plans p ON p.id = s.plan_id
          LEFT JOIN store_transactions st ON st.id = (
            SELECT id FROM store_transactions
            WHERE subscription_id = s.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          )
          WHERE s.user_id = ?`,
    args: [userPk],
  });
  for (const row of subs.rows) {
    // ⚠ **보존 기한은 '거래일' 부터 센다**(코덱스 #734 — 일회성 갈래와 같은 규칙).
    //   탈퇴 시각부터 세면 4년 전에 결제한 구독이 그 시점부터 5년을 더 남아 **9년**이 된다 —
    //   처리방침이 밝힌 최대 5년을 넘긴다.
    //
    // ⚠ **`store_transactions.created_at` 하나만 보면 안 된다**(코덱스 #734 2차). 그 값은
    //   **체인이 처음 들어온 시각**이다 — 애플의 originalTransactionId·Play 의 purchaseToken
    //   은 갱신돼도 그대로이고, 같은-플랜 갱신은 그 행의 `expires_at` 만 고친다. 5년 넘게
    //   갱신해 온 구독이면 이미 지난 날짜가 나와, **이번 달에 결제한 사람의 증빙까지
    //   버린다**(원본은 곧 파기되므로 되돌릴 수 없다).
    //
    // ⚠ **그렇다고 `expires_at` 을 쓰면 안 된다**(코덱스 #734 3차). 그건 **기간의 끝**이라
    //   실제 결제일보다 한 주기 뒤다 — 월 구독이면 30일, **프로모·수동 부여처럼 기간이 길면
    //   몇 년**을 더 남기게 된다. 처리방침이 밝힌 최대 5년을 넘긴다.
    //
    //   그래서 **지금 기간의 시작**(`expires_at - period_days`)을 쓴다. 갱신이 `expires_at`
    //   만 미므로 거기서 한 주기를 빼면 **그 주기를 산 날**이다 — 상한이 아니라 추정치이고,
    //   기간이 길든 짧든 같은 정확도로 맞는다. 첫 주기에서는 `starts_at` 과 같아진다.
    //   (별도 `last_paid_at` 컬럼을 두는 편이 더 정확하지만, 이 값이면 마이그레이션 없이
    //    같은 규칙을 지킬 수 있다.)
    const anchors = [
      row.txn_created_at as string | null,
      row.last_paid_estimate as string | null,
      row.starts_at as string | null,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
    const paidAt = anchors.length > 0 ? anchors.reduce((a, b) => (a > b ? a : b)) : null;
    const recordRetainUntil = paidAt
      ? billingRetentionUntil(new Date(paidAt)).toISOString()
      : retainUntil;
    // 이미 5년이 지난 거래는 **다시 보존하지 않는다** — 보존 사유가 끝난 기록이다.
    if (recordRetainUntil <= now.toISOString()) continue;
    await tx.execute({
      sql: `INSERT INTO retained_billing_records
              (id, pseudonym, plan_id, status, starts_at, expires_at, amount_krw,
               provider, provider_transaction_id, product_id, raw_payload,
               retained_reason, retain_until)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ecommerce_act_5y', ?)`,
      args: [
        crypto.randomUUID(),
        pseudonym,
        (row.plan_id as string | null) ?? null,
        (row.status as string | null) ?? null,
        (row.starts_at as string | null) ?? null,
        (row.expires_at as string | null) ?? null,
        // ⚠ **스토어 증빙이 있으면 금액을 지어내지 않는다**(코덱스 #734 4차). `price_krw` 는
        //   **지금의 원화 표시가**일 뿐이다 — 스토어 가격은 지역별이고 요금제 가격은 바뀐다.
        //   증빙(거래 id·원본 페이로드)을 붙여 놓고 그 옆에 이 값을 적으면, **그 애플/Play
        //   주문이 이 금액이었다**고 단언하는 셈이 된다. 통화(`amount_currency`)도 비어 있어
        //   원화인지조차 말할 수 없다. 실제 금액은 그 거래 id 로 스토어에서 확인한다.
        //   (아래 일회성 갈래가 같은 이유로 처음부터 비워 둔다.)
        //   스토어 결제가 아니면(dev 스텁·프로모·바우처) 되짚을 곳이 없으므로 그대로 남긴다.
        row.provider == null && row.price_krw != null ? Number(row.price_krw) : null,
        (row.provider as string | null) ?? null,
        (row.provider_transaction_id as string | null) ?? null,
        (row.product_id as string | null) ?? null,
        (row.raw_payload as string | null) ?? null,
        recordRetainUntil,
      ],
    });
  }

  // ⚠ **일회성 결제도 보존한다**(코덱스 #730). 위 SELECT 는 `subscriptions` 만 훑는데,
  //   **선물 구매는 구독 행을 만들지 않는다** — `store_transactions` 에 `subscription_id`
  //   가 NULL 인 행으로만 남는다(`routes/billing-apple.ts` 의 선물 갈래). 그런데
  //   `purgeUserAccount` 는 그 표를 통째로 지우므로, 선물을 산 사람이 탈퇴하면
  //   **대금결제 기록이 사라진다** — 전자상거래법상 5년 보존이 깨진다.
  const oneTime = await tx.execute({
    sql: `SELECT st.id, st.plan_key, st.created_at, st.provider, st.provider_transaction_id,
                 st.product_id, st.raw_payload, p.id AS plan_id
          FROM store_transactions st
          LEFT JOIN plans p ON p.key = st.plan_key
          WHERE st.user_id = ? AND st.subscription_id IS NULL`,
    args: [userPk],
  });
  for (const row of oneTime.rows) {
    // ⚠ **보존 기한은 '거래일' 부터 센다**(코덱스 #731). 탈퇴 시각부터 세면 4년 전에 산
    //   선물이 그 시점부터 5년을 더 남아 **9년**이 된다 — 처리방침이 밝힌 최대 5년을 넘긴다.
    const purchasedAt = (row.created_at as string | null) ?? null;
    const recordRetainUntil = purchasedAt
      ? billingRetentionUntil(new Date(purchasedAt)).toISOString()
      : retainUntil;
    // 이미 5년이 지난 거래는 **다시 보존하지 않는다** — 보존 사유가 끝난 기록이다.
    if (recordRetainUntil <= now.toISOString()) continue;
    await tx.execute({
      // ⚠ **금액을 지어내지 않는다.** 예전에는 `plans.price_krw`(현재 원화 표시가)를 넣었는데,
      //   스토어 가격은 지역별이고 요금제 가격은 바뀐다 — 실제로 청구된 금액과 다른 값이
      //   **법정 결제기록에 남는다.** 통화까지 확실한 값이 없으면 비워 두고, 대신 스토어
      //   증빙(거래 id·원본 페이로드)을 남겨 주문에 되짚을 수 있게 한다.
      sql: `INSERT INTO retained_billing_records
              (id, pseudonym, plan_id, status, starts_at, expires_at,
               amount_krw, amount_currency, provider, provider_transaction_id,
               product_id, raw_payload, retained_reason, retain_until)
            VALUES (?, ?, ?, 'one_time', ?, NULL, NULL, NULL, ?, ?, ?, ?, 'ecommerce_act_5y', ?)`,
      args: [
        crypto.randomUUID(),
        pseudonym,
        (row.plan_id as string | null) ?? null,
        purchasedAt,
        (row.provider as string | null) ?? null,
        (row.provider_transaction_id as string | null) ?? null,
        (row.product_id as string | null) ?? null,
        (row.raw_payload as string | null) ?? null,
        recordRetainUntil,
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
      senderVoiceOwnerUserIds: userIds,
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
    // 서버 알람 행은 로컬 원본이 아니라 **수신 확인 전 전달 대기열**이다. 내가 만든 행뿐 아니라
    // 나를 target 으로 한 행도 지운다. 후자는 계정이 사라지면 영원히 pull/ack 될 수 없고,
    // 남겨 두면 audio-retention 이 message_id 를 영구 사용 참조로 오인한다. 이미 전달된 알람은
    // ack 때 서버 행이 없어졌으므로 수신자 기기의 로컬 알람에는 영향이 없다.
    // `user_id` 갈래는 users FK 때문에도 반드시 필요하다.
    await tx.execute({
      sql: `DELETE FROM alarms
            WHERE user_id IN (?, ?) OR target_user_id IN (?, ?)`,
      args: [...userIds, ...userIds],
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
    // 재전송 슬롯도 사용자 식별자를 **양쪽 다** 담는다(보낸 사람·받는 사람). FK 가 없어
    // 남겨 두면 떠난 계정의 id 가 그대로 남으므로 두 자리 모두에서 지운다. 슬롯이 사라지면
    // 다음 전송은 새 id 로 시작하는데, 그 상대는 이미 없는 계정이라 이어 붙일 것도 없다.
    await tx.execute({
      sql: `DELETE FROM targeted_alarm_slots
            WHERE sender_user_id IN (?, ?) OR recipient_user_id IN (?, ?)`,
      args: [...userIds, ...userIds],
    });
    await tx.execute({
      sql: `DELETE FROM promo_code_redemptions WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    await tx.execute({
      sql: `DELETE FROM paid_voice_retention WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    // 사용 기록도 users 의 FK 자식이다(`usage_events.user_id REFERENCES users(id)`).
    // 안 지우면 아래 `DELETE FROM users` 가 FK 로 던져 **탈퇴가 통째로 롤백된다** —
    // 마지막 기록이 1년을 채울 때까지 계정을 지울 수 없게 된다. 기록은 식별자만 담으므로
    // 남겨 둘 이유도 없다(파기 범위에 포함).
    await tx.execute({
      sql: `DELETE FROM usage_events WHERE user_id IN (?, ?)`,
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
