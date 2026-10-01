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
 * 한 번의 비우기는 두 걸음이다 — **다시 시도할 행 하나**, 그다음 **새 행 묶음**:
 *  - 새 행(`attempts = 0`)은 한 틱에 [PLAN_NOTIFY_FRESH_LIMIT] 명까지 묶어 보낸다 — 크론이 한 틱에
 *    적재할 수 있는 최대치라 대기열이 쌓이지 않는다(코덱스 #841).
 *  - **다시 시도는 한 사람씩, 매 틱 한 자리를 따로 둔다.** 묶음째 다시 보내면 앞 사람이 매번 예산을
 *    다 써 뒷사람은 한 번도 못 받은 채 시도 횟수만 함께 올라 버려진다 — 한 사람씩이면 시도 횟수가
 *    **그 사람의** 횟수다. 새 행이 계속 들어와도 재시도가 굶지 않게 자리를 따로, **먼저** 둔다 — 뒤에
 *    두면 매 틱 예산을 다 쓰는 새 행 묶음이 던지는 순간 재시도까지 닿지 못한다(코덱스 #841). 재시도
 *    한 사람이 예산을 다 쓰면 새 행 묶음의 잡기 문장이 먼저 실패하므로 그들의 시도 횟수는 오르지 않는다.
 *  - [PLAN_NOTIFY_MAX_ATTEMPTS] 번 시도한 행은 보내지 않고 지운다(오류 기록) — 같은 예고가 5분마다
 *    영원히 나가는 일의 상한이다. 혼자 보내도 끝내 안 들어가는, 기기가 예산보다 많은 사람이다.
 *
 * ⚠ **보낼 행은 원자적으로 잡고, 보내는 동안 잠근다**(코덱스 #841). 크론과 즉시 삭제가 겹치면 둘이
 *   같은 행을 읽는다 —
 *  - 시도 횟수를 '읽은 값 그대로일 때만' 올리고(`RETURNING`) **잡은 행에만** 보낸다.
 *  - 잡을 때 `claimed_until`(지금 + [PLAN_NOTIFY_LEASE_MINUTES]분)을 찍고, 그 시각 전에는 어떤
 *    실행도 그 행을 고르지 않는다. 잡은 실행이 보내고 지우기 전에 다른 실행이 시작돼도 같은 예고를
 *    다시 보내지 않는다. 잡은 실행이 중간에 죽으면 기한이 지난 뒤 다시 고를 수 있다.
 */

/**
 * 크론 한 틱이 꺼내는 **새 행** 수 — 유예 파기 크론이 한 틱에 파기하는 계정 수(`index.ts` 의
 * `LIMIT 2`) × 그룹 하나에서 떨어져 나갈 수 있는 최대 멤버(옛 6인 정원의 가족 − 주인 = 5).
 * 이보다 작으면 탈퇴가 이어지는 동안 대기열이 틱마다 불어난다.
 */
export const PLAN_NOTIFY_FRESH_LIMIT = 10;

/** 한 사람을 몇 번까지 시도하는가 — 넘으면 보내지 않고 지운다(같은 예고의 반복 상한). */
export const PLAN_NOTIFY_MAX_ATTEMPTS = 3;

/**
 * 잡은 행을 다른 실행이 고르지 못하게 막는 시간(분) — 한 실행(크론 틱·요청)이 끝나기에 넉넉하고,
 * 다음 틱(5분) 몇 번 안에 다시 고를 수 있을 만큼 짧다.
 */
export const PLAN_NOTIFY_LEASE_MINUTES = 10;

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
 * 이미 대기 중인 사람이 **또** 들어오면 새 사건이다 — 시각을 새로 찍고 시도 횟수·잠금을 되돌린다.
 * 그래야 그 사이 발송을 마친 지우기(`created_at` 이 꺼낸 값과 같을 때만 지운다)가 새 사건까지
 * 지우지 않고, 새 사건은 앞 사건의 잠금을 기다리지 않는다(둘은 다른 사건이라 둘 다 알린다).
 * 시각은 마이크로초까지 가지 않으므로 같은 밀리초의 재적재는 구분하지 못한다 — 그 경우는 이미 보내고
 * 있는 통지가 같은 내용(재조회 신호 + 지금 기준의 예고)이라 잃는 것이 없다.
 */
export const REQUEUE_ON_CONFLICT = `ON CONFLICT(user_id) DO UPDATE SET
            created_at = strftime('%Y-%m-%d %H:%M:%f', 'now'),
            attempts = 0,
            claimed_until = NULL`;

/** 지금 아무 실행도 잡고 있지 않은 행. */
const UNCLAIMED = `(claimed_until IS NULL OR claimed_until <= strftime('%Y-%m-%d %H:%M:%f', 'now'))`;

type QueuedRow = { userId: string; createdAt: string; attempts: number };

/**
 * 대기열에서 꺼내 등급 통지를 보내고, **보낸 뒤에** 행을 지운다.
 *
 * - `userIds` 를 주면 그 사람들만(즉시 삭제 `DELETE /user/me` 가 자기 파기분을 곧바로 보낼 때),
 *   없으면 다시 시도할 행 하나 + 새 행 묶음(크론 — 앞 틱에서 남은 것까지 잇는다).
 * - ⚠ **지우기를 발송 앞으로 옮기지 말 것.** 발송은 실패를 삼키므로, 앞에서 지우면 예산이 바닥난
 *   실행에서 행만 사라지고 예고는 안 나간다 — 이 표가 있는 이유가 통째로 무너진다.
 * - ⚠ **시도 횟수는 발송 앞에서(잡을 때) 올린다.** 뒤에서 올리면 예산이 바닥난 실행에서는 그 문장도
 *   못 돌아 같은 머리가 영원히 0회로 맨 앞에 선다.
 * - 던질 수 있다(조회·잡기·삭제 실패). 호출부는 커밋 뒤라 잡아서 기록만 한다 — 행이 남으므로 다음
 *   크론 틱이 다시 보낸다.
 */
export async function drainPendingPlanNotifications(
  db: Client,
  env: Parameters<typeof notifyBillingStateChanged>[1],
  options: { userIds?: readonly string[] } = {},
): Promise<void> {
  if (options.userIds) {
    const ids = Array.from(new Set(options.userIds.filter(Boolean)));
    if (ids.length === 0) return;
    await sendClaimed(
      db,
      env,
      toRows(
        await db.execute({
          sql: `SELECT user_id, created_at, attempts FROM pending_plan_notifications
                WHERE user_id IN (${ids.map(() => '?').join(', ')}) AND ${UNCLAIMED}`,
          args: ids,
        }),
      ),
    );
    return;
  }

  // 1) 다시 시도할 행 하나 — **먼저**, 따로(위 머리말). 뒤에 두면 새 행 묶음이 예산을 다 써 던지는 틱마다
  //    재시도까지 닿지 못해, 앞선 실패자가 끝없이 밀린다(코덱스 #841). 이 한 사람이 예산을 다 쓰면 아래
  //    새 행 묶음의 잡기 문장이 먼저 실패해 그들의 시도 횟수는 오르지 않는다 — 다음 틱에 그대로 나간다.
  let retryError: unknown = null;
  try {
    await sendClaimed(
      db,
      env,
      toRows(
        await db.execute(`SELECT user_id, created_at, attempts FROM pending_plan_notifications
                          WHERE attempts > 0 AND ${UNCLAIMED}
                          ORDER BY attempts, created_at, user_id
                          LIMIT 1`),
      ),
    );
  } catch (err) {
    // 예산 소진이면 아래도 곧바로 실패한다(해가 없다). 다른 실패면 새 행은 그대로 보낸다.
    retryError = err;
  }
  // 2) 새 행 묶음.
  await sendClaimed(
    db,
    env,
    toRows(
      await db.execute({
        sql: `SELECT user_id, created_at, attempts FROM pending_plan_notifications
              WHERE attempts = 0 AND ${UNCLAIMED}
              ORDER BY created_at, user_id
              LIMIT ?`,
        args: [PLAN_NOTIFY_FRESH_LIMIT],
      }),
    ),
  );
  if (retryError) throw retryError;
}

/** 읽은 행을 잡고(원자적으로), 잡은 행에만 보내고, 보낸 뒤 지운다. */
async function sendClaimed(
  db: Client,
  env: Parameters<typeof notifyBillingStateChanged>[1],
  rows: readonly QueuedRow[],
): Promise<void> {
  if (rows.length === 0) return;

  // 잡기 — 읽은 그대로(사람·시각·시도 횟수)이고 아무도 잡지 않은 행만 시도 횟수를 올리고 잠근 뒤
  // 돌려받는다. 다른 실행이 먼저 잡았거나, 그 사이 다시 들어왔거나(시각이 바뀜), 지워졌으면 빠진다.
  const match = matchRows(rows, { withAttempts: true });
  const claimed = toRows(
    await db.execute({
      sql: `UPDATE pending_plan_notifications
               SET attempts = attempts + 1,
                   claimed_until = strftime('%Y-%m-%d %H:%M:%f', 'now', ?)
             WHERE (${match.sql}) AND ${UNCLAIMED}
            RETURNING user_id, created_at, attempts`,
      args: [`+${PLAN_NOTIFY_LEASE_MINUTES} minutes`, ...match.args],
    }),
  ).map((row) => ({ ...row, attempts: row.attempts - 1 }));
  if (claimed.length === 0) return;

  // 잡기 전에 이미 상한에 닿은 행은 보내지 않고 지운다.
  const exhausted = claimed.filter((row) => row.attempts >= PLAN_NOTIFY_MAX_ATTEMPTS);
  const sending = claimed.filter((row) => row.attempts < PLAN_NOTIFY_MAX_ATTEMPTS);
  if (exhausted.length > 0) {
    logStructured('error', {
      at: 'billing.pending_plan_notifications',
      action: 'GAVE_UP',
      users: exhausted.length,
      attempts: PLAN_NOTIFY_MAX_ATTEMPTS,
    });
  }
  if (sending.length > 0) {
    await notifyBillingStateChanged(
      db,
      env,
      sending.map((row) => row.userId),
    );
  }

  // 지우기 — 잡은 그대로(시각만 본다: 시도 횟수는 방금 우리가 올렸다)인 행만. 그 사이 다시 들어온
  // 사람(시각이 바뀜)은 남긴다.
  const done = matchRows(claimed);
  await db.execute({
    sql: `DELETE FROM pending_plan_notifications WHERE ${done.sql}`,
    args: done.args,
  });
}

function toRows(res: { rows: ArrayLike<Record<string, unknown>> }): QueuedRow[] {
  return Array.from(res.rows).map((row) => ({
    userId: String(row.user_id),
    createdAt: String(row.created_at),
    attempts: Number(row.attempts ?? 0),
  }));
}

/**
 * 꺼낸 그대로의 행만 가리키는 조건 — 사람과 적힌 시각이 같아야 한다. `withAttempts` 면 시도 횟수까지
 * 같아야 한다(잡기 — 다른 실행이 먼저 올렸으면 빠진다).
 */
function matchRows(
  rows: readonly QueuedRow[],
  options: { withAttempts?: boolean } = {},
): { sql: string; args: Array<string | number> } {
  const one = options.withAttempts
    ? '(user_id = ? AND created_at = ? AND attempts = ?)'
    : '(user_id = ? AND created_at = ?)';
  return {
    sql: rows.map(() => one).join(' OR '),
    args: rows.flatMap((row) =>
      options.withAttempts ? [row.userId, row.createdAt, row.attempts] : [row.userId, row.createdAt],
    ),
  };
}
