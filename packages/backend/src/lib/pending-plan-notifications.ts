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
 * 그래서 받을 사람을 **파기와 같은 트랜잭션에** 적어 두고, 보낸 뒤에만 지운다.
 *
 * ⚠ **비우기는 자기 예산을 통째로 가진 실행에서만 한다**(코덱스 #841 — 다섯 차례 지적의 뿌리).
 *   5분 틱 끝에서 남은 예산을 나눠 쓰면 '얼마나 남았나' 를 알 수 없어, 시도 횟수·재시도 순서·처리량을
 *   어떻게 짜도 다른 모서리에서 어긋났다. 그래서
 *  - **1분 전용 크론의 홀수 분, 대기 행이 있을 때만** 그 실행을 통째로 쓴다([runPlanNotificationDrainTurn]).
 *    대기열이 비어 있으면(거의 언제나) 조회 한 번만 하고 기간 한정 개인 플랜 종료 작업에 넘긴다.
 *  - 그 실행 안에서는 **비용을 미리 센다** — 사람마다 기기 수(기기당 최대 두 통)로 [PLAN_NOTIFY_RUN_BUDGET]
 *    안에 드는 만큼만 잡는다. 예산에 안 드는 사람은 잡지 않으므로 **시도 횟수가 예산 때문에 오르는
 *    일이 없다.** 한 사람만으로 예산을 넘으면(기기가 아주 많은 사람) 그 사람만 보내되 메시지를 예산까지
 *    자른다(`maxMessages` — 보이는 예고가 먼저라 잘리는 것은 무음 신호부터다).
 *  - 즉시 삭제(`DELETE /user/me`)는 커밋 뒤 자기 파기분을 곧바로 보낸다([sendPlanNotificationsNow]) —
 *    즉시성을 위한 것이고 **시도 횟수를 쓰지 않는다**(그 요청은 파기로 예산을 이미 썼다). 잘리면 행이
 *    남아 전용 크론이 잇는다.
 *
 * ⚠ **이 표가 지키는 것은 '예산에 잘린 발송' 이다.** 예산이 남은 채 실패한 발송(OAuth 실패·FCM 5xx·
 *   APNs 네트워크 오류)은 발송 함수가 삼키므로 지우기가 성공해 행이 사라진다 — 다른 결제 경로의 통지와
 *   같은 최선 노력이다. 사람마다 발송 결과를 돌려받아 실패한 사람만 남기는 것은 다음 단계다.
 *
 * ⚠ **보낼 행은 원자적으로 잡고, 보내는 동안 잠근다.** 잡을 때 `claimed_until`(지금 +
 *   [PLAN_NOTIFY_LEASE_MINUTES]분)을 찍고, 그 시각 전에는 어떤 실행도 그 행을 고르지 않는다 — 전용
 *   크론과 즉시 삭제가 겹쳐도 같은 예고가 두 번 나가지 않는다. 잡은 실행이 중간에 죽으면 기한 뒤 다시
 *   고른다. 전용 크론의 잡기만 시도 횟수를 올리고, [PLAN_NOTIFY_MAX_ATTEMPTS] 번 시도한 행(예산과 무관하게
 *   거듭 죽은 행)은 보내지 않고 지운다(오류 기록) — 같은 예고가 끝없이 반복되는 일의 상한이다.
 *
 * 규칙: `docs/spec/billing-lifecycle.md` 「그룹 주인이 탈퇴하면」.
 */

/** 전용 크론의 비우기 한 번이 쓰는 subrequest 상한 — 워커 ~50 에서 로깅·재시도 여유를 남긴다. */
export const PLAN_NOTIFY_RUN_BUDGET = 45;

/**
 * 비우기 한 번의 **메시지 밖** 비용 — 대기열 조회(1, 대기 확인 겸)·잡기(1)·지우기(1) + 발송 함수의
 * 유예 조회(1)·토큰 조회(1)·OAuth(1)·죽은 토큰 정리(FCM 1·APNs 1).
 */
export const PLAN_NOTIFY_RUN_OVERHEAD = 8;

/** 사람을 고를 후보 수 — 기기가 없는 사람만 이어져도 이보다 많이는 한 번에 잡지 않는다. */
export const PLAN_NOTIFY_CANDIDATES = 20;

/** 한 사람을 몇 번까지 시도하는가 — 넘으면 보내지 않고 지운다(같은 예고의 반복 상한). */
export const PLAN_NOTIFY_MAX_ATTEMPTS = 3;

/**
 * 잡은 행을 다른 실행이 고르지 못하게 막는 시간(분) — 한 실행(크론·요청)이 끝나기에 넉넉하고,
 * 전용 크론 몇 번 안에 다시 고를 수 있을 만큼 짧다.
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

/** 1분 전용 크론 중 대기열 비우기가 차례를 갖는 분 — 홀수 분(짝수 분은 늘 개인 플랜 종료 작업). */
export function isPlanNotificationDrainMinute(now: Date): boolean {
  return now.getUTCMinutes() % 2 === 1;
}

type QueuedRow = { userId: string; createdAt: string; attempts: number; devices: number };

/**
 * **1분 전용 크론의 홀수 분**에 부른다. 대기 행이 없으면 `false`(조회 한 번 — 이 실행은 개인 플랜 종료
 * 작업이 이어 쓴다), 있으면 예산 안에서 보내고 `true`(이 실행은 여기서 끝난다).
 *
 * 던질 수 있다(조회·잡기·삭제 실패). 호출부는 기록만 한다 — 행이 남거나(잡기 전) 잠금 기한 뒤 다시 고른다.
 */
export async function runPlanNotificationDrainTurn(
  db: Client,
  env: Parameters<typeof notifyBillingStateChanged>[1],
): Promise<boolean> {
  const candidates = toRows(
    await db.execute({
      sql: `SELECT q.user_id, q.created_at, q.attempts,
                   (SELECT COUNT(*) FROM push_tokens pt WHERE pt.user_id = q.user_id) AS devices
              FROM pending_plan_notifications q
             WHERE ${UNCLAIMED.replaceAll('claimed_until', 'q.claimed_until')}
             ORDER BY q.attempts, q.created_at, q.user_id
             LIMIT ?`,
      args: [PLAN_NOTIFY_CANDIDATES],
    }),
  );
  if (candidates.length === 0) return false;

  // 비용을 미리 센다 — 기기당 최대 두 통(보이는 예고 + 재조회 신호). 앞에서부터 예산에 드는 만큼.
  const messageBudget = PLAN_NOTIFY_RUN_BUDGET - PLAN_NOTIFY_RUN_OVERHEAD;
  const picked: QueuedRow[] = [];
  let messages = 0;
  for (const row of candidates) {
    const cost = 2 * row.devices;
    if (picked.length > 0 && messages + cost > messageBudget) break;
    picked.push(row);
    messages += cost;
  }
  // 한 사람만으로 예산을 넘으면 그 사람의 메시지를 예산까지 자른다(보이는 예고가 먼저 남는다).
  const maxMessages = messages > messageBudget ? messageBudget : undefined;

  const claimed = await claim(db, picked, { countAttempt: true });
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
      { maxMessages },
    );
  }
  await deleteClaimed(db, claimed);
  return true;
}

