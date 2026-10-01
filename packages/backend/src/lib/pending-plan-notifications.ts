import type { Client, InStatement } from '@libsql/client';
import { notifyBillingStateChanged } from './billing-cancel';
import { logStructured } from './logger';

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
 * 지우는 문장도 subrequest 라 함께 실패해 행이 남고, 다음 틱이 이어서 보낸다.
 *
 * ⚠ **이 표가 지키는 것은 '예산에 잘린 발송' 하나다.** 예산이 남은 채 실패한 발송(OAuth 실패·FCM
 *   5xx·APNs 네트워크 오류)은 발송 함수가 삼키므로 지우기가 성공해 행이 사라진다 — 다른 결제 경로의
 *   통지와 같은 최선 노력이다. 발송 결과를 사람마다 돌려받아 실패한 사람만 남기는 것은 이 표의 다음
 *   단계다(`docs/spec/billing-lifecycle.md` 「그룹 주인이 탈퇴하면」).
 *
 * ⚠ **같은 머리가 매 틱 다시 나가지 않게 한다**(리뷰). 한 묶음이 예산에 끝내 안 들어가면 같은 사람들이
 *   매번 맨 앞에 서서, 예산 안에 든 기기는 5분마다 삭제 예고를 다시 받고 뒤 행은 영영 막힌다. 그래서
 *   - 꺼내는 순간 시도 횟수를 **먼저** 올리고(예산이 남아 있을 때다), 시도가 적은 행부터 꺼낸다 —
 *     실패한 머리는 뒤로 밀리고 새 행이 앞에 선다.
 *   - [PLAN_NOTIFY_MAX_ATTEMPTS] 번 시도한 행은 보내지 않고 지운다(오류 기록) — 반복 예고의 상한이다.
 *     그때까지 적어도 한 번은 예산 안에서 보내졌거나, 기기가 예산보다 많은 사람이다.
 */

/** 크론 한 틱이 대기열에서 꺼내 보낼 사람 수 — 그룹 하나(가족 최대 5명)를 한 번에 비운다. */
export const PLAN_NOTIFY_DRAIN_LIMIT = 5;

/** 한 사람을 몇 번까지 시도하는가 — 넘으면 보내지 않고 지운다(같은 예고의 반복 상한). */
export const PLAN_NOTIFY_MAX_ATTEMPTS = 3;

/** 이 사람들을 대기열에 넣는 문장 하나(없으면 null) — 파기 묶음(`batch`)에 넣는다. */
export function enqueuePlanNotificationsStatement(userIds: readonly string[]): InStatement | null {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return null;
  return {
    sql: `INSERT INTO pending_plan_notifications (user_id)
          VALUES ${ids.map(() => '(?)').join(', ')}
          ${REQUEUE_ON_CONFLICT}`,
    args: ids,
  };
}

/**
 * 이미 대기 중인 사람이 **또** 들어오면 새 사건이다 — 시각을 새로 찍고 시도 횟수를 되돌린다.
 * 그래야 그 사이 발송을 마친 지우기(`created_at` 이 꺼낸 값과 같을 때만 지운다)가 새 사건까지
 * 지우지 않는다. 시각은 마이크로초까지 가지 않으므로 같은 밀리초의 재적재는 구분하지 못한다 —
 * 그 경우는 이미 보내고 있는 통지가 같은 내용(재조회 신호 + 지금 기준의 예고)이라 잃는 것이 없다.
 */
export const REQUEUE_ON_CONFLICT = `ON CONFLICT(user_id) DO UPDATE SET
            created_at = strftime('%Y-%m-%d %H:%M:%f', 'now'),
            attempts = 0`;

type QueuedRow = { userId: string; createdAt: string; attempts: number };

