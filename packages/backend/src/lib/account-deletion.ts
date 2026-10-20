import type { InStatement } from '@libsql/client';
import type { DbExecutor } from './transactions';
import { cancelActiveSubscriptionsForUser } from './billing-cancel';
import { enqueueUserVoiceArtifacts } from './audio-retention';
import type { DowngradedAlarm } from './paid-voice-cleanup';
import { revokeDeletedVoices } from './voice-revocation';

const TEXT_ENCODER = new TextEncoder();

/** 로그인이 끝날 때 계정의 탈퇴 상태가 어떻게 됐는지. */
export type SignInDeletionOutcome =
  /** 로그인이 처음 본 탈퇴 신청을 철회했다. */
  | 'cancelled'
  /** 바꾼 것이 없다 — 처음부터 active 였고 그대로다. */
  | 'unchanged'
  /**
   * 로그인이 처음 읽은 뒤 계정이 바뀌었다 — 그 사이 탈퇴를 (다시) 신청했거나 세션 세대가 올랐다. 이 로그인이 서명한
   * 토큰은 곧바로 403·401 을 받으니 성공으로 돌려주지 않는다(다시 로그인하면 새 상태를 읽고 처리한다).
   */
  | 'superseded'
  /** 그 사이 계정이 파기됐다 — 로그인을 성공으로 돌려주면 안 된다(다음 요청이 곧바로 `AUTH_USER_NOT_FOUND`). */
  | 'missing';

/**
 * **다시 로그인하면 탈퇴를 철회한다**(2026-10-15 오너 결정). 자격증명을 확인한 로그인(이메일·구글·애플)이 탈퇴 유예
 * 계정이면 `active` 로 되돌린다 — 예전에는 로그인 뒤 '회원 탈퇴가 진행 중이에요' 화면에서 버튼을 한 번 더 눌러야
 * 했는데, 앱의 탈퇴 안내 문구는 처음부터 "그 전에 다시 로그인하면 탈퇴를 취소할 수 있어요" 였다
 * (`docs/spec/session-and-auth.md` 「탈퇴 유예 — 다시 로그인하면 철회」).
 *
 * ⚠ **로그인이 처음 읽은 그 상태에 묶는다**(`observed` — 로그인 첫 조회의 `deletion_requested_at`(유예가 아니면 null)과
 *   `token_epoch`, 코덱스 #904). 조건 없이 되돌리면 active 로 읽은 로그인이 그 사이 다른 기기가 낸 새 신청을 아무도
 *   모르게 철회하고, 철회하지 않더라도 그 사이 신청이 세대를 올렸으면 이 로그인이 서명한 토큰은 쓸 수 없다.
 * ⚠ **로그인 응답이 다 준비된 뒤 마지막에 부른다** — 실패한 로그인이 철회만 남기지 않게.
 * ⚠ **토큰 갱신(`GET /auth/me`)에서는 부르지 않는다.** 남아 있던 세션은 탈퇴 신청이 끊으므로(`POST /user/me/deletion`
 *   이 `token_epoch` 를 올린다) 철회는 언제나 사람이 자격증명을 다시 넣은 순간이다.
 */
