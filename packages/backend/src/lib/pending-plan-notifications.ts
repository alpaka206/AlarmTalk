import type { Client, InStatement } from '@libsql/client';
import { notifyBillingStateChanged } from './billing-cancel';

/**
 * **탈퇴 파기로 등급·그룹이 바뀐 멤버에게 보낼 통지의 대기열**(outbox) — 마이그레이션 126.
 *
 * 왜 대기열인가(코덱스 #841): 이 통지에는 **보이는 목소리 삭제 예고**가 실린다
 * (`notifyBillingStateChanged` → 보관 유예가 걸린 멤버). 그런데
 *  - 발송은 커밋 **뒤**의 최선 노력이고, 한 실행의 subrequest 예산(~50)을 다 쓰면 나머지가
 *    조용히 잘린다(발송 함수는 한도 오류를 삼킨다).
 *  - 탈퇴자 행은 이미 파기돼 **다음 틱이 그 사람을 다시 고르지 않는다** — 다른 해체 경로처럼
 *    "다음에 다시 시도" 할 근거가 남지 않는다.
 *  - 앱은 진입 때 삭제 기한을 다시 받지 않는다 — 예고는 푸시가 유일한 길이다.
 * 그래서 받을 사람을 **파기와 같은 트랜잭션에** 적어 두고, 보낸 뒤에만 지운다. 예산이 바닥나면
 * 지우는 문장도 subrequest 라 함께 실패해 행이 남고, 다음 틱이 이어서 보낸다. 같은 사람이 두 번
 * 받을 수는 있어도(예고 중복) 한 번도 못 받는 일은 없다 — 되돌릴 수 없는 삭제의 예고라 그쪽이 낫다.
 *
 * 규칙: `docs/spec/billing-lifecycle.md` 「그룹 주인이 탈퇴하면」.
 */

/** 크론 한 틱이 대기열에서 꺼내 보낼 사람 수 — 그룹 하나(가족 최대 5명)를 한 번에 비운다. */
export const PLAN_NOTIFY_DRAIN_LIMIT = 5;

/** 이 사람들을 대기열에 넣는 문장 하나(없으면 null) — 파기 묶음(`batch`)에 넣는다. */
export function enqueuePlanNotificationsStatement(userIds: readonly string[]): InStatement | null {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return null;
  return {
    sql: `INSERT INTO pending_plan_notifications (user_id)
          VALUES ${ids.map(() => '(?)').join(', ')}
          ON CONFLICT(user_id) DO NOTHING`,
    args: ids,
  };
}

/**
 * 대기열에서 꺼내 등급 통지를 보내고, **보낸 뒤에** 행을 지운다.
 *
 * - `userIds` 를 주면 그 사람들만(즉시 삭제 `DELETE /user/me` 가 자기 파기분을 곧바로 보낼 때),
 *   없으면 오래된 순으로 `limit` 명(크론 — 앞 틱에서 남은 것까지 잇는다).
 * - ⚠ **지우기를 발송 앞으로 옮기지 말 것.** 발송은 실패를 삼키므로, 앞에서 지우면 예산이 바닥난
 *   실행에서 행만 사라지고 예고는 안 나간다 — 이 표가 있는 이유가 통째로 무너진다.
 * - 던질 수 있다(조회·삭제 실패). 호출부는 커밋 뒤라 잡아서 기록만 한다 — 행이 남으므로 다음
 *   크론 틱이 다시 보낸다.
 */
export async function drainPendingPlanNotifications(
  db: Client,
  env: Parameters<typeof notifyBillingStateChanged>[1],
  options: { userIds?: readonly string[]; limit?: number } = {},
): Promise<void> {
  let ids: string[];
  if (options.userIds) {
    ids = Array.from(new Set(options.userIds.filter(Boolean)));
  } else {
    const res = await db.execute({
      sql: `SELECT user_id FROM pending_plan_notifications
            ORDER BY created_at, user_id
            LIMIT ?`,
      args: [Math.max(0, options.limit ?? PLAN_NOTIFY_DRAIN_LIMIT)],
    });
    ids = res.rows.map((row) => String(row.user_id));
  }
  if (ids.length === 0) return;
  await notifyBillingStateChanged(db, env, ids);
  await db.execute({
    sql: `DELETE FROM pending_plan_notifications
          WHERE user_id IN (${ids.map(() => '?').join(', ')})`,
    args: ids,
  });
}