/**
 * 대기열에서 꺼내 등급 통지를 보내고, **보낸 뒤에** 행을 지운다.
 *
 * - `userIds` 를 주면 그 사람들만(즉시 삭제 `DELETE /user/me` 가 자기 파기분을 곧바로 보낼 때),
 *   없으면 시도가 적고 오래된 순으로 `limit` 명(크론 — 앞 틱에서 남은 것까지 잇는다).
 * - ⚠ **지우기를 발송 앞으로 옮기지 말 것.** 발송은 실패를 삼키므로, 앞에서 지우면 예산이 바닥난
 *   실행에서 행만 사라지고 예고는 안 나간다 — 이 표가 있는 이유가 통째로 무너진다.
 * - ⚠ **시도 횟수는 발송 앞에서 올린다.** 뒤에서 올리면 예산이 바닥난 실행에서는 그 문장도 못 돌아
 *   같은 머리가 영원히 0회로 맨 앞에 선다.
 * - 지우기는 **꺼낸 시각이 그대로인 행만** 지운다 — 그 사이 다른 탈퇴로 다시 들어온 사람은 남긴다.
 * - 던질 수 있다(조회·삭제 실패). 호출부는 커밋 뒤라 잡아서 기록만 한다 — 행이 남으므로 다음
 *   크론 틱이 다시 보낸다.
 */
export async function drainPendingPlanNotifications(
  db: Client,
  env: Parameters<typeof notifyBillingStateChanged>[1],
  options: { userIds?: readonly string[]; limit?: number } = {},
): Promise<void> {
  let rows: QueuedRow[];
  if (options.userIds) {
    const ids = Array.from(new Set(options.userIds.filter(Boolean)));
    if (ids.length === 0) return;
    rows = toRows(
      await db.execute({
        sql: `SELECT user_id, created_at, attempts FROM pending_plan_notifications
              WHERE user_id IN (${ids.map(() => '?').join(', ')})`,
        args: ids,
      }),
    );
  } else {
    rows = toRows(
      await db.execute({
        sql: `SELECT user_id, created_at, attempts FROM pending_plan_notifications
              ORDER BY attempts, created_at, user_id
              LIMIT ?`,
        args: [Math.max(0, options.limit ?? PLAN_NOTIFY_DRAIN_LIMIT)],
      }),
    );
  }
  if (rows.length === 0) return;

  const exhausted = rows.filter((row) => row.attempts >= PLAN_NOTIFY_MAX_ATTEMPTS);
  const sending = rows.filter((row) => row.attempts < PLAN_NOTIFY_MAX_ATTEMPTS);
  if (exhausted.length > 0) {
    logStructured('error', {
      at: 'billing.pending_plan_notifications',
      action: 'GAVE_UP',
      users: exhausted.length,
      attempts: PLAN_NOTIFY_MAX_ATTEMPTS,
    });
  }

  if (sending.length > 0) {
    await db.execute({
      sql: `UPDATE pending_plan_notifications SET attempts = attempts + 1
            WHERE ${matchRows(sending).sql}`,
      args: matchRows(sending).args,
    });
    await notifyBillingStateChanged(
      db,
      env,
      sending.map((row) => row.userId),
    );
  }

  const done = [...exhausted, ...sending];
  await db.execute({
    sql: `DELETE FROM pending_plan_notifications WHERE ${matchRows(done).sql}`,
    args: matchRows(done).args,
  });
}

function toRows(res: { rows: ArrayLike<Record<string, unknown>> }): QueuedRow[] {
  return Array.from(res.rows).map((row) => ({
    userId: String(row.user_id),
    createdAt: String(row.created_at),
    attempts: Number(row.attempts ?? 0),
  }));
}

/** 꺼낸 그대로의 행만 가리키는 조건 — 사람과 적힌 시각이 둘 다 같아야 한다. */
function matchRows(rows: readonly QueuedRow[]): { sql: string; args: string[] } {
  return {
    sql: rows.map(() => '(user_id = ? AND created_at = ?)').join(' OR '),
    args: rows.flatMap((row) => [row.userId, row.createdAt]),
  };
}
