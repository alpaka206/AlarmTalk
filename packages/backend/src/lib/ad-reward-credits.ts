import type { DbExecutor } from './transactions';

/**
 * **광고 보상** — 무료 사용자가 보상형 광고를 끝까지 보면 기본 목소리 직접 입력을 한 번 만들 수 있다.
 * 스펙: `docs/spec/ad-rewards.md`.
 *
 * 행 하나 = 광고 한 번 = 직접 입력 생성 한 번. PK 는 AdMob 의 `transaction_id` 라 같은 콜백을 다시 받아도
 * 한 번만 적립된다(AdMob 은 200 을 못 받으면 다시 부른다).
 *
 * 쓰는 것은 **생성 직전**(직접 입력 월 한도와 같은 자리)이고, 생성이 실패하면 돌려준다. 그래서 광고를 보고
 * 저장하지 않고 나가도 보상은 남는다 — 다음 저장 때 광고 없이 쓴다.
 */

/**
 * 한 계정이 한 달(KST)에 광고로 받을 수 있는 횟수. 유료 개인 플랜의 직접 입력 월 한도(30)보다 **작아야**
 * 한다 — 광고로 유료보다 많이 쓸 수 있으면 이용권을 살 이유가 사라진다. 생성 한 번이 공용 ElevenLabs 키의
 * 한도를 쓰므로 그쪽 상한이기도 하다.
 */
export const AD_REWARD_MONTHLY_LIMIT = 10;

// 월 경계는 KST(UTC+9) — 직접 입력 월 한도(`manual-tts-quota.ts`)와 같다.
const KST_MONTH_SQL = "strftime('%Y-%m', 'now', '+9 hours')";

/**
 * 설정된 보상형 광고 단위(쉼표 구분)에 이 콜백의 `ad_unit` 이 있는가. 설정이 비면 **아무것도 받지 않는다** —
 * 남의 앱 광고 단위로 서명된 콜백도 서명 자체는 맞기 때문이다.
 * 설정 값은 콘솔의 전체 id(`ca-app-pub-…/1234567890`)여도 되고 뒤 숫자만이어도 된다.
 */
export function isConfiguredRewardedAdUnit(
  configured: string | undefined,
  adUnit: string,
): boolean {
  if (!configured || !adUnit) return false;
  return configured
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((unit) => unit === adUnit || unit.endsWith(`/${adUnit}`));
}

/**
 * 적립한다. 이미 받은 거래이거나 이번 달 상한에 닿았으면 아무것도 하지 않고 false.
 * 상한 검사와 삽입이 한 문장이라 동시에 온 콜백이 상한을 넘기지 못한다.
 */
export async function grantAdRewardCredit(
  db: DbExecutor,
  input: { transactionId: string; userPk: string; adUnit: string },
  monthlyLimit: number = AD_REWARD_MONTHLY_LIMIT,
): Promise<boolean> {
  const res = await db.execute({
    sql: `INSERT OR IGNORE INTO ad_reward_credits (transaction_id, user_id, ad_unit, grant_month)
          SELECT ?, ?, ?, ${KST_MONTH_SQL}
          WHERE (SELECT COUNT(*) FROM ad_reward_credits
                 WHERE user_id = ? AND grant_month = ${KST_MONTH_SQL}) < ?`,
    args: [input.transactionId, input.userPk, input.adUnit, input.userPk, monthlyLimit],
  });
  return (res.rowsAffected ?? 0) > 0;
}

export interface AdRewardStatus {
  /** 지금 쓸 수 있는(받고 아직 안 쓴) 보상 횟수. */
  credits: number;
  /** 이번 달 광고로 더 받을 수 있는 횟수. */
  remaining_grants: number;
  monthly_limit: number;
}

export async function readAdRewardStatus(
  db: DbExecutor,
  userPk: string,
  monthlyLimit: number = AD_REWARD_MONTHLY_LIMIT,
): Promise<AdRewardStatus> {
  const res = await db.execute({
    sql: `SELECT
            COALESCE(SUM(CASE WHEN consumed_at IS NULL THEN 1 ELSE 0 END), 0) AS credits,
            COALESCE(SUM(CASE WHEN grant_month = ${KST_MONTH_SQL} THEN 1 ELSE 0 END), 0) AS granted
          FROM ad_reward_credits WHERE user_id = ?`,
    args: [userPk],
  });
  const row = res.rows[0];
  const credits = Number(row?.credits ?? 0);
  const granted = Number(row?.granted ?? 0);
  return {
    credits,
    remaining_grants: Math.max(0, monthlyLimit - granted),
    monthly_limit: monthlyLimit,
  };
}

/** 가장 오래된 보상 한 번를 쓴다. 쓴 거래 id(환불용) 또는 없으면 null. */
export async function consumeAdRewardCredit(
  db: DbExecutor,
  userPk: string,
): Promise<string | null> {
  const res = await db.execute({
    sql: `UPDATE ad_reward_credits SET consumed_at = datetime('now')
          WHERE transaction_id = (
            SELECT transaction_id FROM ad_reward_credits
            WHERE user_id = ? AND consumed_at IS NULL
            ORDER BY granted_at, transaction_id
            LIMIT 1
          ) AND consumed_at IS NULL
          RETURNING transaction_id`,
    args: [userPk],
  });
  const id = res.rows[0]?.transaction_id;
  return id == null ? null : String(id);
}

/** 생성이 실패했을 때 쓴 보상을 돌려준다. */
export async function refundAdRewardCredit(db: DbExecutor, transactionId: string): Promise<void> {
  await db.execute({
    sql: `UPDATE ad_reward_credits SET consumed_at = NULL WHERE transaction_id = ?`,
    args: [transactionId],
  });
}