/**
 * 즉시 삭제(`DELETE /user/me`)가 커밋 뒤 **자기 파기분을 곧바로** 보낸다 — 즉시성을 위한 것이다.
 *
 * - **시도 횟수를 쓰지 않는다.** 이 요청은 파기로 예산을 이미 써서 발송이 잘릴 수 있는데, 그건 그 사람의
 *   실패가 아니다. 잘리면 행이 (잠금 기한 뒤) 남아 전용 크론이 예산을 셈해 다시 보낸다.
 * - 잠금은 건다 — 그 사이 전용 크론이 같은 행을 잡아 두 번 보내지 않는다.
 * - 던질 수 있다. 호출부는 탈퇴 응답을 지키려고 잡아서 기록만 한다.
 */
export async function sendPlanNotificationsNow(
  db: Client,
  env: Parameters<typeof notifyBillingStateChanged>[1],
  userIds: readonly string[],
): Promise<void> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return;
  const rows = toRows(
    await db.execute({
      sql: `SELECT user_id, created_at, attempts FROM pending_plan_notifications
            WHERE user_id IN (${ids.map(() => '?').join(', ')}) AND ${UNCLAIMED}`,
      args: ids,
    }),
  );
  const claimed = await claim(db, rows, { countAttempt: false });
  if (claimed.length === 0) return;
  await notifyBillingStateChanged(
    db,
    env,
    claimed.map((row) => row.userId),
  );
  await deleteClaimed(db, claimed);
}

/**
 * 잡기 — 읽은 그대로(사람·시각·시도 횟수)이고 아무도 잡지 않은 행만 잠그고(`countAttempt` 면 시도
 * 횟수도 올리고) 돌려받는다. 다른 실행이 먼저 잡았거나, 그 사이 다시 들어왔거나(시각이 바뀜),
 * 지워졌으면 빠진다. 돌려주는 `attempts` 는 **잡기 전** 값이다.
 */
async function claim(
  db: Client,
  rows: readonly QueuedRow[],
  options: { countAttempt: boolean },
): Promise<QueuedRow[]> {
  if (rows.length === 0) return [];
  const match = matchRows(rows, { withAttempts: true });
  const res = await db.execute({
    sql: `UPDATE pending_plan_notifications
             SET ${options.countAttempt ? 'attempts = attempts + 1,' : ''}
                 claimed_until = strftime('%Y-%m-%d %H:%M:%f', 'now', ?)
           WHERE (${match.sql}) AND ${UNCLAIMED}
          RETURNING user_id, created_at, attempts`,
    args: [`+${PLAN_NOTIFY_LEASE_MINUTES} minutes`, ...match.args],
  });
  const devicesOf = new Map(rows.map((row) => [row.userId, row.devices]));
  return toRows(res).map((row) => ({
    ...row,
    attempts: options.countAttempt ? row.attempts - 1 : row.attempts,
    devices: devicesOf.get(row.userId) ?? 0,
  }));
}

/**
 * 지우기 — **보낸 뒤에만**, 잡은 그대로(시각만 본다)인 행만. 그 사이 다시 들어온 사람(시각이 바뀜)은 남긴다.
 * ⚠ 발송 앞으로 옮기지 말 것 — 발송은 실패를 삼키므로, 앞에서 지우면 잘린 실행에서 행만 사라진다.
 */
async function deleteClaimed(db: Client, claimed: readonly QueuedRow[]): Promise<void> {
  if (claimed.length === 0) return;
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
    devices: Number(row.devices ?? 0),
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