export async function cancelPendingDeletionOnSignIn(
  db: DbExecutor,
  userPk: string,
  observed: { requestedAt: string | null; tokenEpoch: number },
): Promise<SignInDeletionOutcome> {
  if (observed.requestedAt) {
    // ⚠ **철회는 그 자리에서 다른 기기의 세션·푸시 등록도 끊는다**(`token_epoch + 1`·그 계정의 `push_tokens` 삭제, 코덱스
    //   #904). 탈퇴 신청이 이미 끊었으면 한 번 더 끊는 것뿐이지만, 이 배포 **전에** 신청한 유예 행은 신청이 끊지 않았다 —
    //   마이그레이션 #129 가 소급하지만 배포가 마이그레이션보다 먼저 돌아, 그 사이 철회되면 #129 가 건너뛴다. 철회가
    //   스스로 끊으면 마이그레이션 순서와 무관하다. 그래서 이 로그인이 내주는 토큰은 **올린 세대**로 서명한다(호출부).
    //   두 문장은 한 batch(원자적)다 — 조건이 같아 함께 적용되거나 함께 건너뛴다.
    const condition = `id = ? AND deletion_status = 'pending_deletion' AND deletion_requested_at = ? AND token_epoch = ?`;
    const args = [userPk, observed.requestedAt, observed.tokenEpoch];
    const [, res] = await db.batch([
      {
        sql: `DELETE FROM push_tokens WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE ${condition})`,
        args: [userPk, ...args],
      },
      {
        sql: `UPDATE users
              SET deletion_status = 'active',
                  deletion_requested_at = NULL,
                  deletion_purge_at = NULL,
                  token_epoch = token_epoch + 1,
                  updated_at = datetime('now')
              WHERE ${condition}`,
        args,
      },
    ]);
    if ((res?.rowsAffected ?? 0) > 0) return 'cancelled';
  }
  const now = await db.execute({
    sql: 'SELECT deletion_status, token_epoch FROM users WHERE id = ? LIMIT 1',
    args: [userPk],
  });
  const row = now.rows[0];
  if (!row) {
    // 유예였던 행만 그 사이 파기될 수 있다(크론은 기한이 지난 유예 행만 지운다). active 로 읽은 행이 없으면 판단할
    // 근거가 없으니 그대로 둔다.
    return observed.requestedAt ? 'missing' : 'unchanged';
  }
  // 유예로 읽었는데 철회되지 않았으면(그 사이 다른 철회·재신청) 이 로그인이 올린 세대로 서명한 토큰은 맞지 않는다 —
  // active 로 읽었으면 세대가 그대로여야 한다.
  if (
    row.deletion_status === 'pending_deletion' ||
    observed.requestedAt !== null ||
    Number(row.token_epoch ?? 0) !== observed.tokenEpoch
  ) {
    return 'superseded';
  }
  return 'unchanged';
}

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
  //   컬럼이 그 용도다). 한 구독에 기록이 여럿이면 각각 보존한다. 최신 것만 남기지 않는다.
  const subs = await tx.execute({
    sql: `SELECT s.id, s.plan_id, s.status, s.starts_at, s.expires_at, p.price_krw,
                 st.provider, st.provider_transaction_id, st.product_id, st.raw_payload,
                 st.created_at AS txn_created_at, st.last_paid_at AS txn_last_paid_at,
                 -- 마지막 결제 시각의 추정치 = 지금 기간의 시작.
                 -- 갱신은 expires_at 만 미므로, 한 주기를 빼면 그 주기를 산 날이 된다.
                 CASE WHEN p.period_days > 0
                      THEN datetime(s.expires_at, '-' || p.period_days || ' days')
                 END AS last_paid_estimate
          FROM subscriptions s
          LEFT JOIN plans p ON p.id = s.plan_id
          LEFT JOIN store_transactions st ON st.subscription_id = s.id
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
    //   그래서 확정 경로가 **`last_paid_at` 을 그때그때 적는다**(마이그레이션 114).
    //
    // ⚠ **추정으로 되돌리지 말 것**(코덱스 #734 3·5차). 여기서 두 번 틀렸다:
    //   `expires_at` 은 **기간의 끝**이라 프로모처럼 기간이 길면 몇 년을 더 남기고,
    //   `expires_at - period_days` 는 애플이 **달력 달**(P1M)인데 `period_days` 가 30 고정이라
    //   2월이면 이르게·31일 달이면 늦게 잡힌다. 이르면 증빙을 잃고 늦으면 5년을 넘긴다.
    //
    //   `last_paid_at` 이 비어 있는 것은 **마이그레이션 114 이전에 쓰인 행**뿐이다 —
    //   그때만 옛 추정으로 폴백한다(아무것도 없는 것보다는 낫다).
    const anchors = [
      row.txn_last_paid_at as string | null,
      // 폴백(옛 행 전용). 아래 둘은 `last_paid_at` 이 있으면 쓰이지 않는다.
      (row.txn_last_paid_at as string | null) ? null : (row.txn_created_at as string | null),
      (row.txn_last_paid_at as string | null) ? null : (row.last_paid_estimate as string | null),
      (row.txn_last_paid_at as string | null) ? null : (row.starts_at as string | null),
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
    const paidAt =
      anchors.length > 0 ? anchors.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b)) : null;
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
  //   **선물 구매는 구독 행을 만들지 않았다** — `store_transactions` 에 `subscription_id`
  //   가 NULL 인 행으로만 남는다. 그런데 `purgeUserAccount` 는 그 표를 통째로 지우므로,
  //   선물을 산 사람이 탈퇴하면 **대금결제 기록이 사라진다** — 전자상거래법상 5년 보존이 깨진다.
  //   선물은 2026-10-14 에 없앴지만(App Store 심사 지침 3.1.1 — `routes/code.ts` 머리말, 되살리지
  //   말 것) 그 전에 쓰인 행은 이력으로 남으므로 이 갈래는 **지우지 않는다.**
  const oneTime = await tx.execute({
    sql: `SELECT st.id, st.plan_key, st.created_at, st.last_paid_at, st.provider, st.provider_transaction_id,
                 st.product_id, st.raw_payload, p.id AS plan_id
          FROM store_transactions st
          LEFT JOIN plans p ON p.key = st.plan_key
          WHERE st.user_id = ? AND st.subscription_id IS NULL`,
    args: [userPk],
  });
  for (const row of oneTime.rows) {
    // ⚠ **보존 기한은 '거래일' 부터 센다**(코덱스 #731). 탈퇴 시각부터 세면 4년 전에 산
    //   선물이 그 시점부터 5년을 더 남아 **9년**이 된다 — 처리방침이 밝힌 최대 5년을 넘긴다.
    const purchasedAt =
      (row.last_paid_at as string | null) ?? (row.created_at as string | null) ?? null;
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
 * 탈퇴 커밋 후 보내야 할 알림. 둘 다 그대로 `notifyDowngradedAlarms` 의 3·4번째 인자다
 * (파기는 유예 크론 하나다 — 즉시 삭제 `DELETE /user/me` 는 2026-10-15 에 지웠다).
 * 탈퇴하는 계정 자신은 빠진다 — 그 기기는 곧 사라진다(`revokeDeletedVoices` 의 `excludeOwnerUserIds`).
 */
export type AccountPurgeNotifications = {
  /** 서버 알람 행에서 찾은 강등 대상. 그 알람의 주인 기기가 목소리 접근권을 다시 확인한다. */
  downgradedAlarms: DowngradedAlarm[];
  /** 서버 알람 행과 **무관하게** 목소리 접근권을 잃은 계정들(`VoiceRevocationNotifications`). */
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
  const revokedTargets: DowngradedAlarm[] = [];
  const voiceAccessRevokedUserIds: string[] = [];
  // 결과를 읽지 않는 쓰기를 모아 두는 자리(아래 `tx.batch` 한 번으로 나간다).
  const writes: InStatement[] = [];
  if (userPk) {
    // 중복을 제거하지 않는다. 아래 DELETE 들이 `IN (?, ?)` 로 개수를 고정해 두고 있어서,
    // 두 값이 같을 때(=정규화 이후의 일반적인 경우) 하나로 줄이면 바인딩 개수가 어긋나
    // 트랜잭션이 통째로 롤백되고 DELETE /user/me 가 500 이 된다.
    const userIds = [userPk, userLoginId];
    // 클론 voice/R2 오디오의 외부 삭제 참조를 행 삭제 *전에* 큐에 적재한다.
    // 실제 삭제는 cron 의 drainExternalDeletions 가 수행 (GDPR/개인정보보호법 잔존 방지).
    await enqueueUserVoiceArtifacts(tx, userIds);

    // **파기할 내 클론 목록.** 클론이 하나도 없으면 파기할 생체정보가 없으니 철회할 것도 없다.
    const cloneProfiles = await tx.execute({
      // is_system 이 시스템/클론을 가르는 유일한 컬럼이다(paid-voice-cleanup.ts 와 같은 기준).
      sql: `SELECT id FROM voice_profiles
            WHERE user_id IN (?, ?) AND COALESCE(is_system, 0) = 0`,
      args: userIds,
    });
    const cloneIds = cloneProfiles.rows.map((row) => String(row.id));

    // 판정은 **목소리 하나로** 한다. 목소리 삭제·플랜 강등과 **같은 함수**가 돈다
    // (`lib/voice-revocation.ts`) — 같은 사건이므로 결과도 같아야 한다.
    //
    // ⚠ **자리를 옮기지 말 것.** 아래 둘보다 앞이어야 한다:
    //   구독 취소 — 철회는 지금 상태를 읽어 대상을 고른다. 그 상태를 바꿀 수 있는 쓰기보다 먼저 돈다
    //   (2026-09-30 — 순서가 뒤집혀 있던 동안 철회가 대상을 못 찾았다),
    //   `DELETE FROM alarms`·messages·voice_profiles 삭제 — 조회 대상이 사라진다.
    const revocation = await revokeDeletedVoices(tx, {
      voiceProfileIds: cloneIds,
      ownerUserIds: userIds,
      // 내 기기는 곧 사라진다 — 나에게 보내는 철회 푸시는 받을 사람이 없다.
      excludeOwnerUserIds: userIds,
    });
    revokedTargets.push(...revocation.downgradedAlarms);
    voiceAccessRevokedUserIds.push(...revocation.voiceAccessRevokedUserIds);

    // 철회를 기록한 **뒤에** 구독을 끊는다(위 ⚠ — 순서를 뒤집지 말 것).
    await cancelActiveSubscriptionsForUser(tx, userPk, new Date(), { deleteVoiceData: false });

    // ⚠ **여기부터는 결과를 읽지 않는 쓰기뿐이다 — 한 번에 묶어 보낸다**(2026-09-18).
    //   DB 호출 하나가 곧 Workers subrequest 하나라, 문장마다 왕복하면 이 함수 하나로
    //   37 왕복이 되어 한도(~50)를 넘겨 **계정 삭제가 500 으로 죽었다**(운영 실측).
    //   `batch` 는 같은 트랜잭션 안에서 **적어 둔 순서 그대로** 실행되므로 의미는 같다.
    //   ⚠ 순서에 의미가 있는 문장들이다(예: FK 자식인 `message_library` 는 `messages` 보다
    //   **먼저** 지운다). 재배치하지 말 것.
    //   ⚠ 결과를 읽어야 하는 문장은 여기 넣지 말 것 — `revokeDeletedVoices` 처럼 자기가
    //   쓴 행을 되읽는 경로는 그대로 `execute` 로 둔다.

    // 직접 입력 월 한도 장부. 풀 키가 **사람 id 그대로**다(개인 풀 — 통일 이전 행은 로그인 id).
    // 안 지우면 파기 뒤에도 계정 id 가 남아, pepper 로 가명 보존 기록
    // (`retained_billing_records.pseudonym`)까지 곧장 이어진다 — 분리 보관이 무너진다.
    writes.push({
      sql: `DELETE FROM manual_tts_usage WHERE pool_key IN (?, ?)`,
      args: [userPk, userLoginId],
    });
    // 광고 보상 — 행마다 계정 id 가 실린다(`docs/spec/ad-rewards.md`).
    writes.push({
      sql: `DELETE FROM ad_reward_credits WHERE user_id = ?`,
      args: [userPk],
    });
    writes.push({
      sql: `DELETE FROM subscriptions WHERE user_id = ?`,
      args: [userPk],
    });
    // 결제 검증 원본(store_transactions)도 함께 파기한다. user_id(원본 식별자)가 남으면
    // 가명보존(retained_billing_records) 설계를 우회해 탈퇴자 직접식별자가 잔존한다
    // (개인정보보호법 제21조). 보존이 필요한 거래 사실은 위 가명보존 레코드가 담는다.
    writes.push({
      sql: `DELETE FROM store_transactions WHERE user_id IN (?, ?)`,
      args: [userPk, userLoginId],
    });

    writes.push({
      sql: `DELETE FROM push_tokens WHERE user_id = ?`,
      args: [userPk],
    });

    writes.push({
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
    // 내 알람 행. 남겨 두면 audio-retention 이 message_id 를 영구 사용 참조로 오인하고, 계정 id 도
    // 그대로 남는다.
    writes.push({
      sql: `DELETE FROM alarms WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    if (cloneIds.length > 0) {
      const cph = cloneIds.map(() => '?').join(', ');
      // 내 클론으로 만든 문구는 **주인이 누구든** 지운다. 아래 `DELETE FROM messages WHERE user_id IN (내 것)`
      // 은 주인으로만 고르는데, messages.voice_profile_id 는 NOT NULL FK 로 내 클론을 가리킨다 — 남의 문구가
      // 하나라도 남으면(목소리 공유가 있던 시절에 만들어진 행) `DELETE FROM voice_profiles` 가 FK 로 실패해
      // **탈퇴가 통째로 500** 이 된다(paid-voice-cleanup 이 같은 순서로 지우는 이유다). message_library 가
      // messages 를 참조하므로 그쪽을 먼저 지운다.
      writes.push({
        sql: `DELETE FROM message_library
              WHERE message_id IN (SELECT id FROM messages WHERE voice_profile_id IN (${cph}))`,
        args: cloneIds,
      });
      writes.push({
        sql: `DELETE FROM messages WHERE voice_profile_id IN (${cph})`,
        args: cloneIds,
      });
    }
    writes.push({
      sql: `DELETE FROM message_library
            WHERE user_id IN (?, ?)
               OR message_id IN (
                 SELECT id FROM messages WHERE user_id IN (?, ?)
               )`,
      args: [...userIds, ...userIds],
    });
    writes.push({
      sql: `DELETE FROM messages WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    writes.push({
      sql: `DELETE FROM voice_uploads WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    writes.push({
      sql: `DELETE FROM voice_prerender_queue WHERE owner_user_id IN (?, ?)`,
      args: userIds,
    });
    writes.push({
      sql: `DELETE FROM voice_draft_attempt_usage WHERE owner_user_id IN (?, ?)`,
      args: userIds,
    });
    writes.push({
      sql: `DELETE FROM voice_profile_change_ledger WHERE owner_user_id IN (?, ?)`,
      args: userIds,
    });
    writes.push({
      sql: `DELETE FROM voice_profiles WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    writes.push({
      sql: `DELETE FROM user_consents WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    // FK 는 없지만 사용자 식별자가 남는 테이블들 — 개인정보 파기 범위에 포함한다.
    writes.push({
      sql: `DELETE FROM promo_code_redemptions WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    writes.push({
      sql: `DELETE FROM paid_voice_retention WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    // 사용 기록도 users 의 FK 자식이다(`usage_events.user_id REFERENCES users(id)`).
    // 안 지우면 아래 `DELETE FROM users` 가 FK 로 던져 **탈퇴가 통째로 롤백된다** —
    // 마지막 기록이 1년을 채울 때까지 계정을 지울 수 없게 된다. 기록은 식별자만 담으므로
    // 남겨 둘 이유도 없다(파기 범위에 포함).
    writes.push({
      sql: `DELETE FROM usage_events WHERE user_id IN (?, ?)`,
      args: userIds,
    });
    // 인증 코드(이메일 키)는 users 행 삭제 전에 이메일을 역참조해 지운다.
    writes.push({
      sql: `DELETE FROM email_verification_codes
            WHERE email IN (SELECT email FROM users WHERE id = ? OR google_id = ?)`,
      args: [userPk, userLoginId],
    });
  }

  writes.push({
    sql: `DELETE FROM users WHERE id = ? OR google_id = ?`,
    args: [userPk ?? userLoginId, userLoginId],
  });

  // 모아 둔 쓰기를 **한 번의 요청**으로 보낸다(위 주석 참조).
  await tx.batch(writes);

  return { downgradedAlarms: revokedTargets, voiceAccessRevokedUserIds };
}
